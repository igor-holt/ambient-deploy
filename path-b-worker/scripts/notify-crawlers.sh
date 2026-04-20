#!/bin/bash
# Notify search engines about sitemap and new content
# Run after deployment: ./scripts/notify-crawlers.sh

SITE_URL="https://optimization-inversion.genesisconductor.io"

echo "Notifying search engines..."

# Google ping
echo "Pinging Google..."
curl -sI "https://www.google.com/ping?sitemap=${SITE_URL}/sitemap.xml" | head -1

# Bing ping  
echo "Pinging Bing..."
curl -sI "https://www.bing.com/ping?sitemap=${SITE_URL}/sitemap.xml" | head -1

# IndexNow (Bing/Yandex instant indexing)
# Requires INDEXNOW_KEY environment variable
if [ -n "$INDEXNOW_KEY" ]; then
  echo "Submitting to IndexNow..."
  curl -sX POST "https://api.indexnow.org/indexnow" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "optimization-inversion.genesisconductor.io",
      "key": "'"$INDEXNOW_KEY"'",
      "urlList": [
        "https://optimization-inversion.genesisconductor.io/",
        "https://optimization-inversion.genesisconductor.io/llms.txt",
        "https://optimization-inversion.genesisconductor.io/openapi.yaml"
      ]
    }'
  echo ""
else
  echo "INDEXNOW_KEY not set, skipping IndexNow submission"
fi

echo "Done!"
