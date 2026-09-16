---
description: Pair this Claude Code device with zuri-ai for usage reporting (ADR-087, FR-220)
allowed-tools: Bash(node:*)
---

Run the pairing CLI and relay its output to the user exactly as printed:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/zuri-harness.mjs" pair --server <url> [--harness claude-code|codex] [--label <device-name>] [--ai-account <label>]
```

- If the user gave a server URL (e.g. an ngrok URL or `https://app.zuri.ai`), use it for `--server`. Otherwise ask for it before running the command — pairing cannot start without one.
- Default `--harness` is `claude-code`; only pass `--harness codex` if the user is explicitly pairing a Codex device from here.
- The command prints an approval link and a six-character check code, then waits.
- **Tell the user to open the approval link in their browser (it may already have opened automatically), sign in if asked, and confirm the check code shown matches the one printed here before approving.** Never approve on their behalf.
- The command keeps polling until the person approves, denies, or the request expires (about 5 minutes) — let it run; do not re-invoke it while it is waiting.
- On success it prints who it paired to, the device, and the status (`ACTIVE` or `PENDING_ACTIVATION`). If `PENDING_ACTIVATION`, explain that an installation operator must activate this device from the harness device list before its usage reports are accepted — until then reports are queued locally, not lost.
- If it reports `PAIRING_BUSY_TRY_LATER`, `denied`, or `expired`, relay that plainly and suggest running `/zuri-harness:pair` again.
