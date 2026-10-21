// Sending alerts to an MSP's channels: Teams (Workflows webhook, Adaptive Card), Slack (incoming webhook), email.
// Each (alert, channel, kind) is sent at most once: the delivery row is the lock.
import { newId, nowIso, longDate } from "../../../../packages/core/util";
import { type Env, one, all, run } from "./db";
import { unseal } from "./crypto";
import { sendMail } from "./mail";

type AlertRow = { id: string; org_id: string; number: string; title: string; summary: string; severity: string; facts: string; next_step: string; created_at: string };

const link = (env: Env, a: { id: string }) => `${env.APP_URL}#/workspace/alerts?a=${a.id}`;

function teamsCard(env: Env, a: AlertRow, company: string) {
  const facts = JSON.parse(a.facts) as [string, string, string][];
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
        body: [
          { type: "TextBlock", text: `${a.severity}: ${a.title}`, weight: "Bolder", size: "Medium", color: a.severity === "Critical" ? "Attention" : "Default", wrap: true },
          { type: "TextBlock", text: `${company} (${a.number})`, wrap: true, spacing: "None" },
          { type: "TextBlock", text: a.summary, wrap: true },
          { type: "FactSet", facts: facts.map(([k, v, s]) => ({ title: k, value: `${v} (${s})` })) },
          { type: "TextBlock", text: a.next_step, wrap: true, isSubtle: true },
        ],
        actions: [{ type: "Action.OpenUrl", title: "Open in Agent House", url: link(env, a) }],
      },
    }],
  };
}

function slackMessage(env: Env, a: AlertRow, company: string) {
  const facts = JSON.parse(a.facts) as [string, string, string][];
  return {
    text: `${a.severity}: ${a.title}, ${company}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${a.severity}: ${a.title}*\n${company} (${a.number})\n${a.summary}` } },
      { type: "section", fields: facts.slice(0, 10).map(([k, v, s]) => ({ type: "mrkdwn", text: `*${k}*\n${v} _(${s})_` })) },
      { type: "context", elements: [{ type: "mrkdwn", text: `${a.next_step} <${link(env, a)}|Open in Agent House>` }] },
    ],
  };
}

function emailText(env: Env, a: AlertRow, company: string) {
  const facts = JSON.parse(a.facts) as [string, string, string][];
  return [`${a.severity}: ${a.title}`, `${company} (${a.number})`, "", a.summary, "", ...facts.map(([k, v, s]) => `${k}: ${v} (${s})`), "", `Suggested next step: ${a.next_step}`, "", `Open in Agent House: ${link(env, a)}`].join("\n");
}

