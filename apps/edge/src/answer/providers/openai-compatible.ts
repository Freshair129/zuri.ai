import type { ModelPort, ModelPortConfig, ModelReply, ModelRequest } from '../model-port.js';

/**
 * Every local runtime a business would actually run — Ollama, vLLM, LM Studio,
 * llama.cpp's server, LocalAI — exposes the OpenAI chat-completions API. So this is
 * one adapter rather than one per vendor, and switching between them is a base URL.
 *
 * `apiKey` is optional here and that is the whole point: a model running on the
 * business's own hardware has nobody to authenticate to. Hosted OpenAI-compatible
 * gateways still work by supplying one.
 *
 * The tool loop is written out rather than borrowed from a client library, because
 * pulling in an SDK to speak a protocol this small would trade a dependency for
 * nothing — and a local deployment is exactly where an unnecessary dependency hurts.
 */

interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * The multimodal form of a message body. Only used when the caller supplied images;
 * a text turn stays a bare string, which is what every server accepts without thinking.
 */
type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

/**
 * A LINE reply is a few hundred tokens; the executor rejects anything over 5000 characters
 * anyway. 2000 let a runaway generation run for 30 s on a 9B model at ~65 t/s (seen live on
 * 2026-09-13: 1,753 tokens generated, the job's whole model budget gone, EXECUTION_FAILED).
 * 700 tokens is ~11 s worst case, so a rambling model still hands back a reply in time.
 */
const MAX_TOKENS = 700;
/** Ollama's default is 1.0, which is where the rambling and the invented examples come from. */
const TEMPERATURE = 0.3;
/** Sent as the last user turn when the tools are withheld; not a system rule, so a persona cannot drop it. */
export const FINAL_PASS_NUDGE =
  'ตอบลูกค้าตอนนี้เลย จากผลลัพธ์ของเครื่องมือด้านบนเท่านั้น เป็นข้อความสั้น ๆ ถ้าข้อมูลยังไม่พอให้บอกตรง ๆ ว่ายังไม่มีข้อมูล ห้ามเรียกเครื่องมือเพิ่ม';

export function createOpenAiCompatiblePort(
  config: ModelPortConfig,
  { fetchFn = fetch }: { fetchFn?: typeof fetch } = {}
): ModelPort {
  const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('MODEL_BASE_URL_REQUIRED');

  return {
    id: 'openai-compatible',
    model: config.model,

    async generate(request: ModelRequest): Promise<ModelReply> {
      const tools = request.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      const byName = new Map(request.tools.map((tool) => [tool.name, tool]));

      const messages: ChatMessage[] = [
        { role: 'system', content: request.system },
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      /*
       * Images ride on the last user turn, as `image_url` parts with a data URL — the form
       * Ollama, vLLM and LM Studio all accept on `/v1/chat/completions`, so the same one
       * adapter still covers every local runtime.
       *
       * A request that carries images but has no user turn to attach them to is a caller
       * bug, and the failure mode if it were tolerated is the dangerous one: the model
       * answers about a document it never saw. So it throws.
       */
      if (request.images?.length) {
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        if (!lastUser) throw new Error('MODEL_IMAGES_WITHOUT_USER_TURN');
        lastUser.content = [
          { type: 'text', text: typeof lastUser.content === 'string' ? lastUser.content : '' },
          ...request.images.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${image.mime};base64,${image.base64}` },
          })),
        ];
      }

      let nudged = false;
      for (let iteration = 0; iteration < request.maxIterations; iteration += 1) {
        // On the last pass the tools are withheld. A model that is still calling them here has
        // already gathered its evidence and simply has no turn left to speak in — offering the
        // tools again guarantees the one outcome the customer cannot use, an empty reply that
        // falls back to the pattern reader. Without them it has to answer from what it holds, and
        // that answer is checked against the evidence like any other.
        const finalPass = iteration === request.maxIterations - 1;
        if (finalPass && tools.length && iteration > 0 && !nudged) {
          // A 9B model that has just been refused its tools tends to answer with nothing at all
          // (seen on qwen3.5:9b after three tool rounds: content "", so the job failed). Told
          // plainly that this is the reply turn, it summarises what the tools returned.
          messages.push({ role: 'user', content: FINAL_PASS_NUDGE });
          nudged = true;
        }
        const response = await fetchFn(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Only sent when configured — a local server rejects nothing for its absence.
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: MAX_TOKENS,
            temperature: TEMPERATURE,
            messages,
            ...(tools.length && !finalPass ? { tools } : {}),
            // Not an OpenAI field, and harmless where it is not understood. Over half
            // the models on a local box are Thinking variants, and they spend their
            // token budget reasoning before answering — which shows up as a reply that
            // arrives after the LINE token has expired, or as `<think>` leaking into
            // what the customer reads. SPEC--LOCAL-LLM-DISPATCH-V2 §5.4.
            think: false,
            // Ollama reads this; other servers ignore it. Omitted unless configured so
            // a server that sizes its own context is left alone.
            ...(config.numCtx ? { options: { num_ctx: config.numCtx } } : {}),
          }),
          signal: request.signal,
        });

        if (!response.ok) {
          // The body may carry provider detail that has no business in a log or a
          // reply, so only the status crosses this boundary.
          throw new Error(`MODEL_HTTP_${response.status}`);
        }

        const body = (await response.json()) as {
          choices?: Array<{ message?: ChatMessage }>;
        };
        const message = body.choices?.[0]?.message;
        if (!message) return { text: '' };

        const calls = message.tool_calls ?? [];
        if (calls.length === 0) {
          const text = String(message.content ?? '').trim();
          // An empty, tool-less reply in the middle of a tool loop is the same silence as on the
          // final pass (qwen3.5:9b did it on the third round, 1 run in 3): one nudge, one more
          // round, instead of handing back nothing and failing the job.
          if (text || finalPass || !tools.length || nudged) return { text };
          messages.push({ role: 'user', content: FINAL_PASS_NUDGE });
          nudged = true;
          continue;
        }

        // Keep the assistant's tool-call turn before appending results, or the server
        // has no record of what it asked for.
        messages.push({
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: calls,
        });

        for (const call of calls) {
          const tool = byName.get(call.function?.name ?? '');
          let result: string;
          if (!tool) {
            // A hallucinated tool name is the model's error to recover from, not a
            // reason to fail the turn — it is told, and gets another iteration.
            result = JSON.stringify({ error: 'unknown tool' });
          } else {
            try {
              const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
              result = await tool.run(args);
            } catch (error) {
              result = JSON.stringify({
                error: error instanceof Error ? error.message : 'tool failed',
              });
            }
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
      }

      // Out of iterations while still calling tools: no trustworthy answer exists, so
      // the caller falls back to the deterministic one rather than sending a guess.
      return { text: '' };
    },
  };
}
