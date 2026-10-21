// Claude through the Messages API (no SDK, so it runs in a Worker). The runtime gives it tools and runs them.
import type { Env } from "./db";
import { UpstreamError } from "./registers";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type Msg = { role: "user" | "assistant"; content: string | Block[] };
export type ToolDef = { name: string; description: string; input_schema: any };
export type Reply = { content: Block[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } };

export async function claude(env: Env, req: { system: string; messages: Msg[]; tools: ToolDef[]; max_tokens?: number }): Promise<Reply> {
  if (!env.ANTHROPIC_API_KEY) throw new UpstreamError("Claude", 503, "ANTHROPIC_API_KEY is not set");
  const res = await fetch((env.ANTHROPIC_BASE || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.AGENT_MODEL || "claude-sonnet-5-5", max_tokens: req.max_tokens || 1500, system: req.system, messages: req.messages, tools: req.tools.length ? req.tools : undefined }),
  });
  if (!res.ok) throw new UpstreamError("Claude", res.status, `Claude returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json<Reply>();
}

/** Model cost in pence, from token counts. Prices per million tokens, in pence, set per deployment. */
export function modelCost(env: Env, tokensIn: number, tokensOut: number) {
  const pin = Number(env.AGENT_PRICE_IN_PENCE || 240), pout = Number(env.AGENT_PRICE_OUT_PENCE || 1200);
  return Math.ceil((tokensIn * pin + tokensOut * pout) / 1e6);
}
