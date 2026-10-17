# Vendored from Caveman

The following files are copied verbatim from
[JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) at commit
`81958ad82f2e2da4417778f81f8a3c838d81b798` (plugin version 4.0.1):

| Repo path                                 | Upstream path                     |
| ----------------------------------------- | --------------------------------- |
| `.claude/agents/cavecrew-reviewer.md`     | `agents/cavecrew-reviewer.md`     |
| `.claude/agents/cavecrew-investigator.md` | `agents/cavecrew-investigator.md` |
| `.claude/agents/cavecrew-builder.md`      | `agents/cavecrew-builder.md`      |
| `.claude/skills/caveman/SKILL.md`         | `skills/caveman/SKILL.md`         |
| `.claude/skills/ultracave/SKILL.md`       | `skills/ultracave/SKILL.md`       |
| `.claude/skills/caveman-review/SKILL.md`  | `skills/caveman-review/SKILL.md`  |
| `.claude/skills/caveman-commit/SKILL.md`  | `skills/caveman-commit/SKILL.md`  |
| `.claude/skills/cavecrew/SKILL.md`        | `skills/cavecrew/SKILL.md`        |

They are licensed under the Apache License 2.0 (`LICENSE`), with
pre-3.0.0 contributions also available under the MIT License (`LICENSE-MIT`).
See `NOTICE` for attribution. "Caveman" is a trademark of Julius Brussee; this
project is not affiliated with or endorsed by Caveman.

Only the hook-free parts were vendored. The upstream plugin's SessionStart /
UserPromptSubmit hooks (which auto-enable caveman voice and track stats) are
deliberately not installed, so caveman voice stays opt-in via `/caveman`.

## Updating

Do not edit the vendored files in place. To update, copy the files above from
a newer upstream commit, update the commit hash in this README, and review the
diff like any other PR. Project-specific review rules live in
`.claude/skills/pr-review/SKILL.md`, which is ours to edit.
