# Local model selection — measured, not assumed

> **Hardware:** RTX 3060 12GB · ollama 0.32.14 · measured 2026-08-20
> **Round 2:** 2026-09-03, four locally-available candidates re-checked against the same bar
> with `npm run model:benchmark`. The decision did not change.
> **Round 3:** 2026-09-03, `qwen3.5:9b` itself re-measured on ollama **0.33.2** (the numbers above
> were taken on 0.32.14). It did not reproduce — 5/8.
> **Round 4:** 2026-09-03, cause found and fixed. Back to **8/8**, and faster than the original.
> The fault was ours, not the model's — see "Round 4".
> **Round 5:** 2026-09-04, round 4's fix didn't hold — context kept slipping back to 4,096 on
> reload. Baked `num_ctx` into the model tag itself so no caller has to ask for it — see "Round 5".
> **Decision:** core `qwen3.5:9b` · fallback `pathumma-thaillm-8b`
> **Related:** `G:\Rwang\docs\SPEC--LOCAL-LLM-DISPATCH-V2.md` reached several of the
> same conclusions from the code-dispatch side.

Every number here came from running the real thing against the real server, calling
the same `quote_price` tool the sales path uses and asking in Thai. None of it is
from a model card.

Per-model detail lives in `docs/model-cards/`, one file each — what a model was measured at,
what settings it needs, and what was never tested on it. This file is the decision and how it
changed; those are the evidence behind each row.

## The decision

| | model | why |
|---|---|---|
| preferred | Codex CLI (`ZURI_HEADLESS_BIN=codex`) | answers correctly against the real catalog and bills against the signed-in plan rather than per token — not a local model, and out of scope for the tables below, which measure the *local* ladder |
| core (local) | `qwen3.5:9b` | still the best local option; see round 3 for how it currently measures |
| fallback | `pathumma-thaillm-8b` | Thai-native, tools work, close second |

The local ladder is what answers when the subscription path is unavailable. Everything measured
below is that ladder.

## What was measured

Eight identical turns per model, both pinned. `num_ctx: 8192` is what the adapter *asks* for;
round 4 established that `/v1` ignores it and every one of these runs was actually at ollama's
default 4,096. The request is recorded here as it was made, not as it landed.

| model | answered | called tool | correct price | p50 | p95 |
|---|---|---|---|---|---|
| **qwen3.5:9b** | **8/8** | 8/8 | **8/8** | **19.2s** | **21.7s** |
| pathumma-thaillm-8b | 7/8 | 8/8 | 7/8 | 21.1s | 27.9s |
| Qwen3.5-9b-Sushi-Coder-RL *(round 2)* | 8/8 | **5/8** | **3/8** | 6.6s | 8.2s |
| qwen3.5:9b *(round 3, before the fix)* | 5/8 | 8/8 | 4/8 | 6.6s | 14.9s |
| **qwen3.5:9b** *(round 4, after the fix)* | **8/8** | 6/8 | 5/8 | 7.5s | **12.6s** |
| **qwen3.5:9b** *(round 5, num_ctx baked in)* | **8/8** | 6/8 | 5–6/8 | **5.7s** | **6.8s** |

pathumma returned empty once despite a successful tool call. In production that
falls through to the deterministic reader, so a customer still gets an answer — but
it is a pattern reply, not a model one.

### Rejected, and why

| model | verdict |
|---|---|
| `qwen3.5:4b` | works, but p50 **39.7s** — slower than the 9B it would be helping |
| `chinda-qwen3-4b` | ollama: **`does not support tools`** · also leaks `<think>` into content |
| `LFM2-1.2B-RAG` | Thai output is unusable — garbled, with Devanagari characters mixed in |
| `Qwen3.5-9b-Sushi-Coder-RL` | **3× faster (p95 8.2s) and still rejected** — see below (8 turns) |
| `Ornith-1.5-9B` | loops tool calls without converging; `content` empty on tool turns (4 turns) |
| `ThaiLLM-8B-MedApp` | task-specific *medical* model — never called a tool, 0/4 (4 turns) |

Only `Qwen3.5-9b-Sushi-Coder-RL` was taken to the full eight turns; the other two failed
plainly enough at four that the remaining four would have bought nothing. Turn counts are
noted so the rows are not read as equally weighted.

### Round 2 (2026-09-03): speed is not the constraint

`Qwen3.5-9b-Sushi-Coder-RL` is the interesting rejection. It is **three times faster**
than the model it would replace — p95 8.2s against 21.7s, leaving 17 seconds of the
reply token instead of 8 — and it answered every one of the eight turns.

