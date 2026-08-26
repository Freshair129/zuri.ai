# Choosing the execution mode

Seven modes exist and no eighth will be invented for you. Each one fixes its progress
strategy, its container/item vocabulary and the evidence its progress is computed from,
so choosing the mode is choosing **what "done" will mean** for that workstream.

Print the current vocabulary before writing anything:
`node skills/zuri-execution-plan/scripts/zuri-plan.mjs vocab [--mode <MODE>]`.

## The seven

**SOFTWARE_SPRINT** — engineering delivered as tasks and defects grouped into sprints,
epics or releases. Progress is completed weight against planned weight. Pick it when the
unit of work is a task somebody closes.

**DATA_MIGRATION** — moving records between systems in stages and batches. Progress is
records processed, validated and reconciled, not tasks ticked. Pick it whenever the
honest answer to "how far are we?" is a record count.

**B2B_SALES** — named accounts and deals advancing through pipeline stages. Progress is
weighted pipeline value (`numericValue` × `probability`) against target. Pick it when
revenue is attached to identifiable counterparties.

**B2C_CAMPAIGN** — campaigns, waves and channels with creatives, audiences and
experiments. Progress is KPI attainment against spend. Pick it when the outcome is
measured in aggregate metrics rather than named deals.

**PRODUCT_LAUNCH** — launch phases whose deliverables must be ready and whose gates must
be satisfied. Progress is milestone readiness, and a required blocking gate holds the
number down on purpose. Pick it when go/no-go decisions, not throughput, govern the date.

**OPERATIONS** — recurring periods and processes: checklists, issues, SLAs. Progress is
the SLA score with backlog and incidents visible. Pick it when the work repeats forever
and a period can close with honest unfinished work in it.

**BUSINESS_EXPANSION** — standing up a new site, branch or entity: legal, location,
budget, hiring, vendors, go-live. Progress is expansion readiness across those
dimensions. Pick it when "done" means a place can operate.

## The pairs that get confused

| Looks like | Actually | Because |
|---|---|---|
| a migration run as a sprint | `DATA_MIGRATION` | progress must answer in records validated/reconciled, which `TASK_WEIGHT` cannot express |
| a launch run as a sprint | `PRODUCT_LAUNCH` | the date is governed by gates and readiness, not by task throughput |
| operations run as a sprint | `OPERATIONS` | the work recurs; a period closes with open items, and pretending otherwise fakes 100% |
| an expansion run as operations | `BUSINESS_EXPANSION` | readiness is multi-dimensional (legal/budget/hiring/vendors), not an SLA score |
| B2C treated as B2B | `B2C_CAMPAIGN` | there is no named counterparty to weight — the evidence is spend and conversion |
| a sales *project* treated as sales | `SOFTWARE_SPRINT` or `PRODUCT_LAUNCH` | building the tooling for a sales team is not a pipeline; the pipeline is the deals |

## Mixed work

One project, several workstreams, one mode each — that is the supported shape. Example:
a launch project carrying a `SOFTWARE_SPRINT` workstream for the build, a
`B2C_CAMPAIGN` workstream for the go-to-market, and a `PRODUCT_LAUNCH` workstream for
the phase gates. Do **not** flatten them into one workstream in the "closest" mode: each
would then be measured by a strategy that cannot see its evidence.

Cross-workstream ordering is expressed with `dependencies`
(`BLOCKS`, `REQUIRES`, `RELATES_TO`, `START_AFTER`, `FINISH_BEFORE`) between codes that
exist in the same envelope.

## When nothing fits

Say so. Pick the mode whose *evidence* is closest to the truth, state in your report which
part of the work that strategy cannot measure, and let the human decide. Never invent a
subtype, a metric key or a strategy pairing to make an imperfect fit look clean — the
intake will reject it, and a rejection at the boundary is cheaper than a number nobody
can trust.
