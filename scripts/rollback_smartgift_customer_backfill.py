"""Rehearse or apply a batch-scoped SmartGift customer backfill rollback.

The default mode is read-only.  Rehearsal executes the deletion statements
inside a savepoint and rolls them back before commit.  Persistent rollback
requires both --apply and --confirm-rollback and refuses any batch outside the
fixed Tenant/Business/contract scope.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

import psycopg2

# @req FR-078 - provide a batch-scoped rollback boundary for the approved
# SmartGift Customer Profile import.
# @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001"
EXPECTED_TENANT_ID = "77cdbe70-3111-4a04-922a-8059be99a8b0"
EXPECTED_BUSINESS_ID = "834fa869-62f3-431c-a287-e9a95e91175b"
EXPECTED_CONTRACT_ID = "CDC-SG-CUSTOMER-DATA-001"
EXPECTED_MISSION_ID = "MIS-SG-CUSTOMER-DATA-BACKFILL-001"
EXPECTED_VERSION_ID = "VER-SG-CUSTOMER-DATA-CONTRACT-0.2.0B"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def load_dotenv() -> None:
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


def require_batch(cur: Any, batch_id: str) -> dict[str, Any]:
    if not UUID_RE.fullmatch(batch_id):
        raise RuntimeError("batch id is not a UUID")
    cur.execute(
        """
        select id, contract_id, mission_id, version_id, tenant_id, business_id,
               snapshot_sha256, status, publish_row_count, held_row_count
        from zuri_core.customer_import_batch
        where id = %s
        """,
        (batch_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise RuntimeError("batch not found")
    batch = dict(
        zip(
            [
                "id",
                "contract_id",
                "mission_id",
                "version_id",
                "tenant_id",
                "business_id",
                "snapshot_sha256",
                "status",
                "publish_row_count",
                "held_row_count",
            ],
            row,
        )
    )
    expected = {
        "contract_id": EXPECTED_CONTRACT_ID,
        "mission_id": EXPECTED_MISSION_ID,
        "version_id": EXPECTED_VERSION_ID,
        "tenant_id": EXPECTED_TENANT_ID,
        "business_id": EXPECTED_BUSINESS_ID,
    }
    for key, value in expected.items():
        if batch[key] != value:
            raise RuntimeError(f"batch {key} scope mismatch")
    if batch["status"] != "APPLIED":
        raise RuntimeError(f"batch status is not APPLIED: {batch['status']}")
    return batch


def counts(cur: Any, batch_id: str) -> dict[str, int]:
    cur.execute(
        """
        select
          (select count(*) from zuri_core.customer_import_provenance where batch_id = %s) as provenance_rows,
          (select count(*) from zuri_core.customer_import_provenance where batch_id = %s and customer_id is not null) as customer_target_rows,
          (select count(*) from zuri_core.customer_import_provenance where batch_id = %s and person_id is not null) as person_target_rows,
          (select count(*) from zuri_core.customer_import_batch where id = %s) as batch_rows
        """,
        (batch_id, batch_id, batch_id, batch_id),
    )
    row = cur.fetchone()
    return {
        "provenanceRows": int(row[0]),
        "customerTargetRows": int(row[1]),
        "personTargetRows": int(row[2]),
        "batchRows": int(row[3]),
    }


def rollback_statements(cur: Any, batch_id: str) -> dict[str, int]:
    cur.execute(
        """
        create temporary table rollback_targets (
          person_id text,
          customer_id text
        ) on commit drop
        """
    )
    cur.execute(
        """
        insert into rollback_targets (person_id, customer_id)
        select distinct person_id, customer_id
        from zuri_core.customer_import_provenance
        where batch_id = %s
        """,
        (batch_id,),
    )
    before = counts(cur, batch_id)
    cur.execute("delete from zuri_core.customer_import_provenance where batch_id = %s", (batch_id,))
    provenance_deleted = cur.rowcount
    cur.execute(
        """
        delete from zuri_core.customer c
        using rollback_targets t
        where c.id = t.customer_id
        """
    )
    customer_deleted = cur.rowcount
    cur.execute(
        """
        delete from zuri_core.person p
        using rollback_targets t
        where p.id = t.person_id
          and not exists (select 1 from zuri_core.customer c where c.person_id = p.id)
          and not exists (select 1 from zuri_core.customer_import_provenance ip where ip.person_id = p.id)
        """
    )
    person_deleted = cur.rowcount
    cur.execute(
        """
        update zuri_core.customer_import_batch
        set status = 'ROLLED_BACK', updated_at = now()
        where id = %s and status = 'APPLIED'
        """,
        (batch_id,),
    )
    batch_updated = cur.rowcount
    return {
        "before": before,
        "provenanceDeleted": provenance_deleted,
        "customerDeleted": customer_deleted,
        "personDeleted": person_deleted,
        "batchUpdated": batch_updated,
    }


def write_receipt(output: Path, payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    payload["receiptSha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload["receiptSha256"]


def synthetic_rehearsal(cur: Any) -> dict[str, Any]:
    """Exercise insert/delete ordering without persisting any synthetic row."""

    cur.execute("savepoint smartgift_synthetic_rehearsal")
    batch_id = str(uuid.uuid4())
    person_id = str(uuid.uuid4())
    customer_id = str(uuid.uuid4())
    provenance_id = str(uuid.uuid4())
    source_sha256 = "a" * 64
    snapshot_sha256 = "b" * 64
    cur.execute(
        "insert into zuri_core.person (id, code, display_name, email) values (%s, %s, %s, null)",
        (person_id, f"PER-SG-ROLLBACK-REHEARSAL-{person_id[:8]}", "Rollback rehearsal"),
    )
    cur.execute(
        """
        insert into zuri_core.customer (
          id, code, tenant_id, business_id, person_id, display_name
        ) values (%s, %s, %s, %s, %s, %s)
        """,
        (
            customer_id,
            f"CUS-SG-ROLLBACK-REHEARSAL-{customer_id[:8]}",
            EXPECTED_TENANT_ID,
            EXPECTED_BUSINESS_ID,
            person_id,
            "Rollback rehearsal",
        ),
    )
    cur.execute(
        """
        insert into zuri_core.customer_import_batch (
          id, contract_id, mission_id, version_id, tenant_id, business_id,
          source_ref, snapshot_sha256, source_row_count, publish_row_count,
          held_row_count, status, approved_by_person_id
        ) values (%s, %s, %s, %s, %s, %s, %s, %s, 1, 1, 0, 'APPLIED', %s)
        """,
        (
            batch_id,
            EXPECTED_CONTRACT_ID,
            EXPECTED_MISSION_ID,
            EXPECTED_VERSION_ID,
            EXPECTED_TENANT_ID,
            EXPECTED_BUSINESS_ID,
            "SMARTGIFT_ROLLBACK_REHEARSAL",
            snapshot_sha256,
            "c82690eb-84e8-48a8-8a28-fe3d839c2276",
        ),
    )
    cur.execute(
        """
        insert into zuri_core.customer_import_provenance (
          id, batch_id, source_system, source_table, source_record_key,
          source_row, source_sha256, snapshot_sha256, idempotency_key,
          resolution_status, match_method, disposition, person_id, customer_id
        ) values (%s, %s, 'SMARTGIFT_DUCKDB', 'customer', 'ROLLBACK-REHEARSAL',
                  1, %s, %s, %s, 'NEW_CANDIDATE', 'NONE', 'PUBLISH', %s, %s)
        """,
        (
            provenance_id,
            batch_id,
            source_sha256,
            snapshot_sha256,
            f"SMARTGIFT_DUCKDB|customer|ROLLBACK-REHEARSAL|{snapshot_sha256}",
            person_id,
            customer_id,
        ),
    )
    before = counts(cur, batch_id)
    cur.execute("savepoint smartgift_synthetic_rollback")
    result = rollback_statements(cur, batch_id)
    cur.execute("rollback to savepoint smartgift_synthetic_rollback")
    restored = counts(cur, batch_id)
    cur.execute("rollback to savepoint smartgift_synthetic_rehearsal")
    cur.execute("release savepoint smartgift_synthetic_rehearsal")
    if before != restored:
        raise RuntimeError("synthetic rollback rehearsal did not restore the batch state")
    return {
        "batchId": batch_id,
        "before": before,
        "result": result,
        "restored": restored,
        "syntheticRowsPersisted": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-id")
    parser.add_argument("--synthetic-rehearsal", action="store_true")
    parser.add_argument("--rehearse", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-rollback", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if not args.batch_id and not args.synthetic_rehearsal:
        print(json.dumps({"status": "REFUSED", "reason": "PASS --batch-id OR --synthetic-rehearsal"}))
        return 2
    if args.synthetic_rehearsal and (args.batch_id or args.apply or args.rehearse or args.confirm_rollback):
        print(json.dumps({"status": "REFUSED", "reason": "SYNTHETIC_REHEARSAL_CANNOT_COMBINE_WITH_BATCH_FLAGS"}))
        return 2
    if args.apply and not args.confirm_rollback:
        print(json.dumps({"status": "REFUSED", "reason": "PASS --confirm-rollback WITH --apply"}))
        return 2
    if args.rehearse and args.apply:
        print(json.dumps({"status": "REFUSED", "reason": "CHOOSE --rehearse OR --apply"}))
        return 2

    connection = psycopg2.connect(connection_string())
    try:
        connection.autocommit = False
        with connection.cursor() as cur:
            if args.synthetic_rehearsal:
                result = synthetic_rehearsal(cur)
                connection.commit()
                payload = {
                    "status": "ROLLBACK_REHEARSAL_PASSED",
                    "mode": "SYNTHETIC_TRANSACTION_ROLLBACK",
                    "result": result,
                    "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
                output = args.output or DEFAULT_OUTPUT_DIR / "customer-backfill-rollback-rehearsal.json"
                receipt_sha256 = write_receipt(output, payload)
                print(json.dumps({
                    "status": payload["status"],
                    "output": str(output),
                    "receiptSha256": receipt_sha256,
                    "syntheticRowsPersisted": False,
                }))
                return 0
            batch = require_batch(cur, args.batch_id)
            before = counts(cur, args.batch_id)
            if not args.rehearse and not args.apply:
                connection.rollback()
                payload = {
                    "status": "ROLLBACK_READY_READ_ONLY",
                    "batch": batch,
                    "counts": before,
                    "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
            elif args.rehearse:
                cur.execute("savepoint smartgift_rollback_rehearsal")
                result = rollback_statements(cur, args.batch_id)
                cur.execute("rollback to savepoint smartgift_rollback_rehearsal")
                after = counts(cur, args.batch_id)
                cur.execute("release savepoint smartgift_rollback_rehearsal")
                connection.commit()
                if before != after:
                    raise RuntimeError("rollback rehearsal did not restore the original batch state")
                payload = {
                    "status": "ROLLBACK_REHEARSAL_PASSED",
                    "batch": batch,
                    "result": result,
                    "restoredCounts": after,
                    "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
            else:
                result = rollback_statements(cur, args.batch_id)
                connection.commit()
                payload = {
                    "status": "ROLLED_BACK",
                    "batch": batch,
                    "result": result,
                    "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                }

        output = args.output or DEFAULT_OUTPUT_DIR / (
            f"customer-backfill-rollback-{args.batch_id}.json"
        )
        receipt_sha256 = write_receipt(output, payload)
        print(json.dumps({
            "status": payload["status"],
            "batchId": args.batch_id,
            "output": str(output),
            "receiptSha256": receipt_sha256,
        }))
        return 0
    except Exception as error:
        connection.rollback()
        print(json.dumps({"status": "FAILED", "code": type(error).__name__}))
        return 1
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
