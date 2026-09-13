---
description: Show who this device is paired to for zuri-ai usage reporting
allowed-tools: Bash(node:*)
---

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/zuri-harness.mjs" whoami
```

Relay its output exactly. It prints either the paired person, device label, harness, status and installation, or "not paired — run /zuri-harness:pair". If it reports the credential is no longer valid, tell the user to run `/zuri-harness:pair` again.
