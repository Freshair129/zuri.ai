# Canonical membership and query evidence validation

## Symptom

The canonical loader accepted a reverse feature membership that disagreed with
the feature row. Query loading also accepted a missing indexed record digest,
and impact queries counted recognized edges whose endpoint nodes did not exist.

## Evidence

The registry regression copies FEAT-009 and its two FR records, changes FR-091's
feature_id and matching index metadata/hash to FEAT-999, and initially fails with
`Missing expected exception`. Independent review reproduced a ghost implements
edge counted as evidence. Query index loading conditionally checked recordSha256.

## Root cause

Registry validation compared each record only with its index entry. The query
loader duplicated only some registry checks. Evidence filtering treated an absent
node namespace as acceptable without requiring the node itself to exist.

## Why the issue escaped detection

Fixtures used internally consistent records and well-formed graph endpoints;
they did not mutate metadata and index together or omit the derived digest.

## Proposed prevention

Validate bidirectional FEAT/FR membership centrally; route queries through that
strict registry reader. Missing endpoints remain navigable as unverified edges,
but cannot count as evidence. Exercise each refusal with a regression fixture.

The v2 pinned-blob reader had the same reverse-membership omission. A committed
fixture with a consistent but false feature_id reproduced successful capture;
the v2 reader now checks membership and indexed metadata, with v1 unchanged.
The generated OpenAPI schema already exposes both versions; its old single-version
assertion failed and is updated to verify the additive public contract.

Selected Node test commands used npm exec with --prefix, which does not change
the process working directory as npm run does. Direct Node argv now carries an
explicit cwd, and the displayed PowerShell command sets/restores that directory.
A subprocess regression actually executes a selected test and asserts its cwd.

A directory-junction fixture also reproduced an outside-root test being offered
as runnable: lexical containment followed by stat followed symlinks. The query
now checks realpath containment as well. A Windows junction/POSIX symlink fixture
verifies outside targets are reported as unavailable and generate no command.
