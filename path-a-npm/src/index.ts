#!/usr/bin/env node
/**
 * @kovach-enterprises/ambient-mcp-server
 *
 * Stdio MCP server surfacing the Genesis Conductor Ambient Agent Access Layer.
 * Upstream API: optimization-inversion.genesisconductor.io (Cloudflare Worker + D1).
 *
 * Transport: stdio (per MCP spec — no stdout logging; stderr only).
 * Tool prefix: `ambient_` (per mcp-builder best practices).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const AMBIENT_BASE_URL =
  process.env.AMBIENT_BASE_URL ?? "https://optimization-inversion.genesisconductor.io";
const AMBIENT_API_KEY = process.env.AMBIENT_API_KEY;

if (!AMBIENT_API_KEY) {
  process.stderr.write(
    "FATAL: AMBIENT_API_KEY is not set. Export it before running this server.\n"
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — shared
// ─────────────────────────────────────────────────────────────────────────────

const RequestTypeEnum = z.enum([
  "implement_feature_from_spec",
  "implement_feature",
  "security_fix",
  "deep_architecture_review",
  "gcp_ops",
  "inline_suggestion",
  "deploy",
]);

const PriorityEnum = z.enum(["critical", "high", "normal", "low"]);
const PolicyTierEnum = z.enum(["standard", "prod_sensitive"]);
const AgentEnum = z.enum(["kiro", "codex", "claude", "gemini", "copilot"]);

const SubmitTaskInput = z.object({
  request_type: RequestTypeEnum.describe(
    "Resolved task type. Routes to the primary agent. Example: implement_feature_from_spec → kiro."
  ),
  title: z
    .string()
    .min(1)
    .max(80)
    .describe("Concise imperative title. Example: 'Implement Nexus Membrane dependency provisioning'."),
  description: z
    .string()
    .min(1)
    .describe("User's full natural-language request. Stored verbatim. Do not summarize."),
  priority: PriorityEnum.default("normal").describe(
    "Scheduler priority. critical=blocking, high=today, normal=default, low=background."
  ),
  policy_tier: PolicyTierEnum.default("standard").describe(
    "Governance tier. prod_sensitive forces human approval before execution."
  ),
  requires_approval: z
    .boolean()
    .default(false)
    .describe("Whether a human must approve before the agent executes."),
  context_refs: z
    .array(z.string())
    .optional()
    .describe(
      "Repo/spec references, e.g. ['repo:ambient-mcp-server', 'spec:membrane-v1']."
    ),
  candidate_agents: z
    .array(AgentEnum)
    .optional()
    .describe("Explicit agent override. Omit to use routing table default."),
  source_surface: z
    .string()
    .default("claude")
    .describe("Calling surface identifier. Defaults to 'claude'."),
  requested_by: z
    .string()
    .default("claude-surface")
    .describe("Identity string of the submitter."),
});

const GetJobStatusInput = z.object({
  job_id: z.string().describe("Job ID returned from ambient_submit_task. Format: job_xxxxxxxx."),
});

const GetWorkspaceStateInput = z.object({
  workspace_id: z
    .string()
    .describe("Workspace ID. Returned in the 201 response from ambient_submit_task."),
});

const ListJobsInput = z.object({
  workspace_id: z.string().optional().describe("Filter by workspace. Omit for all accessible."),
  status: z
    .enum(["pending", "running", "blocked", "complete", "failed", "cancelled"])
    .optional()
    .describe("Filter by lifecycle state."),
  limit: z.number().int().min(1).max(100).default(25).describe("Page size. Max 100."),
  offset: z.number().int().min(0).default(0).describe("Pagination offset."),
});

const ApprovalActionInput = z.object({
  approval_id: z
    .string()
    .describe("Approval ID. Fetch from GET /v1/jobs/{job_id} when status=blocked."),
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP client — single retry on 5xx, structured error surfacing
// ─────────────────────────────────────────────────────────────────────────────

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function apiCall<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const headers = {
    Authorization: `Bearer ${AMBIENT_API_KEY}`,
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  try {
    const res = await fetch(`${AMBIENT_BASE_URL}${path}`, { ...init, headers });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof data?.error === "string" ? data.error : res.statusText,
      };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `Network failure reaching ${AMBIENT_BASE_URL}${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

function formatError(r: Extract<ApiResult<unknown>, { ok: false }>): string {
  const hints: Record<number, string> = {
    401: "Check AMBIENT_API_KEY. Key may be revoked or malformed.",
    403: "Cross-tenant access denied. Verify workspace_id matches API key.",
    404: "Resource not found. Check ID or base URL (AMBIENT_BASE_URL).",
    429: "Rate limited. Back off and retry.",
  };
  const hint = hints[r.status] ?? (r.status >= 500 ? "Upstream error. Check Worker logs." : "");
  return hint ? `${r.error} — ${hint}` : r.error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions with annotations
// ─────────────────────────────────────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: "ambient_submit_task",
    description:
      "Submit an asynchronous task to the Genesis Conductor agent graph. Routes to kiro/codex/claude/gemini/copilot based on request_type. Returns task_id and job_id for status polling.",
    inputSchema: zodToJsonSchema(SubmitTaskInput) as unknown as Record<string, unknown> & { type: "object" },
    annotations: {
      title: "Submit Ambient Task",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "ambient_get_job_status",
    description:
      "Get current status of a job by job_id. Returns agent, status (pending|running|blocked|complete|failed), stage, progress, and approval_id if blocked.",
    inputSchema: zodToJsonSchema(GetJobStatusInput) as unknown as Record<string, unknown> & { type: "object" },
    annotations: {
      title: "Get Job Status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "ambient_get_workspace_state",
    description:
      "Fast-read state projection for a workspace: active_jobs count, blocked_jobs count, and list of open approvals. Backed by KV for sub-50ms reads.",
    inputSchema: zodToJsonSchema(GetWorkspaceStateInput) as unknown as Record<string, unknown> & { type: "object" },
    annotations: {
      title: "Get Workspace State",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "ambient_list_jobs",
    description:
      "List jobs across the workspace with optional status filter and pagination. Supports limit (max 100) and offset.",
    inputSchema: zodToJsonSchema(ListJobsInput) as unknown as Record<string, unknown> & { type: "object" },
    annotations: {
      title: "List Jobs",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "ambient_approve_task",
    description:
      "Approve a blocked task by approval_id. Transitions the underlying job from blocked → running. Requires prod_sensitive or requires_approval=true.",
    inputSchema: zodToJsonSchema(ApprovalActionInput) as unknown as Record<string, unknown> & { type: "object" },
    annotations: {
      title: "Approve Task",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "ambient_reject_task",
    description:
      "Reject a blocked task by approval_id. Cancels the underlying job. Irreversible — creates a capsule_events record for audit.",
    inputSchema: zodToJsonSchema(ApprovalActionInput) as unknown as Record<string, unknown> & { type: "object" },
    annotations: {
      title: "Reject Task",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "ambient-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "ambient_submit_task": {
        const input = SubmitTaskInput.parse(args);
        const body = {
          source_surface: input.source_surface,
          request_type: input.request_type,
          title: input.title,
          description: input.description,
          requested_by: input.requested_by,
          priority: input.priority,
          policy_tier: input.policy_tier,
          requires_approval: input.requires_approval,
          ...(input.context_refs?.length ? { context_refs: input.context_refs } : {}),
          ...(input.candidate_agents?.length ? { candidate_agents: input.candidate_agents } : {}),
        };
        const r = await apiCall("/v1/tasks", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!r.ok) return toolError(formatError(r));
        return toolResult(r.data);
      }

      case "ambient_get_job_status": {
        const { job_id } = GetJobStatusInput.parse(args);
        const r = await apiCall(`/v1/jobs/${encodeURIComponent(job_id)}`);
        if (!r.ok) return toolError(formatError(r));
        return toolResult(r.data);
      }

      case "ambient_get_workspace_state": {
        const { workspace_id } = GetWorkspaceStateInput.parse(args);
        const r = await apiCall(`/v1/state/${encodeURIComponent(workspace_id)}`);
        if (!r.ok) return toolError(formatError(r));
        return toolResult(r.data);
      }

      case "ambient_list_jobs": {
        const input = ListJobsInput.parse(args);
        const qs = new URLSearchParams();
        if (input.workspace_id) qs.set("workspace_id", input.workspace_id);
        if (input.status) qs.set("status", input.status);
        qs.set("limit", String(input.limit));
        qs.set("offset", String(input.offset));
        const r = await apiCall(`/v1/jobs?${qs.toString()}`);
        if (!r.ok) return toolError(formatError(r));
        return toolResult(r.data);
      }

      case "ambient_approve_task": {
        const { approval_id } = ApprovalActionInput.parse(args);
        const r = await apiCall(`/v1/approvals/${encodeURIComponent(approval_id)}/approve`, {
          method: "POST",
          body: "{}",
        });
        if (!r.ok) return toolError(formatError(r));
        return toolResult(r.data);
      }

      case "ambient_reject_task": {
        const { approval_id } = ApprovalActionInput.parse(args);
        const r = await apiCall(`/v1/approvals/${encodeURIComponent(approval_id)}/reject`, {
          method: "POST",
          body: "{}",
        });
        if (!r.ok) return toolError(formatError(r));
        return toolResult(r.data);
      }

      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return toolError(
        `Schema validation failed: ${err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
      );
    }
    return toolError(
      `Tool execution error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

/**
 * Minimal Zod → JSON Schema converter. Sufficient for the subset used above.
 * Avoids pulling zod-to-json-schema as a dependency.
 */
