#!/usr/bin/env node
/**
 * ambient CLI — Genesis Conductor Ambient Agent Access Layer
 *
 * Uses native Node 18+ fetch (no node-fetch dependency).
 * Covers: submit, status (job + workspace), list, approve, reject.
 */

import { Command } from "commander";

const API_URL = process.env.AMBIENT_API_URL ?? "https://optimization-inversion.genesisconductor.io";
const API_KEY = process.env.AMBIENT_API_KEY;

if (!API_KEY) {
  console.error("CRITICAL: AMBIENT_API_KEY environment variable is missing.");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${data?.error ?? res.statusText}`);
    process.exit(2);
  }
  return data as T;
}

const program = new Command();

program
  .name("ambient")
  .description("CLI access layer for the Genesis Conductor agent graph")
  .version("1.0.0");

// ─── submit ────────────────────────────────────────────────────────────────

program
  .command("submit")
  .description("Submit a new task to background agents")
  .argument("<title>", "Task title (max 80 chars)")
  .option("-t, --type <type>", "request_type", "implement_feature")
  .option("-d, --desc <desc>", "Task description (verbatim)")
  .option("-p, --priority <priority>", "critical|high|normal|low", "normal")
  .option("--tier <tier>", "Policy tier: standard|prod_sensitive", "standard")
  .option("--approval", "Force requires_approval=true", false)
  .option("--agent <agent>", "Override candidate agent (kiro|codex|claude|gemini|copilot)")
  .option("--ref <refs...>", "Context refs, e.g. repo:name spec:name")
  .action(async (title, opts) => {
    const body: any = {
      source_surface: "cli",
      request_type: opts.type,
      title,
      description: opts.desc ?? title,
      requested_by: process.env.USER ?? "cli-user",
      priority: opts.priority,
      policy_tier: opts.tier,
      requires_approval: !!opts.approval,
    };
    if (opts.agent) body.candidate_agents = [opts.agent];
    if (opts.ref?.length) body.context_refs = opts.ref;

    const res = await request<any>("/v1/tasks", { method: "POST", body: JSON.stringify(body) });
    console.log(JSON.stringify(res, null, 2));
  });

// ─── status ────────────────────────────────────────────────────────────────

const status = program.command("status").description("Inspect jobs or workspace state");

status
  .command("job <job_id>")
  .description("Get lifecycle state of a job")
  .action(async (jobId) => {
    const res = await request(`/v1/jobs/${encodeURIComponent(jobId)}`);
    console.log(JSON.stringify(res, null, 2));
  });

status
  .command("workspace <workspace_id>")
  .description("KV-backed state projection for a workspace")
  .action(async (workspaceId) => {
    const res = await request(`/v1/state/${encodeURIComponent(workspaceId)}`);
    console.log(JSON.stringify(res, null, 2));
  });

// ─── list ──────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List jobs with optional status filter")
  .option("-w, --workspace <id>", "Filter by workspace_id")
  .option("-s, --status <status>", "pending|running|blocked|complete|failed|cancelled")
  .option("-l, --limit <n>", "Page size (max 100)", "25")
  .option("-o, --offset <n>", "Pagination offset", "0")
  .action(async (opts) => {
    const qs = new URLSearchParams();
    if (opts.workspace) qs.set("workspace_id", opts.workspace);
    if (opts.status) qs.set("status", opts.status);
    qs.set("limit", opts.limit);
    qs.set("offset", opts.offset);
    const res = await request(`/v1/jobs?${qs}`);
    console.log(JSON.stringify(res, null, 2));
  });

// ─── approve / reject ──────────────────────────────────────────────────────

program
  .command("approve <approval_id>")
  .description("Approve a blocked task (unblocks the job)")
  .action(async (approvalId) => {
    const res = await request(`/v1/approvals/${encodeURIComponent(approvalId)}/approve`, {
      method: "POST",
      body: "{}",
    });
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command("reject <approval_id>")
  .description("Reject a blocked task (cancels the job)")
  .action(async (approvalId) => {
    const res = await request(`/v1/approvals/${encodeURIComponent(approvalId)}/reject`, {
      method: "POST",
      body: "{}",
    });
    console.log(JSON.stringify(res, null, 2));
  });

program.parse();
