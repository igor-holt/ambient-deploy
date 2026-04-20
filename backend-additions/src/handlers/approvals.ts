import type { Env, AuthContext } from "../types";
import { appendEvent } from "../db/queries";
import { rebuildProjection } from "../projection";

export async function handleApprovals(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const approvalId = parts[3];
  const action = parts[4]; // approve | reject

  if (!approvalId || !["approve", "reject"].includes(action)) {
    return new Response(JSON.stringify({ error: "Invalid route" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify ownership
  const approval = await env.DB.prepare(
    `SELECT a.*, t.workspace_id FROM approvals a
     JOIN tasks t ON a.task_id = t.task_id
     WHERE a.approval_id = ?`
  )
    .bind(approvalId)
    .first<any>();

  if (!approval || approval.workspace_id !== auth.workspace_id) {
    return new Response(JSON.stringify({ error: "Not found or forbidden" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (approval.status !== "pending") {
    return new Response(
      JSON.stringify({ error: `Approval already resolved as ${approval.status}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const targetStatus = action === "approve" ? "approved" : "rejected";
  const jobStatus = action === "approve" ? "running" : "cancelled";
  const now = new Date().toISOString();

  // FIX #3: atomic batch — approval + job update land together or not at all.
  await env.DB.batch([
    env.DB.prepare("UPDATE approvals SET status = ?, resolved_at = ? WHERE approval_id = ?").bind(
      targetStatus,
      now,
      approvalId
    ),
    env.DB.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE job_id = ?").bind(
      jobStatus,
      now,
      approval.job_id
    ),
  ]);

  await appendEvent(env, {
    record_type: "approval",
    event_type: `approval_${action}d`,
    source: "api",
    workspace_id: auth.workspace_id,
    task_id: approval.task_id,
    job_id: approval.job_id,
    payload: { approval_id: approvalId, resolved_by: auth.workspace_id },
  });

  await rebuildProjection(auth.workspace_id, env);

  return new Response(
    JSON.stringify({ status: "success", approval_id: approvalId, new_state: targetStatus }),
    { headers: { "Content-Type": "application/json" } }
  );
}
