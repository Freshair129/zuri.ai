---
status: active
superseded_by: null
version: "0.1.0"
---

# Mixed canonical record export order

## Symptom

Independent review of the uncommitted reconciliation found duplicate exportOrder after a reviewed addition follows authored issuance.

## Evidence

The candidate builder recalculates v1 orders from template slots but preserves old v2 orders. On main's 494 PRD rows, an appended authored row has order 494. A subsequent reviewed FR slot moves SEC-037 to 494 while leaving that authored row at 494, although it renders at 495. The reviewer reproduced this without writes.

## Root Cause

Combining both writers retained two different sources for one generated projection order. Authored orders were assumed stable despite insertions into the preceding v1 projection.

## Why the issue escaped detection

The original writer fixtures covered imported-to-authored and imported-to-reviewed additions separately. Neither covered reviewed registration after authored issuance.

## Proposed prevention

Generate v1 order from slots and append authored records after the complete v1 projection, preserving their relative order. Render using that same generated order. Test the composed sequence and preserve existing issuance receipts as historical evidence; a changed projection must not rewrite an old receipt to make reapplication pass.
