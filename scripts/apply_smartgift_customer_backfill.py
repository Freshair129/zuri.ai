"""Apply the gated SmartGift Customer Profile backfill.

The source is opened read-only. The command is intentionally fail-closed:
without a fully approved contract it exits before opening a database write
transaction. Restricted source fields are used only in memory to calculate a
row hash and resolution status; only display_name is published.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import duckdb
import psycopg2
from psycopg2.extras import execute_batch

# @req FR-078 - apply the approved SmartGift Customer Profile batch with
# tenant/business scope, provenance and idempotent rollback boundary.
# @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path(r"D:\workspace\Bussiness-01-SmartGift\data\sot.duckdb")
CONTRACT_PATH = ROOT / "contracts/migrations/smartgift-customer-data-contract.json"
DRY_RUN_PATH = ROOT / "artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-backfill-dry-run.json"
SOURCE_SYSTEM = "SMARTGIFT_DUCKDB"
SOURCE_TABLE = "customer"
EXPECTED_TENANT_ID = "77cdbe70-3111-4a04-922a-8059be99a8b0"
EXPECTED_BUSINESS_ID = "834fa869-62f3-431c-a287-e9a95e91175b"
EXPECTED_APPROVER_ID = "c82690eb-84e8-48a8-8a28-fe3d839c2276"


def load_dotenv() -> None:
    """Load only connection variables when the caller did not export them."""

    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if key not in {"DIRECT_URL", "DATABASE_URL"} or os.environ.get(key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def connection_string() -> str:
    load_dotenv()
    value = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL")
    if not value or not value.startswith(("postgres://", "postgresql://")):
        raise RuntimeError("DIRECT_URL/DATABASE_URL is not a Postgres URL")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_row_hash(row: dict[str, Any]) -> str:
    payload = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def value_key(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def uuid_for(kind: str, source_hash: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"zuri:smartgift:{kind}:{source_hash}"))


def batch_uuid(contract: dict[str, Any], snapshot_sha256: str) -> str:
    identity = "|".join(
        [
            contract["customerDataContractId"],
            contract["missionId"],
            contract["versionId"],
            snapshot_sha256,
        ]
    )
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"zuri:smartgift:batch:{identity}"))


def approval_gate(contract: dict[str, Any]) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if contract.get("status") != "APPROVED":
        reasons.append(f"contract_status:{contract.get('status')}")
    for approval in contract["approvals"]["requiredApprovals"]:
        if approval.get("status") != "APPROVED" or not approval.get("personId"):
            reasons.append(f"approval:{approval.get('role')}:{approval.get('status')}")
    if contract["scope"]["historicalWindow"].get("status") != "APPROVED":
        reasons.append(
            f"historical_window:{contract['scope']['historicalWindow'].get('status')}"
        )
    for gate in contract["gates"]:
        if gate.get("status") != "COMPLETE":
            reasons.append(f"gate:{gate.get('id')}:{gate.get('status')}")
    if contract["targetSchema"].get("state") != "READY_FOR_IMPORT":
        reasons.append(f"target_schema_state:{contract['targetSchema'].get('state')}")
    return not reasons, reasons


def validate_contract(contract: dict[str, Any], snapshot_sha256: str) -> None:
    scope = contract["scope"]
    if scope["tenant"]["id"] != EXPECTED_TENANT_ID:
        raise RuntimeError("contract tenant scope mismatch")
    if scope["businesses"][0]["id"] != EXPECTED_BUSINESS_ID:
        raise RuntimeError("contract business scope mismatch")
    if contract["target"]["tenantId"] != EXPECTED_TENANT_ID:
        raise RuntimeError("target tenant scope mismatch")
    if contract["target"]["businessId"] != EXPECTED_BUSINESS_ID:
        raise RuntimeError("target business scope mismatch")
    if contract["approvals"]["requestedBy"]["personId"] != EXPECTED_APPROVER_ID:
        raise RuntimeError("contract approver identity mismatch")
    if contract["source"]["snapshotSha256"] != snapshot_sha256:
        raise RuntimeError("source snapshot hash does not match the customer-data contract")
    if contract["targetSchema"]["rawPiiStored"] is not False:
        raise RuntimeError("target schema raw PII policy is not false")
    if contract["fieldPolicy"]["allowedForInitialPublish"] != ["displayName"]:
        raise RuntimeError("initial publish field policy is broader than displayName")


def validate_dry_run_receipt(contract: dict[str, Any], snapshot_sha256: str) -> None:
    if not DRY_RUN_PATH.is_file():
        raise RuntimeError("redacted dry-run receipt is missing")
    receipt = json.loads(DRY_RUN_PATH.read_text(encoding="utf-8"))
    if receipt.get("contractId") != contract["customerDataContractId"]:
        raise RuntimeError("dry-run receipt contract identity mismatch")
    if receipt.get("versionId") != contract["versionId"]:
        raise RuntimeError("dry-run receipt version mismatch")
    if receipt.get("source", {}).get("snapshotSha256") != snapshot_sha256:
        raise RuntimeError("dry-run receipt source snapshot mismatch")
    if receipt.get("contractStatus") != "APPROVED":
        raise RuntimeError("dry-run receipt was not rebuilt after contract approval")
    if receipt.get("disposition", {}).get("writeAuthorized") is not True:
        raise RuntimeError("dry-run receipt is not authorized for the approved import")


def read_source_rows(source_path: Path, snapshot_sha256: str) -> list[dict[str, Any]]:
    connection = duckdb.connect(str(source_path), read_only=True)
    try:
        rows = connection.execute(
            """
            select customer_key, display_name, normalized_name, tax_id, email,
                   phone_e164, postcode, contact_type
            from customer
            order by customer_key, display_name, tax_id
            """
        ).fetchall()
    finally:
        connection.close()

    keys: dict[str, int] = {}
    names: dict[str, int] = {}
    tax_ids: dict[str, int] = {}
    prepared: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows, start=1):
        key, display_name, normalized_name, tax_id, email, phone, postcode, contact_type = row
        source_key = value_key(key)
        normalized_key = value_key(normalized_name)
        tax_key = value_key(tax_id)
        for value, counts in ((source_key, keys), (normalized_key, names), (tax_key, tax_ids)):
            if value is not None:
                counts[value] = counts.get(value, 0) + 1
        allowed_shape = {
            "sourceRecordKey": key,
            "displayName": display_name,
            "normalizedName": normalized_name,
            "taxId": tax_id,
            "email": email,
            "phoneE164": phone,
            "postcode": postcode,
            "contactType": contact_type,
        }
        prepared.append(
            {
                "sourceRow": row_number,
                "sourceRecordKey": source_key,
                "displayName": display_name,
                "normalizedName": normalized_key,
                "taxId": tax_key,
                "sourceSha256": canonical_row_hash(allowed_shape),
                "snapshotSha256": snapshot_sha256,
            }
        )

    for row in prepared:
        source_key = row["sourceRecordKey"]
        display_name = value_key(row["displayName"])
        normalized_name = row["normalizedName"]
        tax_id = row["taxId"]
        if source_key is None or display_name is None:
            status = "REJECTED"
            disposition = "REJECT"
        elif (
            keys.get(source_key, 0) > 1
            or (normalized_name is not None and names.get(normalized_name, 0) > 1)
            or (tax_id is not None and tax_ids.get(tax_id, 0) > 1)
        ):
            status = "REVIEW_REQUIRED"
            disposition = "REVIEW"
        else:
            status = "NEW_CANDIDATE"
            disposition = "PUBLISH"
        row["resolutionStatus"] = status
        row["disposition"] = disposition
        row["idempotencyKey"] = (
            f"{SOURCE_SYSTEM}|{SOURCE_TABLE}|{source_key or 'MISSING'}|{row['snapshotSha256']}"
        )
        row["personId"] = (
            uuid_for("person", row["sourceSha256"]) if status == "NEW_CANDIDATE" else None
        )
        row["customerId"] = (
            uuid_for("customer", row["sourceSha256"]) if status == "NEW_CANDIDATE" else None
        )
        row["provenanceId"] = uuid_for("provenance", row["sourceSha256"])
    return prepared


def summarize(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"NEW_CANDIDATE": 0, "REVIEW_REQUIRED": 0, "UNRESOLVED": 0, "REJECTED": 0}
    for row in rows:
        counts[row["resolutionStatus"]] += 1
    return counts


def provenance_insert_values(
    row: dict[str, Any], batch_id: str, snapshot_sha256: str
) -> tuple[Any, ...]:
    """Return the exact values for the provenance insert placeholders."""

    return (
        row["provenanceId"],
        batch_id,
        SOURCE_SYSTEM,
        SOURCE_TABLE,
        row["sourceRecordKey"] or "MISSING",
        row["sourceRow"],
        row["sourceSha256"],
        snapshot_sha256,
        row["idempotencyKey"],
        row["resolutionStatus"],
        row["disposition"],
        row["personId"],
        row["customerId"],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()

    if not args.apply:
        print(json.dumps({"status": "REFUSED", "reason": "PASS --apply ONLY AFTER CONTRACT GATES COMPLETE"}))
        return 2
    if not args.source.is_file():
        print(json.dumps({"status": "FAILED", "code": "SOURCE_NOT_FOUND"}))
        return 1

    try:
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        snapshot_sha256 = sha256_file(args.source)
        validate_contract(contract, snapshot_sha256)
        ready, reasons = approval_gate(contract)
        if not ready:
            print(json.dumps({"status": "REFUSED_GATE", "reasons": reasons}))
            return 2
        validate_dry_run_receipt(contract, snapshot_sha256)

        rows = read_source_rows(args.source, snapshot_sha256)
        counts = summarize(rows)
        connection = psycopg2.connect(connection_string())
        try:
            connection.autocommit = False
            with connection.cursor() as cursor:
                cursor.execute("select current_user")
                if cursor.fetchone()[0] != "postgres":
                    raise RuntimeError("customer backfill requires the reviewed postgres connection")
                cursor.execute(
                    """
                    select id, tenant_id, code
                    from zuri_core.business
                    where id = %s and tenant_id = %s
                    """,
                    (EXPECTED_BUSINESS_ID, EXPECTED_TENANT_ID),
                )
                business = cursor.fetchone()
                if business is None or business[2] != "BUS-SMARTGIFT":
                    raise RuntimeError("target SmartGift business scope is missing")
                cursor.execute(
                    """
                    select id, code
                    from zuri_core.person
                    where id = %s and code = 'PER-BOSS'
                    """,
                    (EXPECTED_APPROVER_ID,),
                )
                if cursor.fetchone() is None:
                    raise RuntimeError("approved platform person profile is missing")

                batch_id = batch_uuid(contract, snapshot_sha256)
                cursor.execute(
                    """
                    select id, status, publish_row_count, held_row_count
                    from zuri_core.customer_import_batch
                    where contract_id = %s
                      and mission_id = %s
                      and version_id = %s
                      and snapshot_sha256 = %s
                    """,
                    (
                        contract["customerDataContractId"],
                        contract["missionId"],
                        contract["versionId"],
                        snapshot_sha256,
                    ),
                )
                existing_batch = cursor.fetchone()
                if existing_batch is not None:
                    connection.rollback()
                    print(
                        json.dumps(
                            {
                                "status": "ALREADY_APPLIED" if existing_batch[1] == "APPLIED" else "EXISTING_BATCH",
                                "batchId": existing_batch[0],
                                "batchStatus": existing_batch[1],
                                "publishRows": existing_batch[2],
                                "heldRows": existing_batch[3],
                            }
                        )
                    )
                    return 0 if existing_batch[1] == "APPLIED" else 2

                cursor.execute(
                    """
                    select count(*)
                    from zuri_core.customer_import_provenance
                    where source_system = %s
                      and source_table = %s
                      and snapshot_sha256 = %s
                    """,
                    (SOURCE_SYSTEM, SOURCE_TABLE, snapshot_sha256),
                )
                if cursor.fetchone()[0] != 0:
                    raise RuntimeError("provenance exists without the reviewed batch identity")

                cursor.execute(
                    """
                    select pg_advisory_xact_lock(hashtext(%s))
                    """,
                    (f"zuri:{contract['missionId']}:{snapshot_sha256}",),
                )
                cursor.execute(
                    """
                    insert into zuri_core.customer_import_batch (
                      id, contract_id, mission_id, version_id, tenant_id, business_id,
                      source_ref, snapshot_sha256, source_row_count, publish_row_count,
                      held_row_count, status, approved_by_person_id
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'APPROVED', %s)
                    """,
                    (
                        batch_id,
                        contract["customerDataContractId"],
                        contract["missionId"],
                        contract["versionId"],
                        EXPECTED_TENANT_ID,
                        EXPECTED_BUSINESS_ID,
                        contract["source"]["sourceRef"],
                        snapshot_sha256,
                        len(rows),
                        counts["NEW_CANDIDATE"],
                        len(rows) - counts["NEW_CANDIDATE"],
                        EXPECTED_APPROVER_ID,
                    ),
                )

                publish_rows = [
                    row for row in rows if row["resolutionStatus"] == "NEW_CANDIDATE"
                ]
                execute_batch(
                    cursor,
                    """
                    insert into zuri_core.person (id, code, display_name, email)
                    values (%s, %s, %s, null)
                    """,
                    [
                        (
                            row["personId"],
                            f"PER-SG-{row['sourceSha256'][:24]}",
                            value_key(row["displayName"]),
                        )
                        for row in publish_rows
                    ],
                    page_size=250,
                )
                execute_batch(
                    cursor,
                    """
                    insert into zuri_core.customer (
                      id, code, tenant_id, business_id, person_id, display_name
                    ) values (%s, %s, %s, %s, %s, %s)
                    """,
                    [
                        (
                            row["customerId"],
                            f"CUS-SG-{row['sourceSha256'][:24]}",
                            EXPECTED_TENANT_ID,
                            EXPECTED_BUSINESS_ID,
                            row["personId"],
                            value_key(row["displayName"]),
                        )
                        for row in publish_rows
                    ],
                    page_size=250,
                )
                execute_batch(
                    cursor,
                    """
                    insert into zuri_core.customer_import_provenance (
                      id, batch_id, source_system, source_table, source_record_key,
                      source_row, source_sha256, snapshot_sha256, idempotency_key,
                      resolution_status, match_method, disposition, person_id, customer_id
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'NONE', %s, %s, %s)
                    """,
                    [
                        provenance_insert_values(row, batch_id, snapshot_sha256)
                        for row in rows
                    ],
                    page_size=250,
                )

                cursor.execute(
                    """
                    update zuri_core.customer_import_batch
                    set status = 'APPLIED', updated_at = now()
                    where id = %s
                    """,
                    (batch_id,),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

        print(
            json.dumps(
                {
                    "status": "APPLIED",
                    "batchId": batch_id,
                    "tenantId": EXPECTED_TENANT_ID,
                    "businessId": EXPECTED_BUSINESS_ID,
                    "sourceRows": len(rows),
                    "publishedRows": counts["NEW_CANDIDATE"],
                    "heldRows": len(rows) - counts["NEW_CANDIDATE"],
                    "rawPiiStored": False,
                    "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
            )
        )
        return 0
    except Exception as error:  # Do not print exception details; they may contain source values.
        print(json.dumps({"status": "FAILED", "code": type(error).__name__}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
