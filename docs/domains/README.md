---
doc_type: filesystem-index
status: active
version: "0.2.1"
checked_at: "2026-10-23"
checked_base_revision: "6c4d001eec5f389a80e16cf2e4dcbcd34e0515e4"
---

# Domain documentation index

This hand-maintained inventory was checked against the domain folders at the revision above. It is navigation and coverage evidence; a listed path does not approve every statement inside it.

The intended profile is one charter per confirmed domain and one linked SRS view per domain with assigned canonical requirements. See the [documentation requirements specification](../governance/DOCUMENTATION-REQUIREMENTS-SPEC.md).

| Domain folder | Identifier declared in charter | Charter | SRS in domain folder |
|---|---|---|---|
| Agent | id: ZAI:DOMAIN-AGENT | [CHARTER.md](agent/CHARTER.md) | Not present |
| Asset Management | domain_id: DOM-ASSET-MANAGEMENT | [CHARTER.md](asset-management/CHARTER.md) | [SRS.md](asset-management/SRS.md) — status string: active-foundation-proposed-complete-lifecycle |
| Commerce | domain_id: DOM-COMMERCE | [CHARTER.md](commerce/CHARTER.md) | Not present |
| CRM | id: ZAI:DOMAIN-CRM | [CHARTER.md](crm/CHARTER.md) | Not present |
| File Management | Not declared | [CHARTER.md](file-management/CHARTER.md) | Not present |
| Identity | Not declared | [CHARTER.md](identity/CHARTER.md) | Not present |
| Integration | id: ZAI:DOMAIN-INTEGRATION | [CHARTER.md](integration/CHARTER.md) | Not present |
| Inventory | domain_id: DOM-INVENTORY | [CHARTER.md](inventory/CHARTER.md) | Not present |
| Knowledge | Not declared | [CHARTER.md](knowledge/CHARTER.md) | Not present |
| LINE OA Studio | id: ZAI:DOMAIN-LINE-OA-STUDIO; domain_id: DOM-LINE-OA-STUDIO | [CHARTER.md](line-oa-studio/CHARTER.md) | [SRS.md](line-oa-studio/SRS.md) — approved, version 0.6.0b |
| Market Intelligence | Not declared | [CHARTER.md](market-intelligence/CHARTER.md) | [SRS.md](market-intelligence/SRS.md) — proposed, version 0.2.0 |
| Marketing | domain_id: DOM-MARKETING | [CHARTER.md](marketing/CHARTER.md) | Not present |
| Platform Control | Not declared | [CHARTER.md](platform-control/CHARTER.md) | Not present |
| Procurement | domain_id: DOM-PROCUREMENT | [CHARTER.md](procurement/CHARTER.md) | Not present |
| Project Manager | domain_id: project-manager (existing charter key) | [CHARTER.md](project-manager/CHARTER.md) | [SRS.md](project-manager/SRS.md) — approved linked view on 2026-10-23; separate [full-system candidate SRS](../architecture/project-manager-system/17-SRS.md) retained |

## Coverage notes

- The inventory found 15 domain folders and 15 charters. Four folders contain an SRS; eleven do not. The PM linked view is added by the documentation patch against the recorded base revision.
- No domain folder contains a PRD.md. This is not a missing-document defect by itself: the proposed profile uses PRODUCT.md, the charter, and canonical requirements by default. A separate domain PRD needs a distinct, approved outcome that those sources do not cover.
- Identifier declarations are inconsistent: some charters use an id field, some use domain_id, and several declare neither. This index preserves the exact observed field/value and does not decide which field is the domain primary key.
- The three existing domain SRS documents include local AM-RQ, LOS-RQ, or MI-RQ labels. Their lifecycle and text need source-level reconciliation before converting them into linked read views. Preserve them until each clause and consumer has been checked.
- The PM domain SRS records direct owner approval of its linked view. The wider SRS outside its domain folder remains a separate candidate proposal; its lifecycle is not promoted by that approval or this index.
- Missing SRS coverage is not permission to create empty files or infer ownership. Map exact canonical records first, then create a view only where the sources establish domain ownership.

The index deliberately does not repeat requirement statements. Each domain SRS should point to the original canonical record and its accepted amendments.

## Version diff

0.0 → 0.1.0 (2026-10-22): Adds the observed charter/SRS inventory and records
identifier and lifecycle gaps without assigning ownership or creating SRS
content.

0.1.0 → 0.2.0 (2026-10-23): recheck all domain charter identifier fields and
domain-folder SRS paths; add the proposed PM linked view and its charter's
explicit reuse of the existing `project-manager` key. Preserve the three legacy
SRS documents and the full-system PM candidate.

0.2.0 → 0.2.1 (2026-10-23): record direct owner approval of the linked PM SRS;
domain counts and the wider candidate's lifecycle are unchanged.
