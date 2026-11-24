# Attributions

site-speed-optimization was designed by installing and running the projects below on real tasks, then writing new rules where they agreed and ruling where they conflicted ([`references/conflicts.md`](references/conflicts.md)). No text was copied. Ideas are credited here.

## Skills studied

| Project | License | Idea used |
|---|---|---|
| [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) | MIT | Field data first, then a trace for the cause; call code-only findings hypotheses; budgets as adjustable starting values |
| [cloudflare/skills](https://github.com/cloudflare/skills) (`web-perf`) | Apache-2.0 | Prefer retrieval over memory for thresholds and APIs; detect the framework and bundler before recommending fixes; quantify impact before prioritizing |
| [nimajafari/lighthouse-skill](https://github.com/nimajafari/lighthouse-skill) | MIT | Run Lighthouse several times and keep compact JSON for agents; budgets through LHCI assertions instead of the removed budget flag |

Reviewed and not used: [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) has no license file, so nothing was taken from it.

## Case studies

| Source | Used for |
|---|---|
| 권정혁 (xguru), [작은 서버로 큰 트래픽을 버티는 법](https://hada.io/blog/geeknews-cache-on-a-budget/), 2026-08-07 | Cache layers, personalization split, TTL by content age, hit-rate analysis |
| Yagiz Nizipli, [Rebuilding the global town square from scratch](https://blog.x.com/en/engineering/rebuilding-the-global-town-square-from-scratch), X Engineering, 2026-11-04 | Streaming SSR, data reuse, chunk count, CSS-first loading, crawler responses, event-loop timeouts, parity checks, gradual rollout |

Figures from both posts are summarized in our own words in [`references/case-studies.md`](references/case-studies.md).
