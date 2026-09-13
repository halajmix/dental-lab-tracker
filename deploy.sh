#!/usr/bin/env bash
# Build and publish the app to GitHub Pages (gh-pages branch).
set -euo pipefail

cd "$(dirname "$0")"
REPO_URL="https://github.com/halajmix/dental-lab-tracker.git"

echo "▸ Checking for undefined JSX components…"
node scripts/check-jsx-undef.mjs
echo "▸ Checking for undefined identifiers…"
node scripts/check-undef.mjs

echo "▸ Building production bundle…"
NODE_ENV=production npm run build

# Keep prior hashed chunks for open tabs after a reviewed release or rollback.
# This never replaces the newly built entry, service worker, or current assets.
if [[ -n "${DEPLOY_RETAIN_ASSETS_FROM:-}" ]]; then
  [[ -d "$DEPLOY_RETAIN_ASSETS_FROM" ]] || { echo "Previous assets directory missing" >&2; exit 1; }
  cp -Rn "$DEPLOY_RETAIN_ASSETS_FROM/." dist/assets/
fi

# GitHub Pages: skip Jekyll processing, and serve index.html for unknown paths.
touch dist/.nojekyll
cp dist/index.html dist/404.html

echo "▸ Publishing dist/ to gh-pages…"
rm -rf dist/.git
cd dist
git init -q
git config user.name "halajmix"
git config user.email "alajmix@gmail.com"
git add -A
git commit -q -m "Deploy $(date -u '+%Y-%m-%d %H:%M UTC')"
git push -q -f "$REPO_URL" main:gh-pages
rm -rf .git

echo "✓ Live at https://dr-crown.com (allow ~1 min for CDN, longer on first-ever DNS propagation)"
