---
description: Remove this device's local zuri-ai pairing (does not revoke it server-side)
allowed-tools: Bash(node:*)
---

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/zuri-harness.mjs" unpair
```

Relay its output. Make clear to the user that this only deletes the local credential file on this machine — the device still appears on the harness device list server-side until an installation operator revokes it there. If they want it fully revoked, tell them to ask an operator to revoke this device from that list.
