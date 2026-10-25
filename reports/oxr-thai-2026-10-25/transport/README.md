# E5 byte transport

This package preserves the four tracked source files that the immutable E5
manifest sealed before Git's declared `text/eol=lf` normalization. Each
content-addressed `.bytes` file is an exact copy of the sealed working-tree
bytes; `transport-manifest.json` maps it to the source path, original length
and SHA-256, and the expected CRLF-to-LF form.

The report subtree uses `reports/oxr-thai-2026-10-25/.gitattributes` with
`* -text -eol`. The default report whitespace policy is
`blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol`: Git treats CR as an
end-of-line marker and continues checking the other whitespace classes.
`*.bytes -diff` treats immutable snapshots as opaque objects. Six exact,
pre-existing findings in sealed source files need narrow exceptions so
`git diff --check` does not force edits to the evidence:

| Exact file | Existing finding | Disabled check |
|---|---|---|
| `hyper-extraction-repair-v1/source_native.py` | Line 349 has trailing spaces | `blank-at-eol` only |
| `hyper-relation-audit-v1/evidence-adapter-v2.mjs` | Line 422 has an extra blank line at EOF | `blank-at-eof` only |
| `hyper-relation-audit-v1/evidence-adapter-v2.test.mjs` | Line 374 has an extra blank line at EOF | `blank-at-eof` only |
| `hyper-relation-audit-v1/evidence-adapter-v3.mjs` | Line 497 has an extra blank line at EOF | `blank-at-eof` only |
| `hyper-relation-audit-v1/evidence-adapter.mjs` | Line 411 has an extra blank line at EOF | `blank-at-eof` only |
| `hyper-relation-audit-v1/evidence-adapter.test.mjs` | Line 357 has an extra blank line at EOF | `blank-at-eof` only |

Every other listed whitespace check remains enabled for each file. No source
bytes are edited. These narrow rules keep existing evidence files byte-exact in
Git and on checkout, including PowerShell files whose general repository rule
would otherwise materialize CRLF. Canonical documents outside this report
subtree keep the repository's LF policy. The four snapshots let the verifier
recognize only the exact LF normalization of those canonical files; any other
text change fails.

The snapshots are provenance copies, not a new source of truth. The original
E5 manifest remains unchanged at
`reports/oxr-thai-2026-10-25/e5-microbatch-v1/evidence-manifest.json` and is
bound by SHA-256 `879f517b5623411ee086d4b0dff912a888dbce297d8537cc8f4580c40ca85332`.
The original seal includes 18 portable entries and 44 `.local/` entries. A
checkout without those local files can verify the portable entries and the
four byte transports, but must report `INCOMPLETE_LOCAL_EVIDENCE`; it cannot
claim that the full 62-entry original seal was reproduced.

Run from the repository root:

```powershell
node --test reports/oxr-thai-2026-10-25/transport/verify-transport.test.mjs
node reports/oxr-thai-2026-10-25/transport/verify-transport.mjs .
```

The verifier also checks every Git-visible file under the Thai OCR report
subtree: `git check-attr` must report `text` and `eol` unset, the exact default
whitespace policy or one of the six path-scoped exceptions above, and `diff`
unset for snapshots. Git's path-aware
blob hash must equal its raw-byte blob hash. This proves the current attributes
will not rewrite the evidence bytes; after staging, a fresh checkout can run
the same command to verify the transported tree.
