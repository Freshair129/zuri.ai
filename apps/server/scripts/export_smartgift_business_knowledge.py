"""Export an approved, public-only SmartGift projection from DuckDB.

The source is always opened read-only. No source is publishable unless its SHA-256 appears in an
owner-reviewed approval manifest. Output is JSONL plus a reconciliation JSON artifact.
"""

# @req FR-047 - curated DuckDB export with reversible provenance and explicit approval.
# @spec SDD-025, SEC-009
# @tested tests/python/test_export_smartgift_business_knowledge.py

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any

import duckdb


PUBLIC_FIELDS = (
    "knowledge_id", "business_id", "knowledge_type", "product_code", "name", "category",
    "description", "unit", "sell_price", "currency", "moq", "colors", "specification",
    "source_ref", "source_sha256", "as_of", "approved_at", "is_active", "sensitivity",
    "contract_version",
)


def _iso(value: str) -> str:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("approval timestamps must include a timezone")
    return parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def load_approvals(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("contractVersion") != "1.0.0":
        raise ValueError("approval manifest contractVersion must be 1.0.0")
    approvals: dict[str, dict[str, Any]] = {}
    for source in payload.get("sources", []):
        sha = str(source.get("source_sha256", "")).lower()
        if len(sha) != 64 or any(ch not in "0123456789abcdef" for ch in sha):
            raise ValueError("approval source_sha256 must be 64 hex characters")
        if not str(source.get("approved_by", "")).strip():
            raise ValueError("approval approved_by is required")
        normalized = dict(source)
        normalized["approved_at"] = _iso(str(source.get("approved_at", "")))
        normalized["as_of"] = _iso(str(source.get("as_of", source.get("approved_at", ""))))
        normalized["publish_price"] = source.get("publish_price") is True
        approvals[sha] = normalized
    return approvals


def _record(**values: Any) -> dict[str, Any]:
    record = {field: values.get(field) for field in PUBLIC_FIELDS}
    if set(record) != set(PUBLIC_FIELDS):
        raise AssertionError("public projection field mismatch")
    return record


def render_jsonl(records: list[dict[str, Any]]) -> bytes:
    return "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in records
    ).encode("utf-8")


def artifact_sha256(records: list[dict[str, Any]]) -> str:
    return hashlib.sha256(render_jsonl(records)).hexdigest()


def extract_records(connection: duckdb.DuckDBPyConnection, business_id: str, approvals: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if not approvals:
        return []
    approved_hashes = sorted(approvals)
    placeholders = ",".join("?" for _ in approved_hashes)
    records: list[dict[str, Any]] = []

    catalog_rows = connection.execute(
        f"""
        select c.source_sha256, c.page_no, trim(c.code), trim(c.name), nullif(trim(c.brand), '')
        from catalog_sku c
        join catalog_source s on s.source_sha256 = c.source_sha256
        where lower(c.source_sha256) in ({placeholders})
          and s.sellable = true and s.status = 'extracted'
          and c.code is not null and trim(c.code) <> ''
          and c.name is not null and trim(c.name) <> ''
        order by c.source_sha256, c.code, c.page_no
        """,
        approved_hashes,
    ).fetchall()
    for sha, page_no, code, name, brand in catalog_rows:
        approval = approvals[sha.lower()]
        records.append(_record(
            knowledge_id=f"{business_id}:catalog:{sha.lower()}:{code}", business_id=business_id,
            knowledge_type="PRODUCT", product_code=code, name=name, category=brand,
            description=None, unit=None, sell_price=None, currency=None, moq=None, colors=[],
            specification={}, source_ref=f"duckdb:catalog_sku:{sha.lower()}:page:{page_no or 0}",
            source_sha256=sha.lower(), as_of=approval["as_of"], approved_at=approval["approved_at"],
            is_active=True, sensitivity="PUBLIC", contract_version="1.0.0",
        ))

    product_rows = connection.execute(
        f"""
        select lower(source_sha256), source_row, trim(product_code), trim(name),
               nullif(trim(unit), ''), nullif(trim(category), ''), nullif(trim(description), ''),
               unit_price
        from stg_product
        where lower(source_sha256) in ({placeholders})
          and product_code is not null and trim(product_code) <> ''
          and name is not null and trim(name) <> ''
        order by source_sha256, product_code, source_row
        """,
        approved_hashes,
    ).fetchall()
    for sha, source_row, code, name, unit, category, description, unit_price in product_rows:
        approval = approvals[sha]
        records.append(_record(
            knowledge_id=f"{business_id}:product:{sha}:{code}", business_id=business_id,
            knowledge_type="PRODUCT", product_code=code, name=name, category=category,
            description=description, unit=unit,
            sell_price=float(unit_price) if approval["publish_price"] and unit_price is not None else None,
            currency="THB" if approval["publish_price"] and unit_price is not None else None,
            moq=None, colors=[], specification={},
            source_ref=f"duckdb:stg_product:{sha}:row:{source_row}", source_sha256=sha,
            as_of=approval["as_of"], approved_at=approval["approved_at"], is_active=True,
            sensitivity="PUBLIC", contract_version="1.0.0",
        ))

    by_code: dict[str, dict[str, Any]] = {}
    duplicates: set[str] = set()
    for record in records:
        key = record["product_code"].casefold()
        if key in by_code:
            duplicates.add(record["product_code"])
        else:
            by_code[key] = record
    if duplicates:
        raise ValueError(f"duplicate approved product codes require reconciliation: {sorted(duplicates)[:10]}")
    return sorted(records, key=lambda row: (row["product_code"].casefold(), row["source_sha256"]))


def reconciliation(connection: duckdb.DuckDBPyConnection, records: list[dict[str, Any]], approvals: dict[str, dict[str, Any]]) -> dict[str, Any]:
    price_stats = connection.execute(
        "select count(*), count(approved_at), count(approved_by) from price_staging"
    ).fetchone()
    digest = artifact_sha256(records)
    return {
        "contractVersion": "1.0.0",
        "status": "READY" if records else "BLOCKED_APPROVAL",
        "approvedSourceCount": len(approvals),
        "publishableRowCount": len(records),
        "outputSha256": digest,
        "sourceChecks": {
            "catalog_sku": connection.execute("select count(*) from catalog_sku").fetchone()[0],
            "stg_product": connection.execute("select count(*) from stg_product").fetchone()[0],
            "price_staging": price_stats[0],
            "price_staging_with_approved_at": price_stats[1],
            "price_staging_with_approved_by": price_stats[2],
        },
        "excludedTables": ["customer", "stg_contact", "stg_doc", "interaction"],
        "excludedFields": ["buy_price", "buy_price_vat", "margin_thb", "margin_pct"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duckdb", type=Path, required=True)
    parser.add_argument("--business-id", required=True)
    parser.add_argument("--approval-manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--reconciliation", type=Path, required=True)
    args = parser.parse_args()

    approvals = load_approvals(args.approval_manifest)
    connection = duckdb.connect(str(args.duckdb.resolve()), read_only=True)
    try:
        records = extract_records(connection, args.business_id, approvals)
        report = reconciliation(connection, records, approvals)
    finally:
        connection.close()
    args.reconciliation.parent.mkdir(parents=True, exist_ok=True)
    args.reconciliation.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if records:
        if args.output is None:
            raise ValueError("--output is required when approved records exist")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(render_jsonl(records))
    print(json.dumps(report, ensure_ascii=False))
    return 0 if records else 2


if __name__ == "__main__":
    raise SystemExit(main())
