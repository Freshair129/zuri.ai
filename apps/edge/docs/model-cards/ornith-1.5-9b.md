---
id: "MODEL-CARD-ORNITH-15-9B"
model: "hf.co/ornith-ai/Ornith-1.5-9B-GGUF:Q4_K_M"
role: "rejected"
status: "rejected 2026-09-03"
last_measured: "2026-09-03"
---

# Ornith-1.5-9B

Calls the tools correctly and then never answers. The clearest example in this directory of a
model failing at the last step rather than the first.

| | |
| --- | --- |
| Tag | `hf.co/ornith-ai/Ornith-1.5-9B-GGUF:Q4_K_M` |
| Architecture | `qwen35`, 9.2B, `Q4_K_M` |
| Capabilities | `completion`, `tools`, `thinking`, `vision` |
| Card's own settings | general: `temperature 1.0`, `top_p 0.95`, `top_k 20`, **`presence_penalty 1.5`**; context up to 262,144 |
| Card's own note | **reasoning is required** — the turn opens with `<think>…</think>` and the chain-of-thought returns separately |

## Measured

| Turns | answered | called tool | usable | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| 3 | **0/3** | 3/3 | 0/3 | 14.9s | 18.6s |

Tool calling is perfect. Answering is not.

## Why it was rejected

On a tool turn it returns `content: ''`, puts its thinking in a **`reasoning`** field — note the
name; its card says `reasoning_content` — and issues *another* tool call instead of answering,
until `maxIterations` runs out. The adapter reads only `content`, so this surfaces as
`model returned no text` and falls through to the deterministic reader.

This is the mirror image of the `<think>` leak already recorded as finding 3 in
`LOCAL-MODEL-SELECTION.md`: there the reasoning reaches the customer, here the answer never does.

The p95 of 18.6s is inside the 25s budget and means nothing — it measures how quickly the model
gave up, not how quickly it answered. That trap is why `npm run model:benchmark` now refuses to
report "usable" on latency alone.

## Settings tried and rejected

**`presence_penalty: 1.5`**, the value its own card recommends for general tasks, looked like the
fix for the tool-call looping. It made it **worse**: with no sampling parameters at all the model
answered at iteration 2 with 918 characters of good Thai; with the card's settings it looped all
four iterations and never answered.

Recorded because it is counter-intuitive — and because the same value sits in `qwen3.5:9b`'s
Modelfile today without harm. A sampling value that hurts one model says nothing about another.

## Not measured

- Reading `reasoning` as a fallback when `content` is empty. That adapter change was never made,
  so it is unknown whether this model becomes usable with it.
- Its card's `temperature 1.0` / `top_k 20` in isolation. Only the full recommended set was tried,
  and only against the baseline of no parameters at all.
- More than three turns. It failed plainly enough at three that the remaining five would have
  bought nothing.
