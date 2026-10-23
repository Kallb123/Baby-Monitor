# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.
`CLAUDE.md` imports this file, so Claude Code reads it automatically.

## Project

Baby Monitor is a Vue 3 web app that shows several camera streams at once,
plays one stream's audio on tap, shows a live sound-level meter per stream,
and overlays cry detection, temperature and humidity from Home Assistant. It
must work on phones and tablets in portrait and landscape, and run for days
on a wall-mounted tablet without a reload.

See `README.md` for the user-facing overview and setup.

## Architecture

```
src/       Vue 3 client (Vite, TypeScript, Pinia, Vue Router)
server/    Node API server (Fastify), run directly via Node type stripping
shared/    Zod config schema + API wire types, imported by both sides
.claude/   Agent definitions and skills (caveman + project pr-review)
```

Data flow:

- **Config**: `shared/config.ts` defines the schema. The server validates every
  write and persists `DATA_DIR/config.json` atomically
  (`server/config-store.ts`). The client loads/saves via `/api/config`
  (`src/stores/config.ts`) and validates forms with the same schema.
- **Video/audio**: cameras are RTSP. The server registers each camera with
  go2rtc (`server/go2rtc.ts`) under the camera id. The client opens a
  receive-only `RTCPeerConnection` and exchanges SDP through
  `POST /api/streams/:id/webrtc` (`src/composables/useWebRtcStream.ts`).
- **Level meter**: `src/composables/useAudioLevel.ts` taps each stream's audio
  track with one shared `AudioContext` (`src/lib/audio-context.ts`). Analysis
  nodes are never connected to the speakers. Audibility is controlled only by
  the `<video>` element's `muted` flag, driven by `useMonitorStore().audioCameraId`.
- **Home Assistant**: the server holds `HA_TOKEN` and exposes
  `GET /api/ha/states`, which returns only the entities referenced in the saved
  config (`server/home-assistant.ts`). A shared HA WebSocket `subscribe_entities`
  subscription, filtered by entity IDs on HA, feeds
  `GET /api/ha/events` over SSE (`server/entity-state-stream.ts`). The client
  reconnects and polls the REST endpoint only while SSE is unavailable
  (`src/composables/useEntityStates.ts`). SSE retries back off from 3 to 60 seconds;
  both connections have heartbeat watchdogs. WebSocket failures log only a local
  phase and reason, never HA payloads, URLs or tokens.
- **Layout**: `src/lib/layout.ts` picks the grid shape that maximises tile area
  for the container size, so orientation is handled without special cases.
  The `focus` layout uses CSS orientation media queries. The layout mode and
  focused camera are per device (`localStorage`, via `useMonitorStore`), with
  the config's `layout` as the default. Don't save them to the server: every
  config save re-registers all streams with go2rtc.
- **Editing**: cameras are edited in place. The header's **+** and **Edit**
  open `CameraDialog.vue`, which validates with the shared schema and saves
  the whole config through the config store.
- **Settings page** (`/settings`, `SettingsView.vue`): per-device app settings
  such as the dB readout and which cameras to hide, kept in `localStorage` by
  `useSettingsStore` (not on the server, for the same reason as the layout),
  plus read-only server settings and a live Home Assistant check from
  `GET /api/system`.
- **History** (`/history`, `HistoryView.vue`, opened from the header's clock
  icon): crying comes from HA's recorder through `GET /api/ha/history`
  (`HomeAssistantClient.getHistory`, converted by `server/cry-history.ts`), so
  the server stores nothing. Sound level and stirring are recorded on each
  device, once a second per live tile, into per-minute buckets
  `[minuteStartMs, peakDb, stirred]` kept for 24 h in `localStorage`
  (`src/lib/sound-history.ts`, `useSoundHistoryStore`, written at most once a
  minute and on `pagehide`; `useSoundHistoryRecording` is called from
  `CameraTile.vue`). Recording stops while the history page is open because the
  tiles are unmounted. `SoundTimeline.vue` draws the SVG, with geometry in
  `src/lib/history-chart.ts`.
