import type { Env, AuthContext } from "../types";

export async function handleState(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const targetWorkspace = pathParts[3]; // /v1/state/:workspace_id

  // Cross-tenant access block
  if (targetWorkspace !== auth.workspace_id) {
    return new Response(JSON.stringify({ error: "Forbidden: Workspace mismatch" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stateRaw = await env.STATE_PROJECTION.get(`ws:${targetWorkspace}`);

  if (!stateRaw) {
    return new Response(
      JSON.stringify({
        workspace_id: targetWorkspace,
        active_jobs: 0,
        blocked_jobs: 0,
        open_approvals: [],
        last_updated: new Date().toISOString(),
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(stateRaw, { headers: { "Content-Type": "application/json" } });
}
