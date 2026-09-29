# Canonical snapshot read budget

Version: 0.1.0. Scope: approved documentation reintegration, v2 snapshot reader.

## Symptom

A local capture of the complete canonical FR/FEAT registry refused with
`DATA_INTEGRITY_UNAVAILABLE` / `verification-timeout` at the existing 20-second
verification limit. It did not issue partial VALID evidence.

## Evidence

The canonical-content revision is `eb2010143e28254b9097e3acc78310da240aed5e`.
The manifest contains 324 entries: one index, 277 FRs and 46 FEATs. The local
measurement took 20,004 ms and refused. The reader invokes `ls-tree` and `cat-file`
for each regular blob; sequential execution therefore starts 648 Git subprocesses,
plus the checkout and commit checks. The small v1/v2 fixtures passed 20 tests but
did not represent the full registry's process-start overhead.

## Root cause

The legacy two-registry reader's sequential I/O strategy was reused for hundreds
of individually stored canonical records. Correct per-file checks accumulated
enough subprocess startup time to exceed the unchanged aggregate deadline.

## Why the issue escaped detection

Format correctness tests use small repositories to exercise refusal cases quickly.
They did not measure the full migration manifest. Integration measurement before
cutover detected the capacity mismatch.

## Proposed prevention

Keep v1 execution unchanged. For v2 only, read at most four entries concurrently,
retain the same regular-file, raw-blob, hash, size and deadline checks, and wait for
each bounded group before starting the next. Add a full-size fixture to demonstrate
that the source layout remains usable within the existing budget. Record the actual
full-registry capture result in migration acceptance; never increase limits merely
to make a test pass or claim production performance from a local measurement.