It was still rejected, because it **called the tool on only 5 of 8 turns**. Three
times it answered a product question without looking anything up. For a sales agent
that is the wrong failure: fluency was never the bottleneck, consulting the price
list is. `unverifiedNumbers()` (`src/answer/llm.ts`) catches any figure that is in
neither the evidence nor the customer's words, so this degrades to a pattern reply
rather than an invented price — which makes it a quality problem, not a correctness
one, and still not shippable.

It is also unstable run-to-run. Three runs on identical input gave 4/4, 2/4 and 2/4
answered before the 8-turn run gave 8/8. **This is why the bar is eight turns**: any
of those four-turn samples, taken alone, would have supported a different conclusion.

Two settings hypotheses were tested and both failed, which is worth recording so they
are not retried:

- Its card declares `max-model-len 4096` while we send `num_ctx: 8192`. Running it at
  4096 changed nothing (2/4 either way), and this was read at the time as "a real mismatch, but
  not the fault". **Round 4 showed why it changed nothing: `/v1/chat/completions` ignores
  `options.num_ctx` entirely, so both arms of that comparison ran at 4096.** The test could not
  have moved the number. The mismatch was real and it *was* part of the fault.
- `Ornith-1.5-9B`'s card recommends `presence_penalty: 1.5` for general tasks, which
  looked like the fix for its tool-call looping. It made it **worse**: with no sampling
  parameters the model answered at iteration 2 with 918 characters of good Thai; with
  the card's settings it looped all four iterations and never answered.

The variance is the model, not the configuration. No model-card setting rescued either
candidate.

### Round 3 (2026-09-03): the core model did not reproduce its own numbers

`qwen3.5:9b` was re-measured on this same hardware, same bar — eight turns, warm, `num_ctx: 8192`
— and came back **5/8 answered** where this document records 8/8.

| | answered | called tool | usable | p50 | p95 |
|---|---|---|---|---|---|
| 2026-08-20, ollama 0.32.14 | **8/8** | 8/8 | **8/8** | 19.2s | 21.7s |
| 2026-09-03, ollama 0.33.2 | **5/8** | 8/8 | **4/8** | 6.6s | **14.9s** |

Two halves moved in opposite directions, and both are worth keeping:

- **Tool calling reproduced exactly.** 8/8, unchanged. Whatever regressed, it is not the model's
  willingness or ability to reach the catalog — which is the property the fallback ladder is built
  on.
- **Answer completion did not.** Three turns called their tools and then returned empty content,
  which surfaces as `model returned no text` and falls through to the deterministic reader. The
  customer still gets a correct answer; it is a pattern reply, not a model one.

It is also materially **faster** — p95 14.9s against 21.7s, which widens the reply-token margin
from ~8s to ~15s. A regression in reliability and an improvement in latency at once is the shape
of a decoding or default change, not of a broken model.

**What this is not.** It is not evidence the original measurement was wrong. Two variables moved
between the runs — ollama 0.32.14 → 0.33.2, and the question set (round 2 onward uses the eight
Thai turns fixed in `scripts/benchmark-answer-model.ts`, which did not exist in August). Either
could account for it, and this round did not isolate which.

**What it is not either: a broken model.** Probing the same turn directly through
`/v1/chat/completions` — tool call, tool result, second turn — returned 399 characters of correct
Thai quoting TBS02-2 at 630 THB/unit and 63,000 THB for 100. The failure is intermittent, not
structural, which points at the iteration or token budget being exhausted after the tool round
rather than at the model being unable to answer.

Left unresolved at the time: `maxIterations` (4) and `max_tokens` (2000) were not varied. That
guess turned out to be the right place to look — see round 4.

**The decision still does not change**, but for a different reason than in round 2. The
subscription-backed Codex path (`ZURI_HEADLESS_BIN=codex`) answers this same question correctly and
reliably against the real catalog, and bills against the plan rather than per token. `qwen3.5:9b`
remains the best *local* option and the right fallback for when that path is unavailable — which is
what the fallback ladder was always for.

### What `reasoning` does to a tool loop

`Ornith-1.5-9B` supports tools and calls them correctly, then returns `content: ''`
with its thinking in a **`reasoning`** field — note the field name, its card says
`reasoning_content` — and issues *another* tool call instead of answering, until
`maxIterations` runs out. The adapter reads only `content`
(`src/answer/providers/openai-compatible.ts`), so this surfaces as
`model returned no text` and falls through to the pattern reader.

This is finding 3 below, met in the wild: it is the same class of problem as the
`<think>` leak, on the opposite side — there the reasoning reaches the customer, here
the answer never does.

### Round 4 (2026-09-03): the cause, and it was ours

Round 3's closing guess — the iteration or token budget, not the model — was right. Wrapping the
adapter's own `fetch` and recording every round trip ended the argument in one line:

