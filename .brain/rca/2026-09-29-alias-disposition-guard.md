# Alias disposition guard

## Symptom

An explicitly approved one-target mapping could still resolve as an alias when
its disposition or an original crosswalk row said retired, dropped or split.

## Evidence

`tools/document-identity.mjs` checked split/merge only on the aggregate mapping.
The compatibility contract excludes retired and dropped mappings as well, and
the retained row provenance can carry a stricter disposition than the aggregate.

## Root cause

Cardinality/review approval was treated as sufficient without enforcing the full
lifecycle contract on both the mapping and its original rows.

## Why the issue escaped detection

The fixtures checked split/merge on the aggregate but not a conflicting row or
retired/dropped disposition with an approved-alias flag. Actual imported mappings
remain unreviewed, so no production or existing imported alias was activated.

## Proposed prevention

Reject non-alias lifecycle/cardinality dispositions at validation and resolution,
including original provenance rows. Keep regression cases for both locations.
Independent review reproduced a foreign/unknown disposition escaping a negative
keyword list. Use an explicit allowed disposition set, retaining all other
approval/cardinality/provenance requirements, and test foreign and unknown values.
