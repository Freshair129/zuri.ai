"""Build a redacted, read-only SmartGift customer backfill receipt.

The DuckDB source is opened read-only. The output contains counts, hashes and
resolution state only; it never writes source PII to a repository artifact.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path

import duckdb

# @req FR-078 - produce a source-bound, redacted Customer Profile dry-run.
# @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path(r"D:\workspace\Bussiness-01-SmartGift\data\sot.duckdb")
CONTRACT_PATH = ROOT / "contracts/migrations/smartgift-customer-data-contract.json"
DEFAULT_OUTPUT = ROOT / "artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-backfill-dry-run.json"
HASH_ALGORITHM = "sha256-canonical-allowed-fields-v1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_row_hash(row: dict[str, object]) -> str:
    payload = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def count_rows(connection: duckdb.DuckDBPyConnection, query: str) -> int:
    return int(connection.execute(query).fetchone()[0])


def build_receipt(source_path: Path, contract: dict[str, object]) -> dict[str, object]:
    snapshot_sha256 = sha256_file(source_path)
    expected_sha256 = contract["source"]["snapshotSha256"]
    if snapshot_sha256 != expected_sha256:
        raise RuntimeError("source snapshot hash does not match the customer-data contract")

    connection = duckdb.connect(str(source_path), read_only=True)
    try:
        source_counts = {
            "customer": count_rows(connection, "select count(*) from customer"),
            "stg_contact": count_rows(connection, "select count(*) from stg_contact"),
            "stg_doc": count_rows(connection, "select count(*) from stg_doc"),
            "interaction": count_rows(connection, "select count(*) from interaction"),
        }

        duplicate_customer_keys = count_rows(
            connection,
            """
            select count(*)
            from (
              select customer_key
              from customer
              group by customer_key
              having count(*) > 1
            ) duplicate_keys
            """,
        )
        duplicate_name_groups = count_rows(
            connection,
            """
            select count(*)
            from (
              select normalized_name
              from customer
              where normalized_name is not null and length(trim(normalized_name)) > 0
              group by normalized_name
              having count(*) > 1
            ) duplicate_names
            """,
        )
        duplicate_tax_groups = count_rows(
            connection,
            """
            select count(*)
            from (
              select tax_id
              from customer
              where tax_id is not null and length(trim(tax_id)) > 0
              group by tax_id
              having count(*) > 1
            ) duplicate_tax_ids
            """,
        )
        duplicate_contact_codes = count_rows(
            connection,
            """
            select count(*)
            from (
              select contact_code
              from stg_contact
              where contact_code is not null and length(trim(contact_code)) > 0
              group by contact_code
              having count(*) > 1
            ) duplicate_codes
            """,
        )
        review_required_rows = count_rows(
            connection,
            """
            with duplicate_keys as (
              select customer_key
              from customer
              where customer_key is not null and length(trim(customer_key)) > 0
              group by customer_key
              having count(*) > 1
            ), duplicate_names as (
              select normalized_name
              from customer
              where normalized_name is not null and length(trim(normalized_name)) > 0
              group by normalized_name
              having count(*) > 1
            ), duplicate_tax_ids as (
              select tax_id
              from customer
              where tax_id is not null and length(trim(tax_id)) > 0
              group by tax_id
              having count(*) > 1
            )
            select count(*)
            from customer c
            where c.customer_key is not null
              and length(trim(c.customer_key)) > 0
              and c.display_name is not null
              and length(trim(c.display_name)) > 0
              and (c.customer_key in (select customer_key from duplicate_keys)
               or c.normalized_name in (select normalized_name from duplicate_names)
               or c.tax_id in (select tax_id from duplicate_tax_ids))
            """,
        )
        missing_display_names = count_rows(
            connection,
            """
            select count(*)
            from customer
            where display_name is null or length(trim(display_name)) = 0
            """,
        )
        missing_customer_keys = count_rows(
            connection,
            """
            select count(*)
            from customer
            where customer_key is null or length(trim(customer_key)) = 0
            """,
        )
        missing_contact_source_hash = count_rows(
            connection,
            """
            select count(*)
            from stg_contact
            where source_sha256 is null or length(trim(source_sha256)) = 0
            """,
        )

        # Hash the allowed source shape in memory to prove deterministic row
        # identity without writing the PII-bearing values to the receipt.
        row_hash_count = 0
        row_hashes = set()
        for row in connection.execute(
            """
            select customer_key, display_name, normalized_name, tax_id, email,
                   phone_e164, postcode, contact_type
            from customer
            order by customer_key
            """
        ).fetchall():
            row_dict = {
                "sourceRecordKey": row[0],
                "displayName": row[1],
                "normalizedName": row[2],
                "taxId": row[3],
                "email": row[4],
                "phoneE164": row[5],
                "postcode": row[6],
                "contactType": row[7],
            }
            row_hashes.add(canonical_row_hash(row_dict))
            row_hash_count += 1

        rejected = count_rows(
            connection,
            """
            select count(*)
            from customer
            where customer_key is null or length(trim(customer_key)) = 0
               or display_name is null or length(trim(display_name)) = 0
            """,
        )
        review_required = review_required_rows
        new_candidates = max(source_counts["customer"] - rejected - review_required, 0)

        required_approvals = contract["approvals"]["requiredApprovals"]
        approval_ready = (
            contract["status"] == "APPROVED"
            and all(approval["status"] == "APPROVED" for approval in required_approvals)
            and contract["scope"]["historicalWindow"]["status"] == "APPROVED"
            and all(gate["status"] == "COMPLETE" for gate in contract["gates"])
            and contract["targetSchema"]["state"] == "READY_FOR_IMPORT"
        )

        return {
            "mode": "READ_ONLY_DRY_RUN",
            "contractId": contract["customerDataContractId"],
            "versionId": contract["versionId"],
            "missionId": contract["missionId"],
            "contractStatus": contract["status"],
            "scope": {
                "tenantId": contract["scope"]["tenant"]["id"],
                "businessId": contract["scope"]["businesses"][0]["id"],
                "businessCode": contract["scope"]["targetBusinessCode"],
                "crossBusinessMerge": contract["scope"]["crossBusinessMerge"],
            },
            "source": {
                "sourceRef": contract["source"]["sourceRef"],
                "sourcePath": "redacted-local-path",
                "snapshotSha256": snapshot_sha256,
                "sourceAsOf": contract["source"]["snapshotObservedAt"],
                "accessMode": "READ_ONLY",
                "rowCounts": source_counts,
            },
            "resolution": {
                "policyVersion": contract["identityResolution"]["policyVersion"],
                "nameOnlyAutoMerge": False,
                "statusCounts": {
                    "NEW_CANDIDATE": new_candidates,
                    "REVIEW_REQUIRED": review_required,
                    "UNRESOLVED": 0,
                    "REJECTED": rejected,
                    "AUTO_MATCH": 0,
                },
                "duplicateCustomerKeyGroups": duplicate_customer_keys,
                "duplicateNormalizedNameGroups": duplicate_name_groups,
                "duplicateTaxIdGroups": duplicate_tax_groups,
                "duplicateContactCodeGroups": duplicate_contact_codes,
                "reviewRequiredRows": review_required_rows,
                "missingDisplayNameRows": missing_display_names,
                "missingCustomerKeyRows": missing_customer_keys,
                "missingContactSourceHashRows": missing_contact_source_hash,
                "rowHashCount": row_hash_count,
                "uniqueRowHashCount": len(row_hashes),
                "rowHashAlgorithm": HASH_ALGORITHM,
            },
            "fieldPolicy": {
                "publishFields": contract["fieldPolicy"]["allowedForInitialPublish"],
                "rawPiiStored": False,
                "financialAndDocumentFieldsPublished": False,
                "lineIdentifiersPublished": False,
            },
            "disposition": {
                "writeAuthorized": approval_ready,
                "reason": "READY_FOR_APPROVED_IMPORT" if approval_ready else "CONTRACT_OR_APPROVAL_GATE_PENDING",
                "allRowsHeldUntilApproval": not approval_ready,
            },
            "gates": {gate["id"]: gate["status"] for gate in contract["gates"]},
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not args.source.is_file():
        raise SystemExit("FAILED: DuckDB source path does not exist")

    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    receipt = build_receipt(args.source, contract)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "DRY_RUN_READY_FOR_REVIEW",
        "output": "redacted-receipt",
        "snapshotSha256": receipt["source"]["snapshotSha256"],
        "customerRows": receipt["source"]["rowCounts"]["customer"],
        "newCandidates": receipt["resolution"]["statusCounts"]["NEW_CANDIDATE"],
        "reviewRequired": receipt["resolution"]["statusCounts"]["REVIEW_REQUIRED"],
        "rejected": receipt["resolution"]["statusCounts"]["REJECTED"],
        "writeAuthorized": receipt["disposition"]["writeAuthorized"],
    }))


if __name__ == "__main__":
    main()
