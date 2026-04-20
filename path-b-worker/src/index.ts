/**
 * Ambient Access Layer — Genesis Conductor
 * Main Worker entry point
 */

import { handleStatic } from './static-assets';

interface Env {
  STATIC_ASSETS: {
    get(key: string): Promise<string | null>;
  };
  API_KEYS: KVNamespace;
  TASK_DB: D1Database;
  ADMIN_TOKEN: string;
}

interface ProvisionRequest {
  agent_id: string;
  scopes: string[];
  ttl_days?: number;
}

interface ProvisionedKeyRecord {
  agent_id: string;
  scopes: string[];
  issued_at: string;
  expires_at: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Static assets — served before auth check
    const staticRes = await handleStatic(path, env);
    if (staticRes) return staticRes;

    // Health check (unauthenticated)
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Provision endpoint — admin only, requires X-Admin-Token
    if (path === '/provision' && request.method === 'POST') {
      return handleProvision(request, env);
    }

    // Revoke endpoint — admin only, requires X-Admin-Token
    if (path === '/revoke' && request.method === 'POST') {
      return handleRevoke(request, env);
    }

    // API routes require authentication
    if (path.startsWith('/v1/')) {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const token = authHeader.slice(7);
      
      // Hash the token for lookup
      const encoder = new TextEncoder();
      const tokenData = encoder.encode(token);
      const hashBuffer = await crypto.subtle.digest('SHA-256', tokenData);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      const apiKeyRecord = await env.API_KEYS.get(tokenHash);
      if (!apiKeyRecord) {
        return new Response(JSON.stringify({ error: 'Invalid API key' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Check expiration
      const record = JSON.parse(apiKeyRecord) as ProvisionedKeyRecord;
      if (new Date(record.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: 'API key expired' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Route to specific handlers
      if (path === '/v1/tasks' && request.method === 'POST') {
        return handleCreateTask(request, env);
      }

      if (path.match(/^\/v1\/tasks\/[\w-]+$/) && request.method === 'GET') {
        const taskId = path.split('/').pop()!;
        return handleGetTask(taskId, env);
      }

      if (path.match(/^\/v1\/tasks\/[\w-]+\/approve$/) && request.method === 'POST') {
        const taskId = path.split('/')[3];
        return handleApproveTask(taskId, env);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

async function handleCreateTask(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { type: string; payload: unknown; priority?: string };
    const taskId = crypto.randomUUID();
    
    // In a real implementation, this would insert into D1
    return new Response(JSON.stringify({
      id: taskId,
      status: 'accepted',
      type: body.type,
      created_at: new Date().toISOString(),
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetTask(taskId: string, env: Env): Promise<Response> {
  // Placeholder - would query D1 in production
  return new Response(JSON.stringify({
    id: taskId,
    status: 'pending',
    created_at: new Date().toISOString(),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleApproveTask(taskId: string, env: Env): Promise<Response> {
  // Placeholder - would update D1 in production
  return new Response(JSON.stringify({
    id: taskId,
    status: 'approved',
    approved_at: new Date().toISOString(),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleProvision(request: Request, env: Env): Promise<Response> {
  // Verify admin token
  const adminToken = request.headers.get('X-Admin-Token');
  if (!adminToken || adminToken !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Forbidden: invalid admin token' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: ProvisionRequest;
  try {
    body = await request.json() as ProvisionRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.agent_id || typeof body.agent_id !== 'string') {
    return new Response(JSON.stringify({ error: 'agent_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return new Response(JSON.stringify({ error: 'scopes array is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate API key: gck_ + UUID without dashes
  const rawKey = crypto.randomUUID().replace(/-/g, '');
  const apiKey = `gck_${rawKey}`;

  // Hash the key for storage (SHA-256)
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Calculate expiration
  const ttlDays = body.ttl_days ?? 90;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  const record: ProvisionedKeyRecord = {
    agent_id: body.agent_id,
    scopes: body.scopes,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  // Store hashed key → record in KV
  await env.API_KEYS.put(keyHash, JSON.stringify(record), {
    expirationTtl: ttlDays * 24 * 60 * 60,
  });

  // Log to D1 provisioned_keys table
  try {
    await env.TASK_DB.prepare(`
      INSERT INTO provisioned_keys (key_hash, agent_id, scopes, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      keyHash,
      body.agent_id,
      JSON.stringify(body.scopes),
      issuedAt.toISOString(),
      expiresAt.toISOString()
    ).run();
  } catch (e) {
    // Table may not exist yet - non-fatal, key is still provisioned in KV
    console.warn('Failed to log to provisioned_keys table:', e);
  }

  return new Response(JSON.stringify({
    api_key: apiKey,
    key_id: keyHash.slice(0, 16),
    expires_at: expiresAt.toISOString(),
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RevokeRequest {
  key_id: string;
  reason?: string;
}

async function handleRevoke(request: Request, env: Env): Promise<Response> {
  // Verify admin token
  const adminToken = request.headers.get('X-Admin-Token');
  if (!adminToken || adminToken !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Forbidden: invalid admin token' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: RevokeRequest;
  try {
    body = await request.json() as RevokeRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.key_id || typeof body.key_id !== 'string') {
    return new Response(JSON.stringify({ error: 'key_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // key_id is the first 16 chars of the full hash - need to find matching key
  // List all keys and find the one starting with this prefix
  const listResult = await env.API_KEYS.list();
  let fullKeyHash: string | null = null;
  
  for (const key of listResult.keys) {
    if (key.name.startsWith(body.key_id)) {
      fullKeyHash = key.name;
      break;
    }
  }

  if (!fullKeyHash) {
    return new Response(JSON.stringify({ error: 'Key not found', key_id: body.key_id }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get the key record before deletion for audit
  const existingRecord = await env.API_KEYS.get(fullKeyHash);
  
  // Delete from KV
  await env.API_KEYS.delete(fullKeyHash);

  // Log revocation to D1
  const revokedAt = new Date().toISOString();
  try {
    await env.TASK_DB.prepare(`
      INSERT INTO revoked_keys (key_hash, reason, revoked_at, original_record)
      VALUES (?, ?, ?, ?)
    `).bind(
      fullKeyHash,
      body.reason || 'no_reason_provided',
      revokedAt,
      existingRecord || '{}'
    ).run();
  } catch (e) {
    console.warn('Failed to log to revoked_keys table:', e);
  }

  return new Response(JSON.stringify({
    revoked: true,
    key_id: body.key_id,
    revoked_at: revokedAt,
    reason: body.reason || 'no_reason_provided',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
