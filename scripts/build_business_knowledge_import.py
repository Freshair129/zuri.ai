"""Build a validated direct-Postgres import transaction for approved knowledge JSONL."""

# @req FR-047, FR-051 - reconciled import mapped to reserved production scope.
# @spec SDD-025, SDD-026, SEC-009, SEC-010
# @tested tests/python/test_build_business_knowledge_import.py

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
from typing import Any


PUBLIC_FIELDS = (
    "knowledge_id", "business_id", "knowledge_type", "product_code", "name", "category",
    "description", "unit", "sell_price", "currency", "moq", "colors", "specification",
    "source_ref", "source_sha256", "as_of", "approved_at", "is_active", "sensitivity",
    "contract_version",
)

SMARTGIFT_SOURCE_BUSINESS = "smartgift"
SMARTGIFT_TENANT_ID = "77cdbe70-3111-4a04-922a-8059be99a8b0"
SMARTGIFT_BUSINESS_ID = "834fa869-62f3-431c-a287-e9a95e91175b"
BOOTSTRAP_BATCH_ID = "948076f9-6a0-43f3-88f5-d7225345ac8a"


def _load_records(path: Path) -> tuple[list[dict[str, Any]], bytes]:
    artifact = path.read_bytes()
    records = [json.loads(line) for line in artifact.decode("utf-8").splitlines() if line]
    if not records:
        raise ValueError("business-knowledge artifact is empty")
    expected_fields = set(PUBLIC_FIELDS)
    business_products: set[tuple[str, str]] = set()
    knowledge_ids: set[str] = set()
    for record in records:
        if set(record) != expected_fields:
            raise ValueError("business-knowledge record fields do not match contract 1.0.0")
        if record["knowledge_type"] != "PRODUCT" or record["sensitivity"] != "PUBLIC":
            raise ValueError("only PUBLIC PRODUCT knowledge is importable")
        if record["contract_version"] != "1.0.0":
            raise ValueError("unsupported business-knowledge contract version")
        if record["business_id"] != SMARTGIFT_SOURCE_BUSINESS:
            raise ValueError("artifact business_id is not the approved SmartGift source code")
        sha = str(record["source_sha256"]).lower()
        if len(sha) != 64 or any(ch not in "0123456789abcdef" for ch in sha):
            raise ValueError("source_sha256 must be 64 lowercase hex characters")
        product_key = (str(record["business_id"]), str(record["product_code"]).casefold())
        if product_key in business_products:
            raise ValueError("duplicate business/product key in import artifact")
        business_products.add(product_key)
        knowledge_id = str(record["knowledge_id"])
        if knowledge_id in knowledge_ids:
            raise ValueError("duplicate knowledge_id in import artifact")
        knowledge_ids.add(knowledge_id)
    return records, artifact


def build_import_sql(data_path: Path, reconciliation_path: Path) -> str:
    records, artifact = _load_records(data_path)
    report = json.loads(reconciliation_path.read_text(encoding="utf-8"))
    if report.get("contractVersion") != "1.0.0" or report.get("status") != "READY":
        raise ValueError("reconciliation report is not READY contract 1.0.0")
    if report.get("publishableRowCount") != len(records):
        raise ValueError("reconciliation row count does not match artifact")
    digest = hashlib.sha256(artifact).hexdigest()
    if report.get("outputSha256") != digest:
        raise ValueError("reconciliation SHA-256 does not match artifact bytes")

    encoded = base64.b64encode(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    row_count = len(records)
    return f"""-- Generated public-only business knowledge import.
-- source artifact SHA-256: {digest}
-- expected rows: {row_count}
begin;
set local statement_timeout = '60s';

create temporary table zuri_business_knowledge_import
(like zuri_core.business_knowledge including defaults)
on commit drop;

insert into zuri_business_knowledge_import (
  knowledge_id, tenant_id, business_id, knowledge_type, product_code, name, category, description,
  unit, sell_price, currency, moq, colors, specification, source_ref, source_sha256,
  as_of, approved_at, is_active, sensitivity, contract_version, bootstrap_batch_id
)
select
  knowledge_id, '{SMARTGIFT_TENANT_ID}', '{SMARTGIFT_BUSINESS_ID}', knowledge_type, product_code, name, category, description,
  unit, sell_price, currency, moq, colors, specification, source_ref, source_sha256,
  as_of, approved_at, is_active, sensitivity, contract_version, '{BOOTSTRAP_BATCH_ID}'
from jsonb_to_recordset(
  convert_from(decode('{encoded}', 'base64'), 'UTF8')::jsonb
) as incoming (
  knowledge_id text, business_id text, knowledge_type text, product_code text, name text,
  category text, description text, unit text, sell_price numeric(14, 2), currency text,
  moq integer, colors text[], specification jsonb, source_ref text, source_sha256 text,
  as_of timestamptz, approved_at timestamptz, is_active boolean, sensitivity text,
  contract_version text
);

do $zuri_validation$
begin
  if (select count(*) from zuri_business_knowledge_import) <> {row_count} then
    raise exception 'business knowledge row-count mismatch';
  end if;
end
$zuri_validation$;

insert into zuri_core.business_knowledge (
  knowledge_id, tenant_id, business_id, knowledge_type, product_code, name, category, description,
  unit, sell_price, currency, moq, colors, specification, source_ref, source_sha256,
  as_of, approved_at, is_active, sensitivity, contract_version, bootstrap_batch_id
)
select
  knowledge_id, tenant_id, business_id, knowledge_type, product_code, name, category, description,
  unit, sell_price, currency, moq, colors, specification, source_ref, source_sha256,
  as_of, approved_at, is_active, sensitivity, contract_version, bootstrap_batch_id
from zuri_business_knowledge_import
on conflict (tenant_id, business_id, product_code) do update set
  knowledge_id = excluded.knowledge_id,
  knowledge_type = excluded.knowledge_type,
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  unit = excluded.unit,
  sell_price = excluded.sell_price,
  currency = excluded.currency,
  moq = excluded.moq,
  colors = excluded.colors,
  specification = excluded.specification,
  source_ref = excluded.source_ref,
  source_sha256 = excluded.source_sha256,
  as_of = excluded.as_of,
  approved_at = excluded.approved_at,
  is_active = excluded.is_active,
  sensitivity = excluded.sensitivity,
  contract_version = excluded.contract_version,
  bootstrap_batch_id = excluded.bootstrap_batch_id;

select count(*) as imported_rows from zuri_business_knowledge_import;
commit;
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--reconciliation", type=Path, required=True)
    parser.add_argument("--output-sql", type=Path, required=True)
    args = parser.parse_args()
    sql = build_import_sql(args.input, args.reconciliation)
    args.output_sql.parent.mkdir(parents=True, exist_ok=True)
    args.output_sql.write_bytes(sql.encode("utf-8"))
    print(json.dumps({"status": "READY", "outputSql": str(args.output_sql)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
