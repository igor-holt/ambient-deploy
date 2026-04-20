import type { Env } from "./types";
import crypto from "node:crypto";

export async function sendNotification(
  env: Env,
  taskId: string,
  workspaceId: string,
  eventType: string,
  payload: any
): Promise<void> {
  // 1. Webhook delivery with HMAC-SHA256 signing
  const webhooks = await env.DB.prepare(
    "SELECT callback_url, secret FROM webhooks WHERE workspace_id = ? AND events LIKE ?"
  )
    .bind(workspaceId, `%${eventType}%`)
    .all<{ callback_url: string; secret: string }>();

  if (webhooks.results && webhooks.results.length > 0) {
    const body = JSON.stringify({ task_id: taskId, event: eventType, data: payload });

    for (const hook of webhooks.results) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Ambient-Event": eventType,
        "X-Ambient-Task-Id": taskId,
      };
      if (hook.secret) {
        const signature = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
        headers["X-Ambient-Signature"] = `sha256=${signature}`;
      }
      env.waitUntil(
        fetch(hook.callback_url, { method: "POST", headers, body }).catch((e) =>
          console.error(`webhook ${hook.callback_url}:`, e)
        )
      );
    }
  }

  // 2. Slack approval escalation
  if (eventType === "approval.requested" && env.SLACK_WEBHOOK_URL) {
    const slackPayload = {
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Approval Required* [Task: ${taskId}]` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Summary:* ${payload.summary ?? "(no summary)"}\n*Agent:* ${payload.requested_by_agent ?? "(unknown)"}`,
          },
        },
      ],
    };
    env.waitUntil(
      fetch(env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload),
      }).catch((e) => console.error("slack notify:", e))
    );
  }
}
