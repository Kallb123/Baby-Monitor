---
name: pr-review
description: >
  Review a Baby Monitor pull request or local diff: run the cavecrew-reviewer
  agent for line-level bugs, then check the project-specific rules (secrets,
  API validation, media lifecycle, layout, tests). Use for "review this PR",
  "review my changes", /pr-review, and in the Claude PR review workflow.
---

# Baby Monitor PR review

Review the change in front of you. Report findings only. Never approve, merge,
push, or edit code from this skill.

## 1. Get the diff

- PR in CI: `gh pr diff <number>` and `gh pr view <number>`.
- Local: `git diff origin/main...HEAD` plus `git diff` for uncommitted work.

Read `AGENTS.md` first if it is not already in context. Read surrounding code
when a hunk alone cannot show whether something is wrong.

## 2. Line-level pass

Spawn the `cavecrew-reviewer` agent with the diff (or the PR number and the
command to fetch it). It returns `path:line: <emoji> <severity>: <problem>. <fix>.`
lines. Verify each finding against the code before keeping it: drop anything
you cannot trace to a real input or caller.

## 3. Project checklist

Check every item that the diff touches. Each failure is a finding.

**Secrets and trust boundary**

- `HA_TOKEN` and other secrets stay server-side: never in `shared/`, the config
  schema, an API response, the client bundle, logs, or committed files.
- Server endpoints that call Home Assistant or go2rtc use base URLs from env
  only. No endpoint lets the client choose a URL or an arbitrary HA entity
  (SSRF / data exposure). `/api/ha/states` only serves entities referenced by
  the saved config.
- `.env`, `data/` and real camera URLs or credentials are not committed.

**API and config**

- Every request body is validated with zod, normally via `shared/config.ts`.
- Schema changes keep old `data/config.json` files loading. Breaking changes
  bump `CONFIG_VERSION` and add a migration plus a test.
- Client and server share types from `shared/`; no duplicated wire types.

**Server runtime**

- `server/` and `shared/` run unbuilt on Node type stripping: erasable syntax
  only (no `enum`, `namespace`, constructor parameter properties), and relative
  imports carry the `.ts` extension.
- Config writes stay atomic (temp file + rename) and serialised.

**Media and audio**

- At most one camera is audible. Level meters analyse the `MediaStream` and
  never connect to `AudioContext.destination`.
- Every `RTCPeerConnection`, `AudioNode`, timer, observer and animation frame
  is released on unmount or camera change. This app runs for days on a wall
  tablet; leaks are bugs.
- Streams recover from drops without a page reload (backoff retry).
- Audio unmute happens inside the user's tap gesture (mobile autoplay rules).

**Layout and UX**

- Works in portrait and landscape, phone and tablet. Tiles never overflow the
  viewport; respect `env(safe-area-inset-*)`.
- Touch targets at least 40px. No hover-only affordances.
- Cry state is visible without colour alone (icon/animation plus colour) and
  honours `prefers-reduced-motion`.

**Tests and tooling**

- New logic has unit tests (`*.spec.ts` in a sibling `__tests__/` folder).
- `npm run check` passes (format, lint, type-check, tests).

## 4. Report

Use the `caveman-review` format: one line per finding,
`<file>:L<line>: <emoji> <severity>: <problem>. <fix>.`, severities
🔴 bug, 🟡 risk, 🔵 nit, ❓ q. Security findings get a full plain-English
paragraph first (auto-clarity), then the terse line.

- In CI: post each 🔴 and 🟡 finding as an inline comment on its line. Then post
  one summary comment: findings grouped by severity, the checklist sections
  you checked, and `totals: N🔴 N🟡 N🔵 N❓`. Zero findings: summary says
  `No issues.` and lists the sections checked.
- Locally: print the findings and totals.

Skip 🔵 nits unless asked for a thorough review. No praise, no restating the
diff, no refactor proposals beyond the change's scope.