async function post(url: string, payload: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Channel returned ${res.status}`);
}

/** Send one alert to one channel. Safe to retry: a sent row is never sent again. */
export async function deliverAlert(env: Env, alertId: string, channelId: string, kind: "alert" | "share") {
  const a = await one<AlertRow>(env, "SELECT * FROM alert WHERE id = ?", alertId);
  const ch = await one<any>(env, "SELECT * FROM channel WHERE id = ? AND org_id = ?", channelId, a?.org_id);
  if (!a || !ch) return "skipped";
  const ins = await run(env, "INSERT INTO delivery (id, alert_id, org_id, channel_id, kind, attempt, status) VALUES (?,?,?,?,?,0,'pending') ON CONFLICT(alert_id, channel_id, kind) DO NOTHING",
    newId("dlv"), alertId, a.org_id, channelId, kind);
  const row = await one<any>(env, "SELECT * FROM delivery WHERE alert_id = ? AND channel_id = ? AND kind = ?", alertId, channelId, kind);
  if (row.status === "sent" && kind === "alert") return "already_sent";
  const company = (await one<any>(env, "SELECT display_name FROM client WHERE org_id = ? AND number = ?", a.org_id, a.number))?.display_name || a.number;
  try {
    const target = await unseal(env, ch.target_enc);
    if (env.SENDS_LIVE !== "true") {
      await run(env, "UPDATE delivery SET status='dry_run', attempt=attempt+1 WHERE id = ?", row.id);
      return "dry_run";
    }
    if (ch.kind === "teams") await post(target, teamsCard(env, a, company));
    else if (ch.kind === "slack") await post(target, slackMessage(env, a, company));
    else await sendMail(env, { to: target, subject: `${a.severity}: ${a.title}, ${company}`, text: emailText(env, a, company) });
    await run(env, "UPDATE delivery SET status='sent', attempt=attempt+1, sent_at=?, last_error=NULL WHERE id = ?", nowIso(), row.id);
    return "sent";
  } catch (e: any) {
    await run(env, "UPDATE delivery SET status='failed', attempt=attempt+1, last_error=? WHERE id = ?", String(e.message || e).slice(0, 300), row.id);
    throw e;
  }
}

/** A digest of Review alerts not yet sent, one message per channel. */
export async function deliverDigest(env: Env, orgId: string) {
  const cfg = await one<any>(env, "SELECT * FROM agent_config WHERE org_id = ? AND agent = 'watch'", orgId);
  if (!cfg?.on_ || !cfg.channel_id) return 0;
  const alerts = await all<AlertRow & { display_name: string }>(env,
    `SELECT a.*, c.display_name FROM alert a JOIN client c ON c.org_id = a.org_id AND c.number = a.number
     WHERE a.org_id = ? AND a.severity = 'Review' AND a.digest_sent_at IS NULL ORDER BY a.created_at`, orgId);
  if (!alerts.length) return 0;
  const ch = await one<any>(env, "SELECT * FROM channel WHERE id = ? AND org_id = ?", cfg.channel_id, orgId);
  if (!ch) return 0;
  const target = await unseal(env, ch.target_enc);
  const lines = alerts.map((a) => `${a.title}: ${a.display_name}. ${a.summary}`);
  const title = `${alerts.length} ${alerts.length === 1 ? "change" : "changes"} to review, ${longDate(nowIso())}`;
  if (env.SENDS_LIVE === "true") {
    if (ch.kind === "teams") await post(target, { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", text: title, weight: "Bolder", wrap: true }, ...lines.map((l) => ({ type: "TextBlock", text: l, wrap: true }))], actions: [{ type: "Action.OpenUrl", title: "Open alerts", url: `${env.APP_URL}#/workspace/alerts` }] } }] });
    else if (ch.kind === "slack") await post(target, { text: title, blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${title}*\n` + lines.map((l) => "• " + l).join("\n") } }] });
    else await sendMail(env, { to: target, subject: title, text: lines.join("\n\n") + `\n\nOpen alerts: ${env.APP_URL}#/workspace/alerts` });
  }
  const now = nowIso();
  await env.DB.batch(alerts.map((a) => env.DB.prepare("UPDATE alert SET digest_sent_at = ? WHERE id = ?").bind(now, a.id)));
  return alerts.length;
}

export async function testChannel(env: Env, ch: any) {
  const target = await unseal(env, ch.target_enc);
  const text = "Agent House is connected. Alerts will arrive here.";
  if (env.SENDS_LIVE !== "true") return "dry_run";
  if (ch.kind === "teams") await post(target, { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", text, wrap: true }] } }] });
  else if (ch.kind === "slack") await post(target, { text });
  else await sendMail(env, { to: target, subject: "Agent House is connected", text });
  await run(env, "UPDATE channel SET verified_at = ? WHERE id = ?", nowIso(), ch.id);
  return "sent";
}

/** A short note from an agent to a channel, or to the owner's email when no channel is set. */
export async function notifyChannel(env: Env, orgId: string, channelId: string | null, title: string, text: string) {
  const ch = channelId ? await one<any>(env, "SELECT * FROM channel WHERE id = ? AND org_id = ?", channelId, orgId) : null;
  if (!ch) {
    const owner = await one<any>(env, "SELECT u.email FROM membership m JOIN user u ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'owner' LIMIT 1", orgId);
    if (!owner) return "no_recipient";
    return sendMail(env, { to: owner.email, subject: title, text: `${text}\n\nOpen the workspace: ${env.APP_URL}#/workspace` });
  }
  const target = await unseal(env, ch.target_enc);
  if (ch.kind === "email") return sendMail(env, { to: target, subject: title, text });
  if (env.SENDS_LIVE !== "true") return "dry_run";
  if (ch.kind === "teams") await post(target, { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", text: title, weight: "Bolder", wrap: true }, { type: "TextBlock", text, wrap: true }], actions: [{ type: "Action.OpenUrl", title: "Open Agent House", url: `${env.APP_URL}#/workspace` }] } }] });
  else await post(target, { text: `*${title}*\n${text}` });
  return "sent";
}