- **Hidden cameras**: `MonitorView.vue` passes the grid only the cameras
  `visibleCameras()` (`src/lib/cameras.ts`) keeps, so a hidden camera has no
  tile, no WebRTC connection and no audio tap. Hiding the audio camera stops
  its audio; a hidden focus camera falls back to the first visible one without
  overwriting the saved choice. If all are hidden the monitor points to
  Settings. Ids of deleted cameras are pruned once the config has loaded.

### API

| Method | Path                      | Purpose                                                             |
| ------ | ------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/health`             | Liveness + whether HA is configured                                 |
| GET    | `/api/config`             | Current config                                                      |
| PUT    | `/api/config`             | Validate, persist and return the config; 400 with `issues` on error |
| GET    | `/api/ha/states`          | States of entities referenced by the config                         |
| GET    | `/api/ha/history?hours=N` | Crying intervals per camera from HA history (N 1–24, default 12)    |
| GET    | `/api/ha/events`          | SSE snapshots of configured entities, with heartbeat events         |
| GET    | `/api/system`             | HA URL (credentials stripped), live HA check, go2rtc URL            |
| POST   | `/api/streams/:id/webrtc` | Body: SDP offer (`application/sdp`). Returns SDP answer             |

## Commands

```sh
npm install
npm run dev          # API (port 3000, watch) + Vite (5173, proxies /api)
npm test             # vitest: client project (jsdom) + server project (node)
npm run lint         # oxlint then eslint
npm run type-check   # vue-tsc --build over app, server, node and vitest tsconfigs
npm run format       # prettier
npm run check        # format:check + lint + type-check + test  (run before every PR)
npm run build        # type-check + vite build to dist/
```

Run `npm run check` before you commit. CI runs the same plus a build.

## Conventions

- **TypeScript everywhere.** `strict` and `noUncheckedIndexedAccess` are on.
- **Server and shared code run unbuilt** on Node's type stripping. Use only
  erasable syntax (no `enum`, `namespace`, or constructor parameter
  properties) and import relative files with the `.ts` extension
  (`import { x } from './x.ts'`). `tsconfig.server.json` enforces this.
- **Client imports**: `@/…` for `src/`, `@shared/….ts` for `shared/`.
- **Vue**: `<script setup lang="ts">`, Composition API, typed `defineProps` /
  `defineEmits`. Put reusable stateful logic in `src/composables/use*.ts` and
  pure logic in `src/lib/` so it can be unit tested without a DOM.
- **State**: Pinia setup stores in `src/stores/`. Shared settings go through
  the config store and server; per-device settings go in `localStorage` via
  `src/lib/local-storage.ts`; transient UI state stays in its own store.
- **Validation**: every API input is validated with zod. Add fields to
  `shared/config.ts` rather than declaring types twice.
- **Secrets** never go in `shared/`, the config, API responses or the client.
  They come from server env vars only.
- **Resources**: anything that opens a connection, node, timer, observer or
  animation frame must release it in `onScopeDispose`/`onUnmounted`.
- **Styling**: scoped CSS, design tokens as CSS custom properties in
  `src/assets/main.css`, taken from the "Organic" design system (Caprasimo
  headings over Figtree, self-hosted via `@fontsource`; terracotta accent,
  sage second accent; pill buttons, heavily rounded tiles; Lucide icons at
  stroke 2.75 in `AppIcon.vue`). Use the ramp tokens rather than new hex
  values. Dark theme by default (it's used in a dark nursery).
  Respect safe-area insets and `prefers-reduced-motion`.
- **Tests**: `*.spec.ts` in a `__tests__/` folder next to the code. Server
  routes are tested with `app.inject()` and injected `fetch` fakes; never call
  real Home Assistant or go2rtc from tests.
- **Formatting**: Prettier (no semicolons, single quotes, 100 columns).
- **Comments** explain why, not what.

## Commits and pull requests

- Commit messages follow Conventional Commits (`feat(server): …`,
  `fix(client): …`). The vendored `caveman-commit` skill writes them in this
  style.
- Keep PRs focused; fill in `.github/pull_request_template.md`.
- UI changes: check portrait and landscape at phone and tablet sizes.

## PR review

Every PR gets two automated checks:

1. **CI** (`.github/workflows/ci.yml`): format, lint, type-check, tests, build.
2. **Claude review** (`.github/workflows/claude-review.yml`): runs the
   `pr-review` skill, which delegates the line-level pass to the
   `cavecrew-reviewer` agent and then applies the project checklist (secrets,
   API validation, media lifecycle, layout, tests). Findings are posted as
   inline comments in the terse `caveman-review` format plus one summary
   comment. Requires the `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
   repository secret; without one the job is skipped.

