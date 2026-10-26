// Claude through the Messages API (no SDK, so it runs in a Worker). The runtime gives it tools and runs them.
import type { Env } from "./db";
import { UpstreamError } from "./registers";
import { MODELS, MODES, SYSTEM_MODE } from "../../../../config/model-pricing";

export type Block =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | { type: "tool_use"; id: string; name: string; input: any; cache_control?: CacheControl }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean; cache_control?: CacheControl };
type CacheControl = { type: "ephemeral" };
export type Msg = { role: "user" | "assistant"; content: string | Block[] };
export type ToolDef = { name: string; description: string; input_schema: any; cache_control?: CacheControl };
export type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
export type Reply = { content: Block[]; stop_reason: string; usage: Usage };

const EPHEMERAL: CacheControl = { type: "ephemeral" };
/** Overloaded (529), rate limited (429), timeouts and transient server errors are worth another try. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Prompt caching: the system prompt and tool definitions are identical on every step of a run, and each step
 * re-sends the whole conversation so far. Three breakpoints (system, last tool, last message) let each step
 * read everything before it from the cache instead of paying full price for it again.
 */
export function withCaching(req: { system: string; messages: Msg[]; tools: ToolDef[] }) {
  const tools = req.tools.map((t, i) => (i === req.tools.length - 1 ? { ...t, cache_control: EPHEMERAL } : t));
  const messages = req.messages.map((m, i) => {
    if (i !== req.messages.length - 1) return m;
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content.map((b) => ({ ...b }));
    if (blocks.length) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: EPHEMERAL };
    return { ...m, content: blocks };
  });
  return { system: [{ type: "text", text: req.system, cache_control: EPHEMERAL }], messages, tools };
}

/** A model request. `model` and the effort and output limits come from the mode (config/model-pricing.ts). */
export type ModelReq = { system: string; messages: Msg[]; tools: ToolDef[]; model?: string; effort?: "low" | "medium" | "high"; max_tokens?: number };

/** One adapter per provider. Adding a provider's model means adding its adapter here and its rates in config. */
const PROVIDERS: Record<string, (env: Env, model: string, req: ModelReq) => Promise<Reply>> = { anthropic: anthropicMessages };

/** Call the model a mode runs on. Every caller passes the model, so what is billed is what ran. */
export async function claude(env: Env, req: ModelReq): Promise<Reply> {
  const model = req.model || MODES[SYSTEM_MODE].model;
  const provider = MODELS[model]?.provider;
  if (!provider || !PROVIDERS[provider]) throw new UpstreamError("Model", 500, `No provider for model ${model}: add it to config/model-pricing.ts`);
  return PROVIDERS[provider](env, model, req);
}

async function anthropicMessages(env: Env, model: string, req: ModelReq): Promise<Reply> {
  if (!env.ANTHROPIC_API_KEY) throw new UpstreamError("Claude", 503, "ANTHROPIC_API_KEY is not set");
  const cached = withCaching(req);
  // Thinking is adaptive by default on these models and is billed as output tokens; effort sets how much they do.
  const payload = JSON.stringify({
    model, max_tokens: req.max_tokens || 4000,
    ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    system: cached.system, messages: cached.messages, tools: cached.tools.length ? cached.tools : undefined,
  });
  const retries = Number(env.CLAUDE_RETRIES ?? 4);
  const baseMs = Number(env.CLAUDE_RETRY_BASE_MS ?? 1000);
  const url = (env.ANTHROPIC_BASE || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null, networkError = "";
    try {
      // A stalled call would hold a run slot until the consumer's time limit. Give up after 90 seconds and retry.
      res = await fetch(url, { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: payload,
        signal: AbortSignal.timeout(Number(env.CLAUDE_TIMEOUT_MS || 90000)) });
    } catch (e: any) { networkError = String(e?.message || e); }
    if (res?.ok) return res.json<Reply>();
    const status = res?.status ?? 0;
    const detail = res ? (await res.text()).slice(0, 200) : networkError;
    if ((res && !RETRYABLE.has(status)) || attempt >= retries) throw new UpstreamError("Claude", status || 502, `Claude returned ${status || "no response"}: ${detail}`);
    // Honour retry-after when given; otherwise exponential backoff with jitter, capped at 20 seconds.
    const after = Number(res?.headers.get("retry-after"));
    const wait = after > 0 ? Math.min(after * 1000, 20000) : Math.min(baseMs * 2 ** attempt, 20000) * (0.75 + Math.random() * 0.5);
    await sleep(wait);
  }
}
