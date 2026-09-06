# Appendix B — DB Schema (DuckDB Query Registry)

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Author** | Boss |
| **Created** | 2026-08-10 |
| **Last Updated** | 2026-08-10 |
| **Approved By** | — |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-08-10 | Boss | Initial creation via RWANG doc-architect |

Parent: [`../PRD-SDD-v1.0.md`](../PRD-SDD-v1.0.md) §2.4. Source of truth for the registry itself is
`src/queries/registry.ts` — this appendix is a generated-by-hand mirror for review and traceability;
regenerate it whenever the registry changes (see `docs/.doc-graph.json` for staleness tracking via
`doc-preflight`).

There is no owned schema — DuckDB (`SMARTGIFT_DUCKDB_PATH`) is opened **read-only**, and the runtime
accepts only registered query IDs and validated parameters, never SQL text supplied by an operator,
model, LINE event, or another agent (BR-001).

## B.1 Registered queries (DR-xxx)

| ID | Query ID / version | Sensitivity | Row cap | Allowed columns |
|---|---|---|---|---|
| DR-001 | `executive_summary.v1` (1.0.0) | INTERNAL | 10 | `total_revenue`, `total_orders`, `active_customers`, `growth_rate`, `risk_flag` |
| DR-002 | `channel_performance.v1` (1.0.0) | INTERNAL | 20 | `channel_name`, `revenue`, `conversions`, `roi_ratio`, `status` |
| DR-003 | `campaign_breakdown.v1` (1.0.0) | INTERNAL | 50 | `campaign_id`, `campaign_name`, `category`, `impressions`, `conversions`, `spend`, `revenue` |
| DR-004 | `approval_queue.v1` (1.0.0) | **RESTRICTED** | 20 | `action_id`, `action_type`, `urgency`, `status`, `created_at` |

## B.2 Source tables referenced

| Query | Table | Filter | Order |
|---|---|---|---|
| DR-001 | `executive_daily_summary` | `period = ?` | — (single row) |
| DR-002 | `channel_performance_summary` | `period = ?` | `revenue DESC` |
| DR-003 | `campaign_performance_summary` | `period = ?` | `revenue DESC` |
| DR-004 | `actions_approval_queue` | `status = 'PENDING'` | `created_at ASC` |

## B.3 Parameter validation

- DR-001 / DR-002 / DR-003: `period` must be one of `today`, `yesterday`, `this_week`,
  `this_month` (defaults to `yesterday`).
- DR-004: optional `limit` must be a positive integer when supplied.
- Validation lives in each registry entry's `validateParameters()` (`src/queries/registry.ts`);
  no free-text parameter reaches the SQL template.

## B.4 Notes

- `approval_queue.v1` is the only `RESTRICTED` query and deliberately excludes any customer PII
  column — flag any future column addition to this query against [Appendix E](E-risk-matrix.md).
- Column allow-lists are enforced independently of the SQL template (BR-002) so a template change
  cannot silently widen exposure without a registry-level review.
