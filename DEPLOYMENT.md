# DEPLOYMENT.md — Ambient Access Layer Production Rollout

Single-pass execution manifest. Every step has a `depends_on` reference in `deploy.jsonl` — copilot fleet consumes that JSONL and executes the graph.

## Topology

```
        ┌──────────────────────────┐
        │ ANY MODEL / ANY SURFACE  │
        └──────────┬───────────────┘
                   │
     ┌─────────────┴──────────────┐
     │                            │
┌────▼────────┐          ┌────────▼────────────┐
│ Path A      │          │ Path B              │
│ stdio MCP   │          │ HTTP MCP (CF Worker)│
│ (npm)       │          │ ambient.gc.io/mcp   │
└────┬────────┘          └────────┬────────────┘
     │                            │
     │     Bearer-token forward   │
     └──────────────┬─────────────┘
                    │
        ┌───────────▼──────────────┐
        │ Ambient Backend API      │
        │ optimization-inversion   │
        │ .genesisconductor.io     │
        │  ├─ D1 capsule_events    │
        │  ├─ KV STATE_PROJECTION  │
        │  └─ Webhooks + Slack     │
        └───────────┬──────────────┘
                    │
        ┌───────────▼──────────────┐
        │ Operator Console         │
        │ console.gc.io            │
        └──────────────────────────┘
```

## Phase Sequence

| Step | Phase | Depends On | Approval | Agent | Description |
|------|-------|------------|----------|-------|-------------|
| 1 | backend-patches | — | ✓ | codex | Atomic batch fix in approvals.ts |
| 2 | backend-patches | 1 | ✗ | codex | Full UUID in capsule_events.event_id |
| 3 | backend-patches | 2 | ✗ | codex | Extend OpenAPI to cover jobs + approvals |
| 4 | backend-patches | 3 | ✗ | codex | Extended CLI (drop node-fetch, add flags) |
| 5 | backend-deploy | 4 | ✓ | kiro | Deploy patched backend Worker |
| 6 | path-a-npm | 5 | ✓ | copilot | Build + publish `@kovach-enterprises/ambient-mcp-server` |
| 7 | path-b-worker | 6 | ✓ | copilot | Deploy `ambient-mcp-worker` to `/mcp` |
| 8 | dashboard | 7 | ✓ | kiro | Deploy operator console to CF Pages |
| 9 | verification | 8 | ✗ | claude | Invariance test matrix across all surfaces |
| 10 | publication | 9 | ✗ | kiro | Publish llms.txt to 3 public URLs |

## Bundle Layout

```
ambient-deploy/
├── DEPLOYMENT.md            ← this file
├── deploy.jsonl             ← 10 envelopes, submit to Ambient fleet
├── path-a-npm/              ← Step 6 artifact
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   ├── llms.txt
│   └── src/index.ts         ← stdio MCP, 6 tools
├── path-b-worker/           ← Step 7 artifact
│   ├── package.json
│   ├── wrangler.toml
│   ├── tsconfig.json
│   └── src/index.ts         ← Streamable HTTP JSON-RPC 2.0 shim
├── backend-additions/       ← Steps 1-4 artifacts
│   ├── src/
│   │   ├── db/queries.ts           (UUID fix)
│   │   ├── notifications.ts
│   │   └── handlers/
│   │       ├── state.ts
│   │       └── approvals.ts        (atomic batch fix)
│   ├── schema/openapi.yaml          (extended endpoints)
│   └── cli/src/index.ts             (rewritten)
└── dashboard/
    └── index.html           ← Step 8 artifact (self-contained)
```

## Manual Submission (if fleet unavailable)

Stream the manifest in one shot:

```bash
while IFS= read -r line; do
  curl -s -X POST https://optimization-inversion.genesisconductor.io/v1/tasks \
    -H "Authorization: Bearer $AMBIENT_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$line"
  sleep 0.1
done < deploy.jsonl
```

The backend will honor `depends_on` if the field is in the API contract; otherwise submit steps sequentially, gating each on the previous step's `status: complete` via `GET /v1/jobs/{job_id}`.

## Invariants

- **Path A** eliminates the `MODULE_NOT_FOUND` failure mode permanently — no local build step for consumers.
- **Path B** is the canonical distribution surface. `llms.txt` at `ambient.genesisconductor.io/llms.txt` is the single-URL integration doc.
- **Backend patches** fix atomicity (approvals), collision risk (event IDs), API coverage (OpenAPI), and CLI utility.
- **Dashboard** is read-only-by-default; write actions (approve/reject/submit) require the same bearer as CLI.

## Rollback

Each step produces a Git tag. Rollback = `git revert <tag> && <redeploy>`.

| Surface | Rollback command |
|---------|------------------|
| Backend Worker | `wrangler rollback` |
| Path A npm | `npm deprecate @kovach-enterprises/ambient-mcp-server@1.0.0 "rolled back"` |
| Path B Worker | `wrangler rollback` |
| Dashboard | `wrangler pages deployment list` → redeploy prior |

## Post-Deploy Verification

```bash
# Path A
npx -y @kovach-enterprises/ambient-mcp-server < /dev/null
# Expected: stderr "ambient-mcp-server v1.0.0 connected"

# Path B
curl -s https://ambient.genesisconductor.io/mcp/health | jq .
# Expected: {ok:true, tools:6, protocol:"2025-11-25"}

# Dashboard
open https://console.genesisconductor.io
# Expected: loads, prompts API key on first visit, shows live workspace state
```

Ground truth: if all three verify, the Ambient Access Layer is globally accessible.
