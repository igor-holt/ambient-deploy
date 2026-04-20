/**
 * ambient-mcp-worker
 *
 * Streamable HTTP MCP shim. Consumers reach it at:
 *   https://ambient.genesisconductor.io/mcp
 *
 * Transport: stateless Streamable HTTP (JSON-RPC 2.0).
 * Proxies tool calls to the upstream Ambient API at AMBIENT_BASE_URL.
 *
 * Auth model:
 *   - Caller sends `Authorization: Bearer <key>` on every MCP request.
 *   - Worker forwards that bearer to the upstream API.
 *   - Upstream resolves workspace_id from the key.
 *
 * Optional shared-secret mode:
 *   - If MCP_SHARED_SECRET is set AND caller bearer matches it, Worker
 *     substitutes AMBIENT_API_KEY binding when calling upstream. This lets
 *     the Worker multi-tenant via a single upstream key.
 */

interface Env {
  AMBIENT_API_KEY: string;
  AMBIENT_BASE_URL: string;
  SERVER_NAME: string;
  SERVER_VERSION: string;
  MCP_SHARED_SECRET?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC / MCP plumbing
// ─────────────────────────────────────────────────────────────────────────────

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const PROTOCOL_VERSION = "2025-11-25";

function rpcOk(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcErr(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool catalog
// ─────────────────────────────────────────────────────────────────────────────

const REQUEST_TYPES = [
  "implement_feature_from_spec",
  "implement_feature",
  "security_fix",
  "deep_architecture_review",
  "gcp_ops",
  "inline_suggestion",
  "deploy",
] as const;

const AGENTS = ["kiro", "codex", "claude", "gemini", "copilot"] as const;

const TOOLS = [
  {
    name: "ambient_submit_task",
    description:
      "Submit an asynchronous task to the Genesis Conductor agent graph. Routes to kiro/codex/claude/gemini/copilot based on request_type.",
    inputSchema: {
      type: "object",
      properties: {
        request_type: { type: "string", enum: REQUEST_TYPES, description: "Resolved task type." },
        title: { type: "string", maxLength: 80, description: "Concise imperative title." },
        description: { type: "string", description: "User's full request, verbatim." },
        priority: { type: "string", enum: ["critical", "high", "normal", "low"], default: "normal" },
        policy_tier: { type: "string", enum: ["standard", "prod_sensitive"], default: "standard" },
        requires_approval: { type: "boolean", default: false },
        context_refs: { type: "array", items: { type: "string" } },
        candidate_agents: { type: "array", items: { type: "string", enum: AGENTS } },
        source_surface: { type: "string", default: "http-mcp" },
        requested_by: { type: "string", default: "mcp-shim" },
      },
      required: ["request_type", "title", "description"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "ambient_get_job_status",
    description: "Poll the lifecycle state of a job by job_id.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "ambient_get_workspace_state",
    description: "KV-backed state projection (<50ms) for a workspace.",
    inputSchema: {
      type: "object",
      properties: { workspace_id: { type: "string" } },
      required: ["workspace_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "ambient_list_jobs",
    description: "Paginated list of jobs with optional status filter.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        status: { type: "string", enum: ["pending", "running", "blocked", "complete", "failed", "cancelled"] },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        offset: { type: "integer", minimum: 0, default: 0 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "ambient_approve_task",
    description: "Approve a blocked task. Transitions underlying job blocked → running.",
    inputSchema: {
      type: "object",
      properties: { approval_id: { type: "string" } },
      required: ["approval_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "ambient_reject_task",
    description: "Reject and cancel a blocked task. Irreversible.",
    inputSchema: {
      type: "object",
      properties: { approval_id: { type: "string" } },
      required: ["approval_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Upstream proxy
// ─────────────────────────────────────────────────────────────────────────────

async function upstream(env: Env, bearer: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${env.AMBIENT_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw Object.assign(new Error(body?.error ?? res.statusText), { status: res.status, body });
  }
  return body;
}

function resolveBearer(env: Env, req: Request): string {
  const hdr = req.headers.get("Authorization") ?? "";
  const token = hdr.replace(/^Bearer\s+/i, "").trim();
  if (env.MCP_SHARED_SECRET && token === env.MCP_SHARED_SECRET) {
    return env.AMBIENT_API_KEY;
  }
  if (!token) throw new Error("Missing Authorization bearer token");
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function dispatch(env: Env, bearer: string, name: string, args: any): Promise<any> {
  switch (name) {
    case "ambient_submit_task": {
      const body: any = {
        source_surface: args.source_surface ?? "http-mcp",
        request_type: args.request_type,
        title: args.title,
        description: args.description,
        requested_by: args.requested_by ?? "mcp-shim",
        priority: args.priority ?? "normal",
        policy_tier: args.policy_tier ?? "standard",
        requires_approval: args.requires_approval ?? false,
      };
      if (args.context_refs?.length) body.context_refs = args.context_refs;
      if (args.candidate_agents?.length) body.candidate_agents = args.candidate_agents;
      return await upstream(env, bearer, "/v1/tasks", { method: "POST", body: JSON.stringify(body) });
    }
    case "ambient_get_job_status":
      return await upstream(env, bearer, `/v1/jobs/${encodeURIComponent(args.job_id)}`);
    case "ambient_get_workspace_state":
      return await upstream(env, bearer, `/v1/state/${encodeURIComponent(args.workspace_id)}`);
    case "ambient_list_jobs": {
      const qs = new URLSearchParams();
      if (args.workspace_id) qs.set("workspace_id", args.workspace_id);
      if (args.status) qs.set("status", args.status);
      qs.set("limit", String(args.limit ?? 25));
      qs.set("offset", String(args.offset ?? 0));
      return await upstream(env, bearer, `/v1/jobs?${qs}`);
    }
    case "ambient_approve_task":
      return await upstream(env, bearer, `/v1/approvals/${encodeURIComponent(args.approval_id)}/approve`, {
        method: "POST",
        body: "{}",
      });
    case "ambient_reject_task":
      return await upstream(env, bearer, `/v1/approvals/${encodeURIComponent(args.approval_id)}/reject`, {
        method: "POST",
        body: "{}",
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP method handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleRpc(env: Env, req: Request, rpc: JsonRpcRequest): Promise<JsonRpcResponse> {
  try {
    switch (rpc.method) {
      case "initialize":
        return rpcOk(rpc.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: env.SERVER_NAME, version: env.SERVER_VERSION },
        });

      case "notifications/initialized":
        // Notifications carry no id; return nothing (caller expects no response for notifications).
        return rpcOk(rpc.id ?? null, {});

      case "tools/list":
        return rpcOk(rpc.id, { tools: TOOLS });

      case "tools/call": {
        const bearer = resolveBearer(env, req);
        const { name, arguments: args } = rpc.params ?? {};
        if (typeof name !== "string") {
          return rpcErr(rpc.id, -32602, "Missing or invalid tool name");
        }
        try {
          const data = await dispatch(env, bearer, name, args ?? {});
          return rpcOk(rpc.id, {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
            isError: false,
          });
        } catch (err: any) {
          const status = err?.status;
          const hint =
            status === 401
              ? "Check bearer token."
              : status === 403
                ? "Cross-tenant access denied."
                : status === 404
                  ? "Resource not found."
                  : status >= 500
                    ? "Upstream error."
                    : "";
          return rpcOk(rpc.id, {
            content: [
              { type: "text", text: `Error: ${err?.message ?? "Unknown"}${hint ? ` — ${hint}` : ""}` },
            ],
            isError: true,
          });
        }
      }

      case "ping":
        return rpcOk(rpc.id, {});

      default:
        return rpcErr(rpc.id, -32601, `Method not found: ${rpc.method}`);
    }
  } catch (err) {
    return rpcErr(rpc.id ?? null, -32603, err instanceof Error ? err.message : String(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch entrypoint
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health / introspection
    if (url.pathname === "/health" || url.pathname === "/mcp/health") {
      return Response.json({
        ok: true,
        server: env.SERVER_NAME,
        version: env.SERVER_VERSION,
        protocol: PROTOCOL_VERSION,
        tools: TOOLS.length,
        upstream: env.AMBIENT_BASE_URL,
      });
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // MCP endpoint
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      if (request.method !== "POST") {
        return new Response("MCP Streamable HTTP — POST JSON-RPC 2.0 requests.", {
          status: 405,
          headers: { Allow: "POST" },
        });
      }

      let rpc: JsonRpcRequest | JsonRpcRequest[];
      try {
        rpc = await request.json();
      } catch {
        return Response.json(rpcErr(null, -32700, "Parse error"), { status: 400 });
      }

      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      };

      // Batch support
      if (Array.isArray(rpc)) {
        const results = await Promise.all(rpc.map((r) => handleRpc(env, request, r)));
        // Notifications (no id) should not appear in response
        const filtered = results.filter((r) => r.id !== null || r.error);
        return new Response(JSON.stringify(filtered), { headers: corsHeaders });
      }

      const response = await handleRpc(env, request, rpc);
      // Suppress responses to notifications (per JSON-RPC 2.0)
      if (rpc.id === undefined || rpc.id === null) {
        if (rpc.method.startsWith("notifications/")) {
          return new Response(null, { status: 204, headers: corsHeaders });
        }
      }
      return new Response(JSON.stringify(response), { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404 });
  },
};
