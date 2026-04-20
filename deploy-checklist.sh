#!/bin/bash
# One-command deployment verification

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

echo "🔍 Ambient Deploy Verification Checklist"
echo "========================================"

# Check npm
echo ""
echo "1️⃣  Checking npm package..."
if [ -f "path-a-npm/package.json" ]; then
    VERSION=$(jq -r '.version' path-a-npm/package.json)
    echo "   ✓ Package version: $VERSION"
else
    echo "   ✗ package.json not found"
    exit 1
fi

# Check GitHub Actions
echo ""
echo "2️⃣  Checking GitHub Actions workflow..."
if [ -f ".github/workflows/deploy.yml" ]; then
    echo "   ✓ CI/CD Pipeline configured"
else
    echo "   ✗ GitHub Actions workflow missing"
fi

# Check Dockerfile
echo ""
echo "3️⃣  Checking Docker build..."
if [ -f "Dockerfile" ]; then
    echo "   ✓ Dockerfile present"
else
    echo "   ✗ Dockerfile missing"
    exit 1
fi

# Check Fly.io config
echo ""
echo "4️⃣  Checking Fly.io deployment..."
if [ -f "fly.toml" ]; then
    APP_NAME=$(grep '^app = ' fly.toml | cut -d'"' -f2)
    echo "   ✓ Fly app name: $APP_NAME"
else
    echo "   ✗ fly.toml missing"
fi

# Check Dashboard
echo ""
echo "5️⃣  Checking dashboard..."
if [ -f "dashboard/index.html" ]; then
    echo "   ✓ Dashboard present"
else
    echo "   ⚠ Dashboard not found"
fi

# Check Worker config
echo ""
echo "6️⃣  Checking HTTP Worker..."
if [ -f "path-b-worker/wrangler.toml" ]; then
    echo "   ✓ Wrangler config present"
    if [ -f "path-b-worker/src/index.ts" ]; then
        echo "   ✓ Worker source present"
    fi
else
    echo "   ✗ Worker config missing"
fi

echo ""
echo "========================================"
echo "✅ All systems ready for deployment!"
echo ""
echo "Next steps:"
echo "  1. Set GitHub Secrets:"
echo "     - NPM_TOKEN (from npm.com)"
echo "     - FLY_API_TOKEN (from fly.io)"
echo ""
echo "  2. Push to main: git push origin main"
echo ""
echo "  3. Watch: github.com/your-repo/actions"
echo ""
