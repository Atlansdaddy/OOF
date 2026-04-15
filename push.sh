#!/bin/bash
# push.sh — stamp build timestamp + commit + push
# Usage: bash push.sh "your commit message"

MSG=${1:-"Update"}
TS=$(date -u +"%Y%m%d%H%M%S")

# Stamp the build timestamp into the HTML meta tag
sed -i "s/content=\"BUILD_TS\"/content=\"$TS\"/" index.html
sed -i "s/content=\"[0-9]\{14\}\"/content=\"$TS\"/" index.html

git add index.html
git commit -m "$MSG (build $TS)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin main

echo ""
echo "✓ Pushed build $TS"
