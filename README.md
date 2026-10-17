# Baby Monitor

A web app that turns any phone, tablet or wall display into a multi-camera baby
monitor.

- Shows several camera streams at once, in a grid or a "focus" layout with one
  large camera and a strip of thumbnails.
- Tap a stream to hear its audio. Only one stream is audible at a time; tap it
  again to mute.
- Every stream has a live sound-level meter, so you can see noise even while
  its audio is muted.
- A crying icon lights up when Home Assistant reports crying. Temperature and
  humidity come from Home Assistant too.
- Works in portrait and landscape.

> **Status:** foundation. The app shell, config persistence, layouts, level
> meters, Home Assistant polling and WebRTC playback via go2rtc are in place.
> See [Roadmap](#roadmap) for what's next.

## How it works

```
 RTSP cameras ──► go2rtc ──WebRTC (audio+video)──────────────┐
                    ▲                                         ▼
                    │ register streams,              Browser (Vue app)
                    │ SDP offer/answer               - camera tiles + layouts
                    │                                - level meter (Web Audio)
              Node server (Fastify) ◄──── /api ────  - cry / temp overlays
              - config.json on disk
              - Home Assistant proxy ──► Home Assistant REST API
```

- **Browsers cannot play RTSP.** [go2rtc](https://github.com/AlexxIT/go2rtc)
  pulls each camera's RTSP feed and re-serves it to the browser over WebRTC,
  which gives low latency video and audio.
- **The Node server** stores the app config, registers cameras with go2rtc,
  relays WebRTC signalling, and proxies Home Assistant so the HA token never
  reaches the browser.
- **The level meter** analyses each stream's audio track with the Web Audio
  API. It works while the stream is muted because it taps the stream, not the
  speaker.
- **Cry detection** comes from a Home Assistant `binary_sensor` per camera
  (`on` = crying), for example from a cry-detection integration or an audio
  classifier you already run in HA.

## Requirements

- Node.js 22.18+ or 24.12+ (the server runs TypeScript directly via Node's
  type stripping, no build step).
- [go2rtc](https://github.com/AlexxIT/go2rtc) reachable from the server, and
  its WebRTC port reachable from the viewing devices. Docker Compose sets both
  up for you.
- Cameras that send H.264 video (H.265 only plays in Safari). go2rtc's WebRTC
  output does not transcode, so browsers need a matching decoder.
- Home Assistant with a long-lived access token (optional; without it the app
  runs without cry/temperature data).

## Run the whole stack (Docker)

```sh
cp .env.example .env              # optional: set HA_URL and HA_TOKEN
docker compose up -d --build
```

Open `http://<host>:3000` on each device, then tap the gear icon to add
cameras. Add it to the home screen for a full-screen experience.

`docker-compose.yml` runs everything on the host network:

| Service         | Profile         | Port(s)                          | What it is                               |
| --------------- | --------------- | -------------------------------- | ---------------------------------------- |
| `baby-monitor`  | (always)        | 3000                             | This app: API + built client             |
| `go2rtc`        | (always)        | 1984 API, 8554 RTSP, 8555 WebRTC | Turns RTSP feeds into WebRTC             |
| `demo-camera`   | `demo`          | 8654 RTSP                        | Fake camera: test pattern + tone         |
| `homeassistant` | `homeassistant` | 8123                             | Bundled Home Assistant, if you have none |

Turn on the optional services with `--profile`, or list them in
`COMPOSE_PROFILES` in `.env`:

```sh
# Try it without hardware, then add a camera with RTSP URL rtsp://localhost:8654/demo
docker compose --profile demo up -d --build

# No existing Home Assistant? Run one alongside (then create a token in it).
docker compose --profile homeassistant up -d --build
```

App config and go2rtc's saved streams live in the `baby-monitor-data` and
`go2rtc-config` Docker volumes, so they survive rebuilds and never land in
the git working tree. `docker compose down -v` wipes them.

## Development

```sh
npm install
cp .env.example .env              # set HA_URL / HA_TOKEN if you have them
docker compose --profile demo up -d go2rtc demo-camera
npm run dev
```

`npm run dev` starts the API server on port 3000 and the Vite dev server
(default port 5173, listening on the LAN) which proxies `/api` to it. Open the
Vite URL on your phone or tablet, then use the gear icon to add cameras.

For each camera you set:

| Field                | Example                                         |
| -------------------- | ----------------------------------------------- |
| Name                 | `Nursery`                                       |
| ID                   | `nursery` (also used as the go2rtc stream name) |
| RTSP URL             | `rtsp://user:pass@192.168.1.20:554/stream1`     |
| Cry detection entity | `binary_sensor.nursery_crying`                  |
| Temperature entity   | `sensor.nursery_temperature`                    |
| Humidity entity      | `sensor.nursery_humidity`                       |

Outside Docker, config is saved to `data/config.json` (git-ignored).

## Scripts

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | API server (watch mode) + Vite dev server                 |
| `npm run build`      | Type-check and build the client into `dist/`              |
| `npm start`          | Serve the API and built client in production mode         |
| `npm test`           | Run all unit tests (client in jsdom, server in Node)      |
| `npm run lint`       | oxlint + ESLint                                           |
| `npm run type-check` | `vue-tsc` across client, server and tests                 |
| `npm run check`      | Everything CI runs: format check, lint, type-check, tests |

## Configuration

Server settings come from environment variables (see `.env.example`):

| Variable        | Default                 | Purpose                                |
| --------------- | ----------------------- | -------------------------------------- |
| `HA_URL`        | –                       | Home Assistant base URL                |
| `HA_TOKEN`      | –                       | Home Assistant long-lived access token |
| `GO2RTC_URL`    | `http://localhost:1984` | go2rtc API                             |
| `PORT` / `HOST` | `3000` / `0.0.0.0`      | API server bind address                |
| `DATA_DIR`      | `./data`                | Where `config.json` is stored          |

Everything else (cameras, entities, layout) is edited in the app and persisted
by the server.

## Security notes

This is designed for a trusted home network.

- The Home Assistant token stays on the server. The browser can only read the
  entities referenced in the saved config, and the config only accepts
  `sensor.*` and `binary_sensor.*` entities.
- go2rtc saves registered streams, credentials included, in its config
  file (the `go2rtc-config` volume under Docker).
- Camera RTSP URLs (which often include credentials) are stored in the app
  config and are visible in the settings screen to anyone who can
  open the app. Do not expose the app or go2rtc to the internet without a
  reverse proxy that adds authentication.
- The go2rtc API has no authentication; keep port 1984 on the LAN.

## Roadmap

- Push Home Assistant updates to clients via the HA WebSocket API and
  server-sent events instead of polling.
- Local, in-browser cry detection fallback from the audio level.
- Remove go2rtc streams for deleted cameras.
- Optional app login / PIN.
- PWA manifest and wake lock so a tablet can stay on as a monitor.

## Contributing

See [AGENTS.md](AGENTS.md) for architecture, conventions and the PR review
process. Every pull request runs CI (`npm run check` + build) and an automated
Claude review using the project's `pr-review` skill.
