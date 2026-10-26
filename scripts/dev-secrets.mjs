// Writes .dev.vars for local development: fresh signing key (base64url JWK, so env-file quoting cannot mangle it), channel key and tokens, pointed at the mocks.
import { writeFileSync, existsSync } from "node:fs";
import { webcrypto as c } from "node:crypto";
const b64u = (b) => Buffer.from(b).toString("base64url");
const kp = await c.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const jwk = await c.subtle.exportKey("jwk", kp.privateKey);
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:8788";
const vars = {
  APP_URL: "http://127.0.0.1:8787/", API_URL: "http://127.0.0.1:8787",
  CH_API_BASE: MOCK + "/ch", CH_API_KEY: "dev-key", CH_RATE_LIMIT: "3000", // the mock has no limit; the e2e run makes hundreds of calls in one window
  GAZETTE_BASE: MOCK + "/gazette", FCA_BASE: MOCK + "/fca", FCA_EMAIL: "dev@example.com", FCA_KEY: "dev",
  FACILITATOR_URL: MOCK + "/facilitator", X402_PAY_TO: "0x000000000000000000000000000000000000dEaD", X402_ASSET: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  STRIPE_BASE: MOCK + "/stripe", STRIPE_SECRET: "sk_test_dev", STRIPE_WEBHOOK_SECRET: "whsec_dev", STRIPE_PRICE_STARTER: "price_starter", STRIPE_PRICE_GROWTH: "price_growth", STRIPE_PRICE_SCALE: "price_scale", STRIPE_PRICE_TOPUP: "price_topup",
  SIGNING_JWK: b64u(JSON.stringify(jwk)), SIGNING_KID: "dev-1", CHANNEL_KEY: b64u(c.getRandomValues(new Uint8Array(32))),
  INGEST_SECRET: "dev-ingest-" + b64u(c.getRandomValues(new Uint8Array(12))), ADMIN_TOKEN: "dev-admin-" + b64u(c.getRandomValues(new Uint8Array(12))),
  STREAM_BASE: MOCK + "/ch-stream", STREAM_KEY: "dev-key",
  ANTHROPIC_BASE: MOCK + "/anthropic", ANTHROPIC_API_KEY: "dev", SEARCH_BASE: MOCK + "/search", SEARCH_API_KEY: "dev", ALLOW_HTTP_FETCH: "true", INBOUND_DOMAIN: "in.agenthouse.test",
  CLAUDE_RETRY_BASE_MS: "200", VOICE_HTTP_URL: MOCK + "/voice",
  MAIL_MODE: "outbox", OPERATOR_EMAIL: "operator@agenthouse.example", SENDS_LIVE: "true", COOKIE_SECURE: "false", ALLOW_ANY_WEBHOOK_HOST: "true",
};
if (existsSync(".dev.vars") && !process.argv.includes("--force")) { console.log(".dev.vars exists; use --force to replace it"); process.exit(0); }
writeFileSync(".dev.vars", Object.entries(vars).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n");
console.log("Wrote .dev.vars");
