---
id: "MODEL-CARDS-INDEX"
version: "0.1.0b"
status: "candidate"
owner: "zuri-edge-device"
scope: "One card per model that has been run against the sales path, measured or rejected"
created_at: "2026-09-04T09:00:00+07:00, ATHER"
last_update: "2026-09-04T09:00:00+07:00, ATHER"
approval: "reference material; the decision itself lives in LOCAL-MODEL-SELECTION.md"
---

# Model cards

One file per model that has actually been run against this repo's sales path. These are not
vendor model cards — a vendor card describes what a model can do in general, and this directory
records what it did **here**: against the real catalog, in Thai, calling the same tools the LINE
agent calls, on a machine with a 25-second reply-token ceiling.

**The decision is not made here.** `docs/LOCAL-MODEL-SELECTION.md` is the decision record and the
narrative of how it changed across five rounds. These cards are the per-model detail behind it, so
a question about one model does not require reading the whole history.

## Index

| Card | Role | Answered | p95 | Notes |
| --- | --- | --- | --- | --- |
| [gpt-5.6-luna (Codex)](gpt-5.6-luna-codex.md) | **preferred** | correct on every question tried | ~26s | Subscription-billed; not a local model |
| [qwen3.5:9b](qwen3.5-9b.md) | **core (local)** | 8/8 | 6.8s | Needs a Modelfile rebuild to hold `num_ctx` |
| [pathumma-thaillm-8b](pathumma-thaillm-8b.md) | fallback | 7/8 | 27.9s | Over the ceiling; not re-measured since round 1 |
| [Qwen3.5-9b-Sushi-Coder-RL](qwen3.5-9b-sushi-coder-rl.md) | rejected | 8/8 | 8.2s | Fast, but skipped the catalog 3 turns in 8 |
| [Ornith-1.5-9B](ornith-1.5-9b.md) | rejected | 0/3 | — | Calls tools, then never answers |
| [ThaiLLM-8B-MedApp](thaillm-8b-medapp.md) | rejected | 0/4 | — | Declares `tools`, never uses them |
| [qwen3.5:4b](qwen3.5-4b.md) | rejected | — | — | p50 39.7s — slower than the 9B it would help |
| [chinda-qwen3-4b](chinda-qwen3-4b.md) | rejected | — | — | Ollama: `does not support tools` |
| [LFM2-1.2B-RAG](lfm2-1.2b-rag.md) | rejected | — | — | Thai output unusable |

## What "answered" and "usable" mean

The columns are not interchangeable and the difference is the point:

- **answered** — the model produced text, so the customer got a model reply rather than the
  deterministic pattern reader.
- **called tool** — it consulted the catalog. A product answer that skipped this is ungrounded
  even when it reads well.
- **usable** — both of the above *and* the answer carried a figure. This is the only column that
  means the customer got what they asked for.

A model can score 8/8 on the first and still be unusable. `Qwen3.5-9b-Sushi-Coder-RL` is the
worked example: it answered every turn and skipped the price list on three of them.

## How to add a card

Run the harness rather than reading a vendor page:

```bash
npm run rag:serve                              # the catalog must be reachable
npm run model:benchmark -- --model <tag>       # 8 turns, warm, against the real catalog
```

Then copy an existing card. Two rules that keep these worth reading:

1. **Record the conditions.** Ollama version, context size as `ollama ps` actually reports it, and
   the date. Round 4 exists because a claim about `num_ctx` went unverified for two weeks.
2. **Say what was not measured.** A card that omits its gaps reads as more authoritative than the
   evidence behind it. Every card here has a "Not measured" section, and several are longer than
   the results.
