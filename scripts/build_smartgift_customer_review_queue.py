"""Build or apply a redacted SmartGift duplicate-review queue manifest.

The DuckDB source is opened read-only. The manifest contains deterministic
review-case/review-item IDs, source hashes, row numbers and boolean evidence
flags only. It never writes source PII to the repository or target database.
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

# @req FR-078 — materialize the 130 held rows as stable, redacted review cases
# before any later owner decision; apply remains a separately gated operation.
# @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
# @tested tests/unit/customer-import-review-queue-script.test.js

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path(r"D:\workspace\Bussiness-01-SmartGift\data\sot.duckdb")
DEFAULT_OUTPUT = ROOT / "artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-review-queue-manifest.json"
EXPECTED_SNAPSHOT_SHA256 = "a8da233228cb80a088f11ff98fdef5773d0890bc158bcc40752c6d7a5e4bd5d7"
CONTRACT_ID = "CDC-SG-CUSTOMER-DATA-001"
VERSION_ID = "VER-SG-CUSTOMER-DATA-CONTRACT-0.3.0B"
MISSION_ID = "MIS-SG-CUSTOMER-DATA-BACKFILL-001"
TENANT_ID = "77cdbe70-3111-4a04-922a-8059be99a8b0"
BUSINESS_ID = "834fa869-62f3-431c-a287-e9a95e91175b"
SOURCE_SYSTEM = "SMARTGIFT_DUCKDB"
SOURCE_TABLE = "customer"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_row_hash(row: dict[str, Any]) -> str:
    payload = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def uuid_for(kind: str, source_hash: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"zuri:smartgift:{kind}:{source_hash}"))


def batch_uuid(snapshot_sha256: str) -> str:
    identity = "|".join([CONTRACT_ID, "MIS-SG-CUSTOMER-DATA-BACKFILL-001", "VER-SG-CUSTOMER-DATA-CONTRACT-0.2.0B", snapshot_sha256])
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"zuri:smartgift:batch:{identity}"))


def group_fingerprint(reason_code: str, group_key: str) -> str:
    return hashlib.sha256(f"{reason_code}|{group_key}".encode("utf-8")).hexdigest()


def value_key(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def build_manifest(source_path: Path) -> dict[str, Any]:
    snapshot_sha256 = sha256_file(source_path)
    if snapshot_sha256 != EXPECTED_SNAPSHOT_SHA256:
        raise RuntimeError("source snapshot hash does not match the approved customer-data contract")

    connection = duckdb.connect(str(source_path), read_only=True)
    try:
        source_rows = connection.execute(
            """
            select customer_key, display_name, normalized_name, tax_id, email,
                   phone_e164, postcode, contact_type
            from customer
            order by customer_key, display_name, tax_id
            """
        ).fetchall()
    finally:
        connection.close()

    counts: dict[str, dict[str, int]] = {"key": {}, "name": {}, "tax": {}}
    prepared: list[dict[str, Any]] = []
    for source_row, row in enumerate(source_rows, start=1):
        key, display_name, normalized_name, tax_id, email, phone, postcode, contact_type = row
        source_key = value_key(key)
        normalized_key = value_key(normalized_name)
        tax_key = value_key(tax_id)
        for value, bucket in ((source_key, counts["key"]), (normalized_key, counts["name"]), (tax_key, counts["tax"])):
            if value is not None:
                bucket[value] = bucket.get(value, 0) + 1
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
        prepared.append({
            "sourceRow": source_row,
            "sourceKey": source_key,
            "normalizedKey": normalized_key,
            "taxKey": tax_key,
            "email": value_key(email),
            "phone": value_key(phone),
            "postcode": value_key(postcode),
            "sourceSha256": canonical_row_hash(allowed_shape),
        })

    review_rows = [
        row for row in prepared
        if row["sourceKey"]
        and row["normalizedKey"]
        and (
            counts["key"].get(row["sourceKey"], 0) > 1
            or counts["name"].get(row["normalizedKey"], 0) > 1
            or (row["taxKey"] and counts["tax"].get(row["taxKey"], 0) > 1)
        )
    ]
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in review_rows:
        if counts["name"].get(row["normalizedKey"], 0) > 1:
            reason = "DUPLICATE_NORMALIZED_NAME"
            key = row["normalizedKey"]
        elif counts["key"].get(row["sourceKey"], 0) > 1:
            reason = "DUPLICATE_SOURCE_KEY"
            key = row["sourceKey"]
        else:
            reason = "DUPLICATE_TAX_ID"
            key = row["taxKey"]
        groups.setdefault((reason, key), []).append(row)

    batch_id = batch_uuid(snapshot_sha256)
    cases = []
    for (reason, key), rows in sorted(groups.items(), key=lambda entry: (entry[0][0], entry[0][1])):
        fingerprint = group_fingerprint(reason, key)
        case_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"zuri:smartgift:review-case:{batch_id}:{fingerprint}"))
        values = {field: {row[field] for row in rows if row[field]} for field in ("taxKey", "email", "phone", "postcode")}
        evidence = {
            "normalizedNameMatch": reason == "DUPLICATE_NORMALIZED_NAME",
            "sourceKeyMatch": reason == "DUPLICATE_SOURCE_KEY",
            "taxIdMatch": len(values["taxKey"]) < len([row for row in rows if row["taxKey"]]),
            "emailMatch": len(values["email"]) < len([row for row in rows if row["email"]]),
            "phoneMatch": len(values["phone"]) < len([row for row in rows if row["phone"]]),
            "postcodeMatch": len(values["postcode"]) < len([row for row in rows if row["postcode"]]),
        }
        cases.append({
            "reviewCaseId": case_id,
            "batchId": batch_id,
            "reasonCode": reason,
            "groupFingerprint": fingerprint,
            "itemCount": len(rows),
            "evidenceSummary": evidence,
            "items": [
                {
                    "reviewItemId": uuid_for("provenance", row["sourceSha256"]),
                    "sourceRow": row["sourceRow"],
                    "sourceSha256": row["sourceSha256"],
                    "evidence": evidence,
                }
                for row in sorted(rows, key=lambda item: item["sourceRow"])
            ],
        })

    return {
        "schemaVersion": "1.0.0",
        "mode": "READ_ONLY_REVIEW_QUEUE_MANIFEST",
        "contractId": CONTRACT_ID,
        "versionId": VERSION_ID,
        "missionId": MISSION_ID,
        "batchId": batch_id,
        "scope": {"tenantId": TENANT_ID, "businessId": BUSINESS_ID, "businessCode": "BUS-SMARTGIFT"},
        "source": {"sourceRef": "SMARTGIFT_DUCKDB_PATH", "snapshotSha256": snapshot_sha256, "accessMode": "READ_ONLY"},
        "counts": {"sourceRows": len(prepared), "reviewItems": len(review_rows), "reviewCases": len(cases)},
        "rawPiiStored": False,
        "cases": cases,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def connection_string() -> str:
    value = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL")
    if not value or not value.startswith(("postgres://", "postgresql://")):
        raise RuntimeError("DIRECT_URL/DATABASE_URL is not a Postgres URL")
    return value


def apply_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    if manifest.get("rawPiiStored") is not False or manifest.get("counts", {}).get("reviewItems") != 130:
        raise RuntimeError("review queue manifest is not the approved redacted 130-row shape")
    import psycopg2

    connection = psycopg2.connect(connection_string())
    try:
        connection.autocommit = False
        with connection.cursor() as cursor:
            cursor.execute("select current_user")
            if cursor.fetchone()[0] != "postgres":
                raise RuntimeError("review queue preparation requires the reviewed postgres connection")
            cursor.execute(
                """
                select id from zuri_core.customer_import_batch
                where id = %s and tenant_id = %s and business_id = %s and status = 'APPLIED'
                """,
                (manifest["batchId"], TENANT_ID, BUSINESS_ID),
            )
            if cursor.fetchone() is None:
                raise RuntimeError("approved SmartGift customer batch is missing")

            for case in manifest["cases"]:
                cursor.execute(
                    """
                    insert into zuri_core.customer_import_review_case (
                      id, batch_id, tenant_id, business_id, reason_code,
                      group_fingerprint, status, item_count, evidence_summary_json
                    ) values (%s, %s, %s, %s, %s, %s, 'OPEN', %s, %s::jsonb)
                    on conflict (batch_id, group_fingerprint) do update set
                      item_count = excluded.item_count,
                      evidence_summary_json = excluded.evidence_summary_json,
                      updated_at = now()
                    """,
                    (
                        case["reviewCaseId"], manifest["batchId"], TENANT_ID,
                        BUSINESS_ID, case["reasonCode"], case["groupFingerprint"],
                        case["itemCount"], json.dumps(case["evidenceSummary"], separators=(",", ":")),
                    ),
                )
                for item in case["items"]:
                    cursor.execute(
                        """
                        update zuri_core.customer_import_provenance
                        set review_case_id = %s,
                            review_reason_code = %s,
                            review_evidence_json = %s::jsonb,
                            updated_at = now()
                        where id = %s
                          and batch_id = %s
                          and resolution_status = 'REVIEW_REQUIRED'
                          and disposition = 'REVIEW'
                          and (review_case_id is null or review_case_id = %s)
                        """,
                        (
                            case["reviewCaseId"], case["reasonCode"],
                            json.dumps(item["evidence"], separators=(",", ":")),
                            item["reviewItemId"], manifest["batchId"], case["reviewCaseId"],
                        ),
                    )
                    if cursor.rowcount != 1:
                        raise RuntimeError("review item is missing, already assigned or not held")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return {"status": "APPLIED_REVIEW_QUEUE_METADATA", "reviewCases": manifest["counts"]["reviewCases"], "reviewItems": manifest["counts"]["reviewItems"], "publishesCustomers": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()

    try:
        if args.apply:
            manifest_path = args.manifest or args.output
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            print(json.dumps(apply_manifest(manifest), ensure_ascii=False))
            return 0
        if not args.source.is_file():
            raise RuntimeError("DuckDB source path does not exist")
        manifest = build_manifest(args.source)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"status": "REVIEW_QUEUE_MANIFEST_READY", "reviewCases": manifest["counts"]["reviewCases"], "reviewItems": manifest["counts"]["reviewItems"], "rawPiiStored": False, "output": "redacted-manifest"}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"status": "FAILED", "code": type(error).__name__}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
