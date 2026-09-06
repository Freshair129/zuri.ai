---
id: "MODEL-CARD-QWEN35-4B"
model: "qwen3.5:4b"
role: "rejected"
status: "rejected 2026-08-20"
last_measured: "2026-08-20"
---

# qwen3.5:4b

Rejected for being slower than the 9B it was meant to help.

| | |
| --- | --- |
| Tag | `qwen3.5:4b` |
| Installed here | **No.** Not present on this machine as of 2026-09-04 |

## Measured

| Date | Result |
| --- | --- |
| 2026-08-20 | Works, but **p50 39.7s** |

## Why it was rejected

39.7s is well past the 25s reply-token ceiling, and slower than `qwen3.5:9b`'s 19.2s at the time.
A smaller model that is slower than the larger one removes the only reason to reach for it.

Finding 2 in `LOCAL-MODEL-SELECTION.md` records the related surprise: pinning this 3.1 GB model
still evicted the resident 9B on a 12 GB card, so "small enough to sit alongside" did not hold
either. Size was not buying what it was supposed to buy.

## Not measured

- Anything since 2026-08-20, including with the trimmed evidence that took the 9B from 5/8 to 8/8.
- Whether the latency was context-related. Round 4 established every run of that era was at 4,096
  regardless of what was requested, and this model was never re-run with a context that took
  effect.
