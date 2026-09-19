---
id: "ZAI:FR-258-NOTE"
title: "Inference pool operations projection"
version: "0.1.1b"
status: approved
approval_scope: design-and-documentation
approved_on: "2026-09-18"
approved_by: "Owner via conversation"
integration_status: pending
implementation_status: not-started
created_at: "2026-09-17"
last_update: "2026-09-18"
author: ChatGPT
domain: platform-control
baseline_commit: "cfd5521e7d004e63ffead1e07f46045f1cdc06f2"
feature: FR-258
module: platform-control
source: pending
relations:
  - type: references
    target: "ZAI:FR-258"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
  - type: references
    target: "ZAI:FR-257"
---

# FR-258 — Inference pool operations projection

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


## Behavior and ownership

Platform Control provides a removable, installation-operator-only operational projection of the inference pool. It reads Integration's redacted node/observation contracts and Agent's capacity/attempt summaries. It does not become the source of truth for connection state, secrets, capacity leases, LINE jobs or model selection.

The owning charter currently requires Identity's `isInstallationOperator` for `/control/**`; a Business owner or a role label alone grants no access. Preserve that guard. Business-facing pool selection remains in Integration and LINE OA Studio under their own scoped authorization.

The critical health collector and router are defined by [[ZAI:FR-257-NOTE]], not this removable dashboard. A dashboard outage cannot stop a healthy scheduler, and a healthy dashboard cannot override stale scheduler observations.

## Input, output and failures

### Proposed surface

`/control/inference` under PlatformControlShell, plus a bounded operator read endpoint registered to this lane. Show operational aggregates only: opaque node code, expected/observed model profile, administrative state, readiness, observation age, running/waiting counts, reserved slots/tokens, KV ratio, bounded error category and calibration status. Do not include prompt/response text, raw LINE IDs, Business documents, keys, database connection strings or unredacted provider errors.

A management link must reauthorize through Integration; it does not inherit secret access from this projection. Drain/resume actions delegate to the owning audited service and require the appropriate capability. No host reboot, arbitrary shell command, GPU clock adjustment, remote model loading or restart endpoint exists in this requirement.

### Truthful display rules

| Observed condition | Thai presentation intent |
|---|---|
| Eligible and calibrated | พร้อมรับงาน |
| Administrative drain | กำลังหยุดรับงานใหม่ |
| Running/waiting high or reservation cap reached | งานเต็ม / กำลังรอคิว |
| Last sample stale | ข้อมูลสถานะเก่า — ไม่ยืนยันว่าพร้อม |
| Credential refused | ตรวจสิทธิ์ไม่ผ่าน |
| Model/profile mismatch | โมเดลไม่ตรงกับที่กำหนด |
| Metric/exporter absent | ไม่มีข้อมูล — never show zero |
| Request outcome uncertain | ยังยืนยันผลการประมวลผลไม่ได้ |

Readiness, utilization and configured state remain separate fields. Show `observedAt/receivedAt`, units and provenance. Do not show nominal 12+16 GB as one 28 GB model device. Counters mean requests or reservations, not registered users or guaranteed concurrency.

### History and alerting

Phase one persists the latest bounded observation and redacted state transitions using the existing audit/error conventions; it does not write every two-second sample as a new SQL history row. Optional Prometheus/Grafana can provide bounded time-series history later. vLLM exposes production metrics, and an official Prometheus/Grafana example exists; use a version-tested configuration rather than copying unpinned manifests. [V4] [V5]

Operational alerts, when enabled, use a configured recipient/channel and a deduplicated state transition: unavailable pool, repeated auth failure, sustained deadline misses, or stale observer. Repeated polling must not create alert storms. Recovery is a separate event. No automatic alert delivery or channel provisioning is performed by this document.

If no notification integration is configured, the console must say notifications are not configured; a red badge is not evidence a human was notified. Alert transport is not a dependency of routing correctness.

### Optional hardware telemetry

Temperature, power, GPU utilization and device-memory counters require an independently configured hardware collector/exporter. They are not assumed to come from vLLM's inference metrics. Mark absent values unsupported/unavailable. The exporter has read-only host-metric access and no Zuri Business data, model prompts, LINE keys or tool-execution privileges. Hardware observations are diagnostics; operating-system shutdown/recovery remains operator tooling. NVIDIA documents the available `nvidia-smi` queries, which vary by GPU/driver. [V6]

## Acceptance criteria

- MON-01: Non-operators cannot read deployment-wide node/attempt data; Business roles do not substitute for `isInstallationOperator`.
- MON-02: Unknown/stale/unverified values are labeled explicitly with sample age, not zero/green.
- MON-03: The projection can be removed without deleting pools, stopping the observer/router, changing grants or losing LINE state.
- MON-04: Viewing or filtering the console performs no model request, tool call or LINE send.
- MON-05: Drain/resume uses owner services with fresh permission/version checks; the UI cannot bypass a revoked node/profile.
- MON-06: Alerts are deduplicated, bounded and truthfully report disabled/unconfigured delivery; no automatic restart is triggered by the display.
- MON-07: Hardware metrics remain unavailable unless a separately authorized exporter actually reports them.
- MON-08: Metrics/history retention and labels contain no conversation payload or secrets; high-cardinality request IDs belong in the existing controlled trace, not metric labels.

[V4]: https://docs.vllm.ai/en/stable/usage/metrics/
[V5]: https://docs.vllm.ai/en/stable/examples/observability/prometheus_grafana/
[V6]: https://docs.nvidia.com/deploy/nvidia-smi/index.html

## Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/platform-control/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/platform-control/CHARTER.md) — Operator-only removable projections; no critical Business authority.
- [docs/domains/integration/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/integration/CHARTER.md) — Provider/credential ownership, management surfaces, production-provider restrictions.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |
