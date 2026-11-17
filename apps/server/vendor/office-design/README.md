# Pinned Visual Office verifier

Source: Freshair129/zuri-visual-office, commit
`b4e2d8edec9d8dbad32573d860cff3a6a27efbbd`. `provenance.json` records source
input hashes, bundle/archive/schema hashes, esbuild and Three.js versions.
`verifier.mjs` is an offline bundle of trusted producer source and Three.js
0.180.0; `archive.mjs` and `schema.json` preserve the producer bytes. The Three.js
MIT license is included. No code from a handoff is loaded or executed.

Rebuild from that exact clean producer checkout:
`node scripts/vendor-office-design.mjs <producer-checkout>` from `apps/server`.
The script checks the revision and Three.js version; no fetch/install occurs.
The receiver additionally pins the actor GLB digest and preflights the fixed
workflow catalog before invoking the preserved producer semantic validator.
Changing the pin/catalog is a contract review, not an automatic package upgrade.
Git attributes preserve the literal hashed bytes across platforms; the generated
verifier retains upstream comment whitespace instead of editing the pinned bundle.

Re-obtaining the source and reviewing a bump: the pinned revision is reachable
only from `archive/main` of `https://github.com/Freshair129/zuri-visual-office.git`
(not from `Freshair129/visual-office`). The commands, the review steps a pin
change requires and the owner-approval rule are in
`docs/architecture/2026-10-22-visual-office-zuri-client-design.md` §12.4.
`tests/unit/office-design-current-producer.test.js` records how the current
producer compares with this pin.
