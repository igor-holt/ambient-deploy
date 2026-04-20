# Global Deployment Setup Guide

## Quick Start (30 minutes)

### 1. **npm Package Publication**

```bash
# Generate NPM token at https://npmjs.com/settings/~/tokens
# Add to GitHub Secrets as NPM_TOKEN

cd path-a-npm
npm ci
npm run build
npm publish  # or let GitHub Actions handle it
```

### 2. **GitHub Pages Dashboard** ✅ Auto

- ✓ Enabled automatically via `.github/workflows/deploy.yml`
- ✓ Dashboard deploys to: `https://username.github.io/ambient-deploy/`
- Access: [dashboard index.html](dashboard/index.html)

### 3. **Deploy Backend API to Fly.io** (Free Tier)

```bash
# Install flyctl: https://fly.io/docs/getting-started/installing-flyctl/
brew install flyctl  # or your package manager

# Login
flyctl auth login

# Create app (one-time)
flyctl launch --name ambient-backend-api --dockerfile

# Deploy
flyctl deploy

# View logs
flyctl logs

# Scale (free tier gets 3x shared CPU-1x 256MB VMs)
flyctl scale count 1
```

**Free tier includes:**
- 3 shared CPU VMs + 3GB RAM total
- 160GB outbound data/month
- Public IPv4 + IPv6
- Auto HTTPS
- Global edge network

### 4. **Deploy HTTP Worker to Deno Deploy** (Free Tier)

```bash
# Install deno
curl -fsSL https://deno.land/install.sh | sh

# Clone path-b-worker as standalone Deno project
# (convert from wrangler to Deno Deploy format)

deno deployctl deploy --project=ambient-mcp path-b-worker/src/index.ts
```

**Or keep Wrangler** (works with free tier too):
```bash
cd path-b-worker
npm install
wrangler deploy  # requires Cloudflare account (free)
```

### 5. **Set GitHub Secrets** for CI/CD

```bash
# GitHub Settings → Secrets and variables → Actions

NPM_TOKEN=npm_xxxxxxxxxxxx          # from npm.com
FLY_API_TOKEN=flpat_xxxxx           # from fly.io dashboard
DENO_DEPLOY_TOKEN=deno_xxxxxx       # from deno.com (if using Deno Deploy)
```

---

## Platform Comparison Matrix

| Component | Platform | Cost | Setup | Uptime | Notes |
|-----------|----------|------|-------|--------|-------|
| **npm Package** | npm Registry | Free | 5 min | 99.99% | Industry standard |
| **Dashboard** | GitHub Pages | Free | 0 min | 99.95% | Auto-deployed |
| **Backend API** | Fly.io | Free | 10 min | 99.9% | Global, auto-scaling |
| **Backend API** | Google Cloud Run | Free | 15 min | 99.95% | 2M req/month free |
| **Backend API** | Railway | Free | 10 min | 99% | $5/mo credit |
| **HTTP Worker** | Deno Deploy | Free | 5 min | 99.99% | Lowest latency |
| **HTTP Worker** | Cloudflare Workers | Free | 5 min | 99.99% | 100k req/day free |

---

## Deployment Checklist

```
○ Create npm token (npm.com → settings → tokens)
○ Add NPM_TOKEN to GitHub Secrets
○ Enable GitHub Pages (repo settings → pages → source main/docs)
○ Create Fly.io account (fly.io)
○ Add FLY_API_TOKEN to GitHub Secrets
○ Test locally: npm run dev
○ Push to main branch
○ Watch GitHub Actions (Actions tab)
○ Verify:
  - npm: https://npmjs.com/package/@kovach-enterprises/ambient-mcp-server
  - Dashboard: https://username.github.io/ambient-deploy/
  - API: https://ambient-backend-api.fly.dev/health
  - Worker: https://ambient.genesisconductor.io/mcp
```

---

## Environment Variables

### Fly.io (Backend API)
```bash
flyctl secrets set AMBIENT_API_KEY="your-key"
flyctl secrets set DATABASE_URL="postgresql://..."
flyctl config save
```

### Cloudflare/Deno (HTTP Worker)
```bash
wrangler secret put AMBIENT_API_KEY
wrangler secret put MCP_SHARED_SECRET
```

---

## Monitoring & Logs

### Fly.io
```bash
flyctl log                    # Real-time logs
flyctl metrics cursor cpu     # CPU usage
flyctl metrics cursor memory  # Memory
```

### GitHub Actions
- Logs auto-visible in repo Actions tab
- Failures trigger email notification

### GitHub Pages
- Status: repo Settings → Pages
- Access logs: not available (but rarely fails)

---

## Cost Breakdown (Monthly)

| Component | Free Tier | Typical Paid |
|-----------|-----------|--------------|
| npm | ✓ Unlimited | — |
| GitHub Pages | ✓ Unlimited | — |
| Fly.io | ✓ 3x vCPU, 3GB RAM | $2/vCPU/mo |
| Deno Deploy | ✓ 100k req/day | $2/100k |
| Cloudflare Workers | ✓ 100k req/day | $5-50/mo |
| **Total** | **✓ $0/mo** | $7-100/mo |

---

## Production Hardening

```bash
# 1. Add rate limiting (nginx middleware or cloudflare)
# 2. Add monitoring (Sentry, Datadog free tier)
# 3. Setup alerting (PagerDuty free tier, Slack)
# 4. Enable CORS restrictions
# 5. Rotate secrets monthly: flyctl secrets unset KEY
# 6. Setup backup strategy (database snapshots)
```

---

## Scaling Future

When you outgrow free tier:

1. **Backend → dedicated instance**: Add paid Fly.io volume ($1/GB/mo)
2. **Worker → higher limits**: Cloudflare Pro ($20/mo)
3. **Database → managed**: Supabase, Render, PlanetScale (varies)
4. **CDN → custom**: Add Bunny CDN ($0.01/GB) for dashboard

Total paid production cost: ~$20-50/mo (vs $100s with AWS alone).
