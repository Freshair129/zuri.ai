---
id: "MODEL-CARD-QWEN35-9B"
model: "qwen3.5:9b"
role: "core (local)"
status: "in use"
last_measured: "2026-09-04"
---

# qwen3.5:9b

The local answer path. Runs when the subscription-backed Codex path is unavailable.

| | |
| --- | --- |
| Tag | `qwen3.5:9b` (Ollama library) |
| Architecture | `qwen35`, 9.7B, `Q4_K_M` |
| Declared context | 262,144 — **not what it runs at**, see below |
| Capabilities | `completion`, `tools`, `thinking`, `vision` |
| Resident size | ~5.5–5.7 GB, 100% GPU on the 12 GB card |

## Measured

Eight Thai sales turns through the full tool loop, warm, against the real catalog.

| Date | Conditions | answered | called tool | usable | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-20 | ollama 0.32.14, ctx 4,096 | 8/8 | 8/8 | 8/8 | 19.2s | 21.7s |
| 2026-09-03 | ollama 0.33.2, ctx 4,096 | 5/8 | 8/8 | 4/8 | 6.6s | 14.9s |
| 2026-09-03 | + evidence trimmed | 8/8 | 6/8 | 5/8 | 7.5s | 12.6s |
| **2026-09-04** | **+ `num_ctx` baked in, ctx 8,192** | **8/8** | 6/8 | 5–6/8 | **5.7s** | **6.8s** |

The August run's `8/8 usable` has not been reproduced. Tool calling has been stable at 6–8/8
throughout; what moved was whether the model finished its answer.

## Settings that matter

```
PARAMETER num_ctx 8192
PARAMETER temperature 1
PARAMETER top_k 20
PARAMETER top_p 0.95
PARAMETER presence_penalty 1.5
```

**`num_ctx` has to be baked into the tag.** `options.num_ctx` on `/v1/chat/completions` does
nothing at all — not "under-honoured", nothing — so the model reloads at Ollama's default 4,096
after any idle timeout, `ollama stop`, or restart. The app's warmer sets it correctly at startup
via `/api/generate`, which does honour it, but the next `/v1` call that causes a reload undoes
that. A Modelfile parameter applies on every load regardless of which endpoint asked:

```bash
ollama show qwen3.5:9b --modelfile     # read the existing PARAMETER lines first
ollama create qwen3.5:9b -f Modelfile  # FROM qwen3.5:9b, same lines, + PARAMETER num_ctx 8192
```

Verify with `ollama ps` — the `CONTEXT` column is the only trustworthy reading.

**This is machine state, not code.** It lives in `~/.ollama/models`, not this repo. A fresh
`ollama pull`, or a new machine, starts back at 4,096 and needs the rebuild repeated before the
numbers above mean anything.

**`presence_penalty 1.5` is inherited, not chosen.** It was present for the round 2–4 measurements
and kept unchanged so the numbers stayed comparable. The same value measured badly on
[Ornith-1.5-9B](ornith-1.5-9b.md), but that is a different model and says nothing about this one —
here it has been in place for every run above, including the 8/8s.

## Known behaviour

**One to two turns in eight answer without calling a tool**, and on those turns the model may
offer product categories the catalog does not carry — observed suggesting เสื้อผ้า, ไฟ LED,
ของแต่งโต๊ะทำงาน and แว่นตา, none of which SmartGift sells. `unverifiedNumbers()` catches an
invented *price*; nothing catches an invented *category*.

Unchanged across a doubling of the context, which rules out the token budget and leaves the
prompt. **Three prompt-side interventions have been tried and all three were reverted:**

| Attempt | tools | answered | Outcome |
| --- | --- | --- | --- |
| Rule: search before asking | 6/8 → 8/8 | 8/8 → 4/8 | reverted (`5e5b7c5`) |
| Inline the 32 real category names | — | 8/8 → 1–5/8 | reverted (`5e5b7c5`), p50 pinned at the 25s timeout |
| Widen `search_products`' description | 7/8 → 8/8 | 8/8 → 5–8/8 | reverted; usable 13/16 against the baseline's 14/16 |

The third attempt found the actual mechanism, which is worth keeping even though fixing it did not
pay. `search_products` described itself as being for when *"the customer mentions a product type"*,
with `ร่ม` and `กระติกน้ำ` as its examples. `ของขวัญปีใหม่` is an occasion, not a product type, so
the model was reading its tools correctly and concluding — correctly, by that description — that
neither applied. The tool is semantic and handles broad briefs fine; the description was narrower
than the tool.

Widening it did raise tool calls to 8/8, and it did not help. Measured against the baseline in an
interleaved A/B (alternating within minutes, so drift cannot explain it), **usable fell from 14/16
to 13/16 and p95 roughly doubled**. That is the same shape as the first two attempts and the
reason this is now recorded as a property rather than a defect awaiting a wording fix:

> Every intervention that raises the tool-call rate costs a round trip, and the round trip costs
> more answers than the extra grounding returns. Tool-call rate is not the bottleneck — the
> baseline reaches 7/8 usable at 7/8 tools.

What has not been tried is a post-hoc guard: check a finished reply for category names absent from
the 32 and discard it the way an unverified figure is discarded. That costs nothing at inference
time, which is the constraint all three failed attempts violated. Open.

**Reasoning is emitted on most turns** (a few hundred characters) and lands in a `reasoning` field
rather than `content`. Harmless here because `content` is populated too, but see
[Ornith-1.5-9B](ornith-1.5-9b.md) for what happens when it is not.

## Not measured

- Any sampling parameter other than the inherited set. `temperature`, `top_k`, `top_p` and
  `presence_penalty` have never been varied on this model.
- `maxIterations` (4) and `max_tokens` (2000). Named as the first thing to try for the tool-call
  gap, and still untried.
- Behaviour above 8,192 context, or on hardware other than this 12 GB card.
- Concurrency. Every number is one request at a time; two customers at once has never been run.
