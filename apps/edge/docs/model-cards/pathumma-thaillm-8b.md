---
id: "MODEL-CARD-PATHUMMA-8B"
model: "pathumma-thaillm-8b"
role: "fallback"
status: "recorded in round 1; not re-measured since"
last_measured: "2026-08-20"
---

# pathumma-thaillm-8b

The named fallback. Thai-native, tools work, close second on the only run it has ever had.

| | |
| --- | --- |
| Tag | `pathumma-thaillm-8b` |
| Role | fallback in `LOCAL-MODEL-SELECTION.md`'s decision table |
| Installed here | **No.** Not present on this machine as of 2026-09-04 |

## Measured

| Date | Conditions | answered | called tool | correct price | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-20 | ollama 0.32.14 | 7/8 | 8/8 | 7/8 | 21.1s | **27.9s** |

**p95 27.9s is over the 25s reply-token ceiling.** A fallback that cannot answer inside the token
is a fallback to the ack-and-push path, not to a reply — worth knowing before relying on it.

It returned empty once despite a successful tool call. In production that falls through to the
deterministic reader, so the customer still gets an answer; it is a pattern reply, not a model one.

## Provenance — read this before quoting the numbers

**Every figure above is inherited from the round 1 measurement and has not been re-verified.** Two
things have changed since, both of which moved the core model's numbers materially:

- ollama 0.32.14 → 0.33.2
- the evidence sent to the model was cut by 81% (`compactSearchForModel`), which took `qwen3.5:9b`
  from 5/8 to 8/8 answered

Neither change has been applied to a run of this model, because it is not installed. The row above
describes a machine state that no longer exists.

Round 4 also established that `options.num_ctx` never took effect on `/v1`, so this run was at
ollama's default 4,096 whatever was asked for — the same trap that produced the core model's
regression. Finding 1 in `LOCAL-MODEL-SELECTION.md` separately notes that ollama chose
`num_ctx: 40960` for this model on its own, taking 11 GB and spilling off the card; at 8,192 it
takes 6.1 GB at 100% GPU.

## Before relying on it

```bash
ollama pull pathumma-thaillm-8b
# then bake the context in, as qwen3.5:9b needed — /v1 will not carry it
npm run model:benchmark -- --model pathumma-thaillm-8b
```

Two models do not stay resident together on a 12 GB card — finding 2 records that pinning the
second evicted the first every time, verified with `ollama ps`. That is why the fallback exists for
a *broken* core model rather than for speed: it is never warm, so it always pays a cold load.

## Not measured

- Anything since 2026-08-20.
- Behaviour with the trimmed evidence, which is the change most likely to move its numbers.
- Whether a fallback that exceeds the reply token is worth having, versus going straight to
  ack-and-push.
