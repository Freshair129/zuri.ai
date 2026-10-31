# Office contract fixtures

`stock.zip.gz` losslessly wraps the actual producer main export from commit
`b4e2d8edec9d8dbad32573d860cff3a6a27efbbd`: 1,655 entities and 17 asset
revisions. `custom.zip.gz` was built through that producer with one external
Kenney Furniture Kit rounded-back chair (CC0), measured from the original GLB;
it has 1,658 entities and 18 revisions. Archive/content/model digests and source
are in `provenance.json`. These are design fixtures with null Business/Agent
bindings. They contain no account, credential, authorization or live status.

Tests decompress to the exact ZIP bytes, exercise actual session/CSRF route
handlers and real isolated SQLite/PostgreSQL, and include a real loopback Next
HTTP journey. A fixture does not register data in a user's Business.
