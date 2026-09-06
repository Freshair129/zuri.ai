---
id: "MODEL-CARD-GPT56-LUNA-CODEX"
model: "gpt-5.6-luna via Codex CLI"
role: "preferred"
status: "in use"
last_measured: "2026-09-04"
---

# gpt-5.6-luna (via Codex CLI)

The path that actually answers when both are enabled. Not a local model, and out of scope for the
local ladder's tables — it is here because it is what customers get.

| | |
| --- | --- |
| Model | `gpt-5.6-luna` |
| Provider | `openai`, through `codex-cli` 0.151.0 |
| Reached by | `ZURI_HEADLESS_BIN=codex`, `ZURI_HEADLESS_MODEL=gpt-5.6-luna` |
| Billing | **The signed-in ChatGPT plan's monthly quota**, not per token — `codex login status` reports `Logged in using ChatGPT` |
| Reasoning | `reasoning effort: none` as configured |

Selection is not a switch: `answerConversation` checks `options.headless` before `options.llm`, so
whenever the headless path is enabled it wins and the local model becomes the fallback.

## Measured

No eight-turn benchmark run — `scripts/benchmark-answer-model.ts` drives the OpenAI-compatible
port, not the headless CLI. What exists is three questions through the real path, each verified
against the catalog by hand:

| Question | Result |
| --- | --- |
| Specific product, 100 sets | `TBS02-2` at ฿630/set, ฿63,000 total — matches the price ladder exactly |
| Vague brief ("gift set for VIP customers, 50") | Searched first, offered `TMW04-3`, `TMW04-5`, `TMN00-3` with real components, then asked for a budget |
| Product not in the catalog (a Rolex) | Said it could not find it. Invented nothing |

**~26 seconds per answer**, which is over the LINE reply-token ceiling. That is not a defect on
this path — it is why `ZURI_OUTBOX_ENABLED=true` is required alongside it: the webhook acknowledges
in ~32 ms and the answer is pushed when it exists.

The vague-brief result is the notable one. It is the same question the local model answers by
inventing categories the catalog does not carry, and this path searched first without being told
to. The prompt rule that tried to force that behaviour locally made things worse and was reverted.

## Catalog access

Codex takes MCP servers as `-c mcp_servers.<name>.*` overrides rather than a JSON config file, so
`codexMcpArgs()` builds them separately from `mcpConfig()`. The two are one fact in two encodings
and sit next to each other in `src/answer/headless.ts` for that reason.

Without them this model answers about products it cannot see — fluently, and worth nothing. That
was the observed state before the wiring existed: *"ซูริยังไม่พบรหัสและราคาชุดของขวัญ…"* for a set
priced at ฿630 in the catalog.

The tool names also have to be stated outright in the prompt. Codex surfaces every
`mcp__smartgift__*` tool on turn one, so unlike the Claude path it must **not** be told to load
them via `ToolSearch` first — that sends it after a tool that does not exist.

## Not measured

- The eight-turn bar. Comparisons against the local ladder's p50/p95 are not like-for-like.
- Latency distribution. `~26s` is a handful of observations, not a percentile.
- Behaviour when the plan's quota is exhausted. Never hit, and the fallback to the local model on
  that specific failure has never been exercised.
- Whether `reasoning effort` above `none` is affordable. Almost certainly not inside the reply
  token, but untested.