To review locally in Claude Code, run `/pr-review`. The checklist lives in
`.claude/skills/pr-review/SKILL.md`; update it when you add a rule the
reviewer should enforce.

## Agents and skills in `.claude/`

| Name                    | Kind            | Use                                                      |
| ----------------------- | --------------- | -------------------------------------------------------- |
| `pr-review`             | skill (project) | Full PR review: reviewer agent + project checklist       |
| `cavecrew-reviewer`     | agent           | Terse, severity-tagged diff review, one line per finding |
| `cavecrew-investigator` | agent           | Read-only code locator, returns `path:line` tables       |
| `cavecrew-builder`      | agent           | Surgical 1–2 file edits                                  |
| `cavecrew`              | skill           | When to delegate to the three agents above               |
| `caveman-review`        | skill           | Review comment format                                    |
| `caveman-commit`        | skill           | Conventional Commit message writer                       |
| `caveman` / `ultracave` | skills          | Opt-in terse chat voice (`/caveman`)                     |

The caveman files are vendored verbatim from
[JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman); see
`.claude/vendor/caveman/README.md` for the pinned commit, licence and how to
update them. Don't edit them in place; put project-specific rules in
`pr-review` instead. Caveman voice applies to chat only: code, comments, docs,
commits and PR descriptions are written in normal prose.

## Gotchas

- Mobile browsers keep the `AudioContext` suspended until the first tap, so
  level meters are flat until then; the monitor shows a hint.
- Unmuting must happen synchronously inside the tap handler, or iOS blocks
  audio. `CameraTile.vue` unmutes the `<video>` in its click handler before
  updating the store; don't move that into a watcher.
- Streams added through the go2rtc API may not survive a go2rtc restart, so the
  server re-registers all cameras on startup and on every config save. go2rtc
  also writes those streams (with RTSP credentials) into its config file, which
  is why Compose keeps it in the `go2rtc-config` volume. Compose layers a fixed
  base config over that file so ports can't drift. Pipeline ports come from
  `.env` (see `.env.example`); `GO2RTC_API_PORT` also drives the app's default
  go2rtc URL and the go2rtc health check. `GO2RTC_URL` explicitly overrides
  only the app's connection URL for an external instance.
- Every push to `main` builds the app image for amd64 and arm64 and pushes it
  to `ghcr.io/kallb123/baby-monitor` (`.github/workflows/docker.yml`), tagged
  `latest` and `sha-<commit>`. Compose uses that image and keeps `build: .`
  so `up --build` still runs local changes.
- `docker compose --profile demo` adds a fake H.264 + Opus camera at
  `rtsp://localhost:8654/demo` for end-to-end testing without hardware (use
  `DEMO_RTSP_PORT` instead of 8654 if changed).
- go2rtc does not transcode for WebRTC, and if the browser can't take the
  source's video codec, negotiation fails entirely (audio included). In
  testing with go2rtc 1.9.14 even a VP8 source failed against Playwright's
  bundled Chromium, which lacks H.264. Test video in real Chrome/Safari with
  an H.264 camera.
- Long-running tablets: API calls time out, config load and streams retry, a
  stats watchdog reconnects frozen streams, and the router reloads on stale
  lazy chunks after a redeploy. Keep these paths working when you touch them.
- WebRTC from go2rtc needs its WebRTC port (8555 by default) reachable from
  the viewing device. Docker Compose uses host networking for this reason.
