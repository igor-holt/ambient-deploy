# @kovach-enterprises/ambient-mcp-server

Stdio MCP server for the Genesis Conductor Ambient Agent Access Layer.

Surfaces 6 tools to submit and manage asynchronous tasks across kiro / codex / claude / gemini / copilot agents.

## Install

```bash
npm install -g @kovach-enterprises/ambient-mcp-server
```

Or invoke via `npx` with no install:

```bash
npx -y @kovach-enterprises/ambient-mcp-server
```

## Configure (Claude Desktop)

```json
{
  "mcpServers": {
    "ambient": {
      "command": "npx",
      "args": ["-y", "@kovach-enterprises/ambient-mcp-server"],
      "env": {
        "AMBIENT_API_KEY": "<your_key>",
        "AMBIENT_BASE_URL": "https://optimization-inversion.genesisconductor.io"
      }
    }
  }
}
```

## Tools

| Tool | Read-only | Destructive | Description |
|------|-----------|-------------|-------------|
| `ambient_submit_task` | ✗ | ✗ | Queue an async task. Returns `task_id`, `job_id`, `workspace_id`. |
| `ambient_get_job_status` | ✓ | ✗ | Poll job lifecycle, stage, progress. |
| `ambient_get_workspace_state` | ✓ | ✗ | KV-backed state projection (< 50ms). |
| `ambient_list_jobs` | ✓ | ✗ | Paginated job list with status filter. |
| `ambient_approve_task` | ✗ | ✓ | Unblock an approval-gated job. |
| `ambient_reject_task` | ✗ | ✓ | Cancel an approval-gated job. |

## Env

| Variable | Required | Default |
|----------|----------|---------|
| `AMBIENT_API_KEY` | Yes | — |
| `AMBIENT_BASE_URL` | No | `https://optimization-inversion.genesisconductor.io` |

## License

MIT — © 2026 Kovach Enterprises