```
round 2: prompt=3964  finish=tool_calls  content=0
round 3: prompt=4088  finish=length      content=0   completion=8
```

`finish_reason: length` at 4,088 tokens of prompt. The model had eight tokens to answer in.

Three things stacked up to produce it:

1. **The context was 4,096, not the 8,192 the adapter asks for.** `options.num_ctx` is an
   ollama-native field and `/v1/chat/completions` ignores it — `ollama ps` reports `4096` whatever
   is sent. This belongs beside `think: false` and `keep_alive` in finding 3 below: another thing
   `/v1` accepts and does nothing with. Nothing had ever verified it took effect.
2. **One `search_products` result was 11,095 characters.** Four fifths of it — `sourceRef` sha256
   hashes, internal `skuId`/`modelId`/`variantId` values, image paths — cannot appear in a sentence
   to a customer. Two search rounds of that fill a 4k window.
3. **Exhausting `maxIterations` returned an empty string by design.** A model still calling tools
   on the last pass has gathered its evidence and has no turn left to speak in.

Fixed by trimming the model's copy of the evidence (`compactSearchForModel`: 11,095 → 2,132
characters, an 81% cut) and by withholding the tools on the final iteration so an answer is the
only move left. Only the model's copy is trimmed — cards and the number check still read the full
record.

| | answered | p95 | prompt at round 2 |
|---|---|---|---|
| before | 5/8 | 14.9s | 3,964 |
| after | **8/8** | **12.6s** | **1,596** |

So the August measurement was never contradicted; the model reaches 8/8 again, and does it in
**12.6s against the original 21.7s** — the reply-token margin roughly doubles.

**What remains, and is a different problem.** Two of the eight turns now answer *without calling a
tool at all* — the same failure that got `Qwen3.5-9b-Sushi-Coder-RL` rejected in round 2, at lower
frequency. That is a prompt question, not a budget one, and it is open.

**A methodological note worth more than the fix.** Two hypotheses were tested and both were wrong
before this one was right: that the model was hiding its answer in a `reasoning` field (it was
not — direct probing returned correct Thai in `content`), and that a single oversized tool result
overflowed the window (it did not — one round fits). Both were plausible, and both were tested by
*constructing* a scenario. What actually settled it was instrumenting the real path and reading
what came back. Construct a repro only after you have observed the failure.

### Round 5 (2026-09-04): the round 4 fix didn't hold

Some time after round 4 shipped, `ollama ps` showed `qwen3.5:9b` resident at `ctx=4096`
again — the same symptom round 4 fixed, from a different angle.

Round 4 fixed the *token budget inside a call that already had 8k of context*. It did not fix
why the context itself kept slipping back to 4k. Finding 3 below already establishes that
`options.num_ctx` on `/v1/chat/completions` does nothing — not "under-honoured", nothing, on
every call, every time. The app's own warmer sets 8192 correctly at startup via `/api/generate`,
which does honour it. But the first `/v1` call that causes a *reload* afterward — an idle
timeout, `ollama stop`, a machine restart — gets Ollama's bare default instead, because nothing
on that path carries the 8k figure. Confirmed directly: stop the model, send one
`/v1/chat/completions` request with no options at all, and it reloads at 4096.

**Fix:** stop asking per request and bake it into the model. Ollama takes `PARAMETER num_ctx <n>`
in a Modelfile as the tag's own default context size — set once, it applies on every load
regardless of which endpoint asked, because the endpoint no longer has to ask.

```bash
ollama show qwen3.5:9b --modelfile     # read the existing PARAMETER lines before touching anything
ollama create qwen3.5:9b -f Modelfile  # FROM qwen3.5:9b, same PARAMETER lines, + PARAMETER num_ctx 8192
```

`ollama create` reused the existing weight layers (`using existing layer sha256:...`, no
re-download) and kept every parameter the round 2–4 numbers were measured against —
`presence_penalty 1.5`, `temperature 1`, `top_k 20`, `top_p 0.95` — unchanged. Only `num_ctx`
was added.

Verified the fix holds regardless of caller: `ollama stop qwen3.5:9b`, one bare
`/v1/chat/completions` call with zero options, then `ollama ps`. Before the Modelfile change that
sequence produced `ctx=4096`; after it, `ctx=8192`.

**What it bought.** Two runs of the eight-turn bar, back to back, after the rebuild:

| | answered | called tool | usable | p50 | p95 |
|---|---|---|---|---|---|
| run 1 | **8/8** | 6/8 | 5/8 | 5.8s | 12.7s |
| run 2 | **8/8** | 6/8 | 6/8 | 5.7s | **6.8s** |

