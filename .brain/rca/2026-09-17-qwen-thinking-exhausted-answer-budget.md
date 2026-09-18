---
version: "0.1.0b"
created_at: "2026-09-17T03:18:00+07:00,RWANG"
last_update: "2026-09-17T03:18:00+07:00,RWANG"
status: beta
---

# Qwen local answer budget exhausted without visible answer

## Symptom
The exact local qwen3.5:9b Q4_K_M model returned empty visible text in all three
public synthetic smoke prompts with a 512-token ceiling, taking 7.895–8.149s.
This is model-only evidence, not a customer incident or LINE delivery test.

## Evidence
- Local Ollama digest: 1bdc07fcb6394b54a1174a466d2606c169c68b0fdb92c678dddf12cc533bbd66.
- Provider sends OpenAI-compatible /v1/chat/completions with native API field
  think:false, but omitted OpenAI reasoning_effort.
- Official Ollama compatibility documentation lists reasoning_effort values
  high/medium/low/none; the project's issue14820 explicitly records qwen3.5
  auto-enabling thinking when that compatible field is absent.
- Sources: https://docs.ollama.com/api/openai-compatibility and
  https://github.com/ollama/ollama/issues/14820 .

## Root cause
The adapter used the native API thinking switch on the compatible API.
For this thinking-capable model it did not disable reasoning as intended;
the small generation ceiling left no visible answer. Post-fix smoke must
verify the compatible field rather than infer success from HTTP200.

## Why the issue escaped detection
Provider tests stubbed completed text and asserted think:false. They did not
run the actual selected model or assert a nonempty visible answer.

## Proposed prevention
Send reasoning_effort:none for the approved Qwen3.5 profile. Keep the output
ceiling and deadline. Add a request regression and rerun the same local smoke;
full LINE/RAG/MSP timing qualification remains a separate acceptance gate.
