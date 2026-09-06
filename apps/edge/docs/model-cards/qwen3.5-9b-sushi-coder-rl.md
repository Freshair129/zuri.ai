---
id: "MODEL-CARD-SUSHI-CODER-9B"
model: "hf.co/bigatuna/Qwen3.5-9b-Sushi-Coder-RL-GGUF:Q4_K_M"
role: "rejected"
status: "rejected 2026-09-03"
last_measured: "2026-09-03"
---

# Qwen3.5-9b-Sushi-Coder-RL

The interesting rejection: **three times faster than the model it would have replaced, and still
not shippable.**

| | |
| --- | --- |
| Tag | `hf.co/bigatuna/Qwen3.5-9b-Sushi-Coder-RL-GGUF:Q4_K_M` |
| Architecture | `qwen35`, 8.95B, `Q4_K_M` |
| Capabilities | `completion`, `tools`, `thinking`, `vision` |
| Card's own settings | `temperature 0.6`, `top_p 0.95`, `top_k 20`; **`max-model-len 4096`**; multimodal, expects a `BF16-mmproj.gguf` alongside |

## Measured

| Turns | answered | called tool | usable | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| 8 | 8/8 | **5/8** | **3/8** | 6.6s | **8.2s** |

p95 8.2s against the core model's 21.7s at the time — it would have left 17 seconds of the reply
token instead of 8.

## Why it was rejected

**It skipped the catalog on three turns in eight.** It answered a product question without looking
anything up. For a sales agent that is the wrong failure: fluency was never the bottleneck,
consulting the price list is.

`unverifiedNumbers()` catches any figure that appears in neither the tool evidence nor the
customer's own words, so an ungrounded answer degrades to a pattern reply rather than reaching a
customer as an invented price. That makes this a quality problem rather than a correctness one —
and still not shippable, because three turns in eight fall back.

It is also a **coder** fine-tune being asked to do retrieval-grounded Thai sales, which is visible
in the result.

## Run-to-run instability, and why the bar is eight turns

Three four-turn runs on identical input gave **4/4, 2/4 and 2/4** answered, before the eight-turn
run gave 8/8. Any of those samples taken alone would have supported a different conclusion — and
one of them briefly did, in a report that had to be walked back.

## Settings tried and rejected

**Running it at its declared `max-model-len 4096`** changed nothing: 2/4 either way. That was
originally read as "a real mismatch, but not the fault" — which was wrong, and wrong for an
instructive reason. `/v1/chat/completions` ignores `options.num_ctx` entirely, so **both arms of
that comparison ran at 4096**. The test could not have moved the number. See
`LOCAL-MODEL-SELECTION.md` round 4.

## Not measured

- Anything at a context that actually took effect. Every run here was at 4,096 whatever was asked
  for; it has never been tried with `num_ctx` baked into the tag the way `qwen3.5:9b` now is.
- Its own card's sampling values (`temperature 0.6`). The runs used the adapter's defaults.
- The `BF16-mmproj.gguf` companion its card calls for. Never supplied, and the effect of its
  absence on text-only use was not investigated.
