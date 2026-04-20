/**
 * Static asset handler for discoverability files
 * Serves llms.txt, .well-known/*, robots.txt, sitemap.xml
 */

const STATIC_PATHS = new Set([
  '/llms.txt',
  '/llms-full.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/.well-known/mcp.json',
  '/.well-known/ai-plugin.json',
  '/.well-known/security.txt',
  '/.well-known/ai.txt',
  '/openapi.yaml',
  '/index.html',
  '/',
]);

const MIME: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

interface Env {
  STATIC_ASSETS: {
    get(key: string): Promise<string | null>;
  };
}

export async function handleStatic(path: string, env: Env): Promise<Response | null> {
  // Normalize root to index.html
  const normalizedPath = path === '/' ? '/index.html' : path;
  
  if (!STATIC_PATHS.has(path) && !STATIC_PATHS.has(normalizedPath)) {
    return null;
  }
  
  const assetKey = normalizedPath.replace(/^\//, '');
  const asset = await env.STATIC_ASSETS.get(assetKey);
  
  if (!asset) {
    return new Response('Not found', { status: 404 });
  }
  
  const ext = normalizedPath.slice(normalizedPath.lastIndexOf('.'));
  const contentType = MIME[ext] ?? 'text/plain; charset=utf-8';
  
  return new Response(asset, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'index, follow',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
