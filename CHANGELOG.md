# Changelog

## Unreleased

## v1.0.0 (2026-11-24)

### Added
- `SKILL.md`: principles, six-step workflow with what to run and report at each step, symptom → cause → reference table, budgets, checklist, post-cache verification.
- `references/`: caching, rendering, frontend, backend, stacks (Next.js 14/15/16, Cloudflare, Vercel, Nginx + CloudFront, Astro, Remix), measurement, migration, case studies, conflicts (21 rulings).
- `scripts/check-cache.sh`: cache headers, HIT/MISS, TTFB, cached Set-Cookie detection, bot-block detection.
- `scripts/lh-compare.mjs`: alternating A/B Lighthouse runs, per-metric medians, bootstrap 95% CI.
- `scripts/parity.mjs`: SEO and response parity between two servers, exit code 1 on differences.
- `examples/`: Nginx microcache, LHCI config, web-vitals RUM beacon.
- Claude Code plugin and marketplace manifests.