Against the 19.2s/21.7s this document opened with, that is roughly a third of the latency, and
8/8 twice rather than once — the first time this model has answered every turn on two consecutive
runs. The reply-token margin goes from about eight seconds to over twenty.

`called tool` did not move: 6/8, exactly as in round 4. Two turns still answer without consulting
the catalog at all. That is worth stating plainly because it rules something out — the tool-calling
gap survived a doubling of the context, so it is not a budget problem and no amount of context will
close it. It belongs to the prompt, and remains open.

**What this doesn't fix.** `keep_alive` is a runtime flag, not a Modelfile parameter — it isn't
part of the model definition and can't be baked in the same way. The app's warmer still has to
pin it via `/api/generate` (`keep_alive: -1`) at startup; an idle-triggered reload elsewhere still
comes back at Ollama's default keep-alive (a few minutes), just now at the right context size
instead of the wrong one.

**Where this lives.** `ollama create` writes to the local Ollama model store
(`~/.ollama/models`), not to this repo. It is machine state, not code: a fresh `ollama pull
qwen3.5:9b`, on this machine or a new one, starts back at the bare default and needs the
Modelfile rebuild repeated. Anyone re-provisioning this stack should run the two commands above
before relying on the 8/8 numbers above.

## Three findings that shape the design

### 1. Context size decides whether the model fits the card

Ollama chose `num_ctx: 40960` for pathumma on its own. That took **11GB** and ran at
6%/94% CPU/GPU — spilling off the card. At `num_ctx: 8192` the same model takes
**6.1GB** at 100% GPU. A LINE turn never needs 40k tokens, so this is free headroom.

### 2. Only one model is resident at a time

qwen3.5:9b is 5.7GB and pathumma 6.1GB against a 12GB card. Pinning the second
**evicted the first** every time — verified repeatedly with `ollama ps`. It also
happened with the 3.1GB qwen3.5:4b, so this is not purely arithmetic.

That is why the fallback is for a *broken* core model, not for speed: it is never
warm, so it always pays a cold load.

### 3. `think: false` does not do what it looks like

Sent through `/v1/chat/completions` it is accepted and ignored. Verified two ways:

- pathumma still produced 647 characters of reasoning, in `reasoning_content`
- chinda still emitted `<think>` — and via native `/api/chat` too

The difference between those two matters. Where ollama recognises a model's thinking
capability it separates the reasoning out and the customer never sees it. Where it
does not, `<think>` is just text and **goes straight through to the reply**.

`keep_alive` behaves the same way: `/v1` returns 200 and does nothing, `ollama ps`
stays empty. Only `/api/generate` honours it, which is why warming is a separate
module. `num_ctx` is in the same family — accepted by `/v1`, silently discarded — and it
caused a real incident, not just a theoretical gap: see round 5, where it made the running
context repeatedly slip back to Ollama's bare default. Unlike `keep_alive`, `num_ctx` has a
fix: it can be baked into the model tag itself via a Modelfile, which is what round 5 did.
`keep_alive` cannot — it isn't a model property — so warming remains the only way to pin it.

## Known gaps, deliberately left

- **No `<think>` stripping in the adapter.** Not a live risk with `qwen3.5:9b`
  (8/8 clean) but it is the whole risk with a model like chinda, so anyone changing
  `ZURI_LLM_MODEL` should check this first. `SPEC--LOCAL-LLM-DISPATCH-V2 §5.1`
  describes the strip-and-fence fallback chain to copy.
- **The acknowledgement is a fixed string.** Making it conversational was tested with
  a small model as first-contact; every SLM small enough to be fast either mangles
  Thai or leaks `<think>`, and the ones that write Thai well are slower than the
  answer itself. A template keyed on question type is the cheaper answer.
- **p95 21.7s against a ~30s reply token** leaves about 8 seconds, on an idle machine
  with the model already pinned. Two customers at once will exceed it. The
  ack-and-push path exists and should probably become the default rather than the
  exception.

## How the numbers were taken

Turns were driven through `/v1/chat/completions` with the real tool schema, running
the full loop (tool call → result → answer), which is what makes them ~20s rather
than the ~3s a single completion costs. Latency was measured warm, with the model
pinned via `/api/generate` `keep_alive: -1`.

Round 2 onward this is a script rather than a procedure:

```bash
npm run rag:serve                              # the catalog must be reachable
npm run model:benchmark -- --model <name>      # 8 turns, warm, against the real catalog
```

`scripts/benchmark-answer-model.ts` pins the three conditions above and refuses to run
when the RAG service is down, rather than quietly measuring the model talking to
itself. Its verdict requires reliability **and** latency: a model that fails fast posts
an excellent p95 precisely because it never did the work.
