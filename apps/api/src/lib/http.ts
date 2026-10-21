import type { Context } from "hono";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export const bad = (message: string, code = "invalid_request") => new HttpError(400, code, message);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found.`);
export const forbidden = (message = "You don't have permission to do that.") => new HttpError(403, "forbidden", message);

export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  const text = await c.req.text();
  if (!text.trim()) raw = {};                       // an empty body is an empty object
  else { try { raw = JSON.parse(text); } catch { throw bad("Send a JSON body."); } }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw bad(`${i.path.join(".") || "body"}: ${i.message}`);
  }
  return r.data;
}