function zodToJsonSchema(schema: z.ZodType): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
} {
  const any = schema as any;
  if (any._def.typeName === "ZodObject") {
    const shape = any._def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const key of Object.keys(shape)) {
      const field = shape[key];
      properties[key] = zodFieldToJsonSchema(field);
      if (!field.isOptional() && field._def.defaultValue === undefined) {
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  // Ensure we always return the proper type shape
  return {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}

function zodFieldToJsonSchema(field: any): Record<string, unknown> {
  const def = field._def;
  const description: string | undefined = def.description;
  const wrap = (s: Record<string, unknown>) =>
    description ? { ...s, description } : s;

  switch (def.typeName) {
    case "ZodString":
      return wrap({ type: "string" });
    case "ZodNumber":
      return wrap({ type: "number" });
    case "ZodBoolean":
      return wrap({ type: "boolean" });
    case "ZodArray":
      return wrap({ type: "array", items: zodFieldToJsonSchema(def.type) });
    case "ZodEnum":
      return wrap({ type: "string", enum: def.values });
    case "ZodOptional":
      return zodFieldToJsonSchema(def.innerType);
    case "ZodDefault":
      return { ...zodFieldToJsonSchema(def.innerType), default: def.defaultValue() };
    case "ZodObject":
      return wrap(zodToJsonSchema(field));
    default:
      return wrap({});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `ambient-mcp-server v1.0.0 connected. Base: ${AMBIENT_BASE_URL}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
