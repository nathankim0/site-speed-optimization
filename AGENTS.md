# AGENTS.md

Instructions for any coding agent (Claude Code, Codex, others) working in this repository. `CLAUDE.md` is a symlink to this file; edit `AGENTS.md` only.

## What this repo is

An agent skill, `site-speed-optimization`, that takes a slow website from diagnosis to a measured fix. The skill lives at the repository root so it can be cloned straight into a skills folder; it is also a Claude Code plugin through `.claude-plugin/`.

```text
SKILL.md                     entry point: principles, workflow, routing table, checklists (Korean)
references/*.md              detail loaded on demand; conflicts.md records rulings between sources
scripts/check-cache.sh       cache header and HIT/MISS check (bash 3.2 + curl)
scripts/lh-compare.mjs       repeated Lighthouse runs, A/B medians, bootstrap CI (Node 20+)
scripts/parity.mjs           SEO/response parity between two servers (Node 20+, no deps)
examples/                    nginx microcache, lighthouserc.json, web-vitals beacon
.claude-plugin/              plugin.json and marketplace.json (version files)
ATTRIBUTIONS.md              projects and posts the skill learned from
README.md, README.ko.md      English and Korean READMEs, kept in sync
```

## Rules for every change

1. **Commit and push after every change.** One logical change per commit. Push to `main` right after committing. Do not leave work uncommitted at the end of a task.
2. **Release only for distribution changes.** A change is a distribution change when it alters what users install or how the skill behaves: `SKILL.md`, `references/`, `scripts/`, `examples/`, `.claude-plugin/`. For these:
   - bump the version one step in `.claude-plugin/plugin.json` (`version`) and `.claude-plugin/marketplace.json` (`metadata.version`): patch for fixes and wording, minor for new references, scripts, or stacks, major for renamed scripts or changed flags
   - move the `Unreleased` notes in `CHANGELOG.md` under the new version
   - commit `Release vX.Y.Z`, push, then tag and release:
     ```bash
     git tag -a vX.Y.Z -m "vX.Y.Z"
     git push origin vX.Y.Z
     gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes>
     ```
3. **Docs-only changes do not release.** README, AGENTS.md, ATTRIBUTIONS.md, images, comments, and typo fixes are committed and pushed with no version bump, tag, or release.
4. **Keep READMEs in sync.** Any change to `README.md` gets the same change in `README.ko.md`, and the reverse.
5. **Validate before committing** a distribution change:
   ```bash
   claude plugin validate .
   bash -n scripts/check-cache.sh && shellcheck scripts/check-cache.sh
   node --check scripts/lh-compare.mjs && node --check scripts/parity.mjs
   ```
   When a script changes, run it for real against two local HTTP servers that return different headers and meta tags.
6. **Never commit secrets or private information**: no tokens, employer or internal names, personal emails, or home paths.

## Project rules

- **Verify before writing.** Framework APIs, CDN behavior, and browser support go in only after checking the official docs; write the check date, or mark the item "확인 필요". Next.js, Vite, Lighthouse, and CDN defaults change between versions, so name the version.
- **Case-study numbers stay exact** and always carry the source link. Summarize in your own words; do not quote long passages.
- **Keep `SKILL.md` under 500 lines.** Move detail to `references/`.
- **Scripts stay dependency-free.** Node 20+ built-ins and bash + curl only; external tools run through `npx`. Every script supports `--help`, a human table, `--json`, and an error message that says what to check.
- **New conflicts get a ruling.** When a new source disagrees with a rule, add a row to `references/conflicts.md` with the condition that decides it.
- No text copied from other skills; nothing taken from repos without a license. Credit ideas in `ATTRIBUTIONS.md`.

## Commit messages

Imperative, short subject. Example: `Detect cached Set-Cookie by comparing values across HITs`.
