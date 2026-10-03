# Canonical index writer ordering

## Symptom

Adding an explanatory link outside a canonical record's preserved row makes its
derived file hash stale. The initial `--write` implementation refused instead of
refreshing the index, although the source row and its provenance were unchanged.

## Evidence

`writeProjections` called `loadRecords`, which compared the file digest with the
old index before generating the replacement index. `buildIndex` then hashed a
reconstructed wrapper rather than the actual authored canonical file. Inspection
of both call sites establishes that explanatory edits could not be regenerated.

## Root cause

The read-only freshness rule was reused in the writer, and bootstrap rendering
was reused as the hash source after bootstrap. This conflated a derived current
file digest with the immutable imported row's provenance.

## Why the issue escaped detection

The initial fixtures tested pristine extraction and parser refusal. They did not
exercise an explanatory edit followed by the documented `--write` workflow.

## Proposed prevention

Allow only the writer to refresh the derived file hash after parsing and checking
the canonical identity and preserved row. Hash the actual canonical file. Keep
readers/check mode strict and retain source-row mismatch refusal in both modes.
Test edit → stale refusal → regeneration → stable export, plus a changed-row refusal.
