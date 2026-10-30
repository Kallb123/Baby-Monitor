# Baby Monitor

A web app that turns any phone, tablet or wall display into a multi-camera baby
monitor.

- Shows several camera streams at once, in a grid or a "focus" layout with one
  large camera and a strip of thumbnails. Each device remembers its own layout.
- Tap a stream to hear its audio. Only one stream is audible at a time; tap it
  again to mute.
- Every stream has a live sound-level meter, so you can see noise even while
  its audio is muted.
- A tile glows and shows a "Crying" badge when Home Assistant reports crying,
  and reads "Stirring" while its sound is well above that room's background
  noise, which it learns over the last couple of minutes, so a white-noise
  machine doesn't keep it stirring all night. Sensitivity (low, medium, high)
  is set per camera in settings. Temperature and humidity come from Home
  Assistant too.
- Optional low-resolution sub-streams: a camera with a sub-stream address
  plays it in small tiles (and focus-layout thumbnails) and its main stream in
  large ones, cutting decode load and bandwidth on older tablets. If a tile's
  sub-stream won't connect or has no audio, the app falls back to the main
  stream for that tile.
- Add, rename and remove cameras in place: tap **+**, or **Edit** and then a
  camera.
- A settings page (the gear in the header) can show each meter's level in
  decibels (dBFS), overlay each feed's received resolution, frame rate and video/audio
  codecs, hide individual cameras from this device's
  monitor without deleting them, choose between automatic, always-main and
  always-sub-stream playback, turn the feed-lost banner and chime on or off,
  set each camera's stirring sensitivity, and shows the Home Assistant URL and
  whether the server can reach Home Assistant.
- Warns when a camera feed stays down: after 30 seconds without video a banner
  names the camera and how long it has been lost, with a Dismiss button, and a
  soft chime plays and the device vibrates, repeating every minute until the
  feed returns or you dismiss it. The chime needs one tap on the page first, as
  for any sound, and both the banner and the chime can be turned off in Settings.
  Alerts only run while the monitor page is open, not on Settings or History.
- A history page (the clock icon in the header) charts the last 6, 12 or 24
  hours per camera: the loudest sound each minute, minutes with stirring and
  crying episodes, with a list of when it cried and for how long. Crying comes
  from Home Assistant's own history (nothing extra to store on the server).
  Sound levels are recorded in this device's browser while the monitor is
  open, so a device that was closed or asleep shows blank stretches, and each
  device only sees its own.
- A full-screen button in the header hides the browser's own bars where the
  browser allows it. It isn't shown on iPhone Safari, which has no full-screen
  API; Add to Home Screen gives the same effect there.
- Shows the device's battery level next to the clock while in full screen,
  where Android hides its own status bar (Settings can show it always or never).
  The percentage turns orange below 20% when not charging, which on a
  wall-mounted tablet usually means the charger came out. Chrome and Edge,
  including on Android, read the battery directly when the app is served over
  HTTPS. Where the browser can't (plain HTTP, Safari, Firefox), set the
  device's Home Assistant battery sensor in Settings, such as the Companion
  app's `sensor.<device>_battery_level`; it then shows only the level, without
  a charging state.
- Works in portrait and landscape.
- Installable on your home screen, with automatic screen wake lock while the
  app is visible on supported browsers.

> **Status:** foundation. The app shell, config persistence, layouts, level
> meters, live Home Assistant updates and WebRTC playback via go2rtc are in place.
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
              - Home Assistant proxy ◄──► Home Assistant WebSocket / REST API
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
- **Sensor updates** arrive over a shared Home Assistant WebSocket connection
  using `subscribe_entities`, filtered by the configured entity IDs in HA,
  and are pushed to browsers through server-sent events (`/api/ha/events`). Each
  viewer gets a fresh snapshot on connection. If either connection fails or
  stalls, the browser polls `/api/ha/states` every three seconds while retrying
  the live stream with exponential retry delays from three seconds to one minute,
  then stops polling once live updates resume. Connection failures log a safe
  phase and reason on the server; rejected tokens point to `HA_TOKEN`. Reverse proxies
  must allow long-lived SSE responses without buffering; the server sends a
  heartbeat every 15 seconds and sets `X-Accel-Buffering: no`.

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
docker compose up -d
```

The app image is published to `ghcr.io/kallb123/baby-monitor` (amd64 and
arm64) on every push to `main`, tagged `latest` and `sha-<commit>`. Update
with `docker compose pull && docker compose up -d`. Set `BABY_MONITOR_TAG` in
`.env` to pin a `sha-…` tag. Add `--build` to `up` to build the image from
your checkout instead.

Open `http://<host>:3000` on each device, then tap **+** to add cameras. For
installation and automatic screen wake lock, serve it over HTTPS as described
below.

`docker-compose.yml` runs everything on the host network:

| Service         | Profile         | Port(s)                          | What it is                               |
| --------------- | --------------- | -------------------------------- | ---------------------------------------- |
| `baby-monitor`  | (always)        | 3000                             | This app: API + built client             |
| `go2rtc`        | (always)        | 1984 API, 8554 RTSP, 8555 WebRTC | Turns RTSP feeds into WebRTC             |
| `demo-camera`   | `demo`          | 1985 API, 8654 RTSP              | Fake camera: test pattern + tone         |
| `homeassistant` | `homeassistant` | 8123                             | Bundled Home Assistant, if you have none |

These are the default ports. To avoid conflicts with existing services, edit
`.env` instead of the Compose file. For example, if 8554 is already occupied:

```dotenv
GO2RTC_RTSP_PORT=9554
```

Then run `docker compose up -d` again. The pipeline supports `PORT` (the app),
`GO2RTC_API_PORT`, `GO2RTC_RTSP_PORT`, `GO2RTC_WEBRTC_PORT`, `DEMO_API_PORT`, and
`DEMO_RTSP_PORT`. Changing `GO2RTC_API_PORT` updates the go2rtc listener, health
check, and the app's API URL together. The browser negotiates streams through
the app, so it needs no separate port setting. Allow the configured WebRTC port
over **TCP and UDP** from viewing devices. Saved go2rtc streams survive port
changes; the environment-driven base config takes precedence over saved listener
settings.

`GO2RTC_URL` is an optional app connection override for an external go2rtc API.
Leave it unset for the bundled pipeline to follow `GO2RTC_API_PORT`. If an older
`.env` contains `GO2RTC_URL=http://localhost:1984`, remove that line before changing
`GO2RTC_API_PORT`. An explicit URL does not change or stop the bundled go2rtc.

Turn on the optional services with `--profile` (repeat it to combine), or
list them in `COMPOSE_PROFILES` in `.env`. A `--profile` flag replaces the
`.env` list rather than adding to it. Requires Docker Compose 2.23.1+.

```sh
# Try it without hardware, then add a camera with RTSP URL rtsp://localhost:8654/demo
docker compose --profile demo up -d

# No existing Home Assistant? Run one alongside.
docker compose --profile homeassistant up -d
```

If you change `DEMO_RTSP_PORT`, use that port in the demo camera's saved RTSP URL
as well, including updating an already-added camera. Real camera RTSP URLs are
independent of the pipeline's listener ports and do not need changing.

With the bundled Home Assistant, finish onboarding at `http://<host>:8123`,
create a long-lived access token (profile → Security), put it in `.env` as
`HA_TOKEN=…` (leave `HA_URL` unset; it defaults to `http://localhost:8123`),
then run the same `docker compose … up -d` again. Containers read `.env`
when they are created, so `docker compose restart` won't pick it up.
The optional bundled Home Assistant manages its own HTTP port in its persisted
`configuration.yaml` (`http.server_port`); if you change that, set `HA_URL` to
match. `HA_URL` alone only changes where the app connects.

App config and go2rtc's saved streams live in the `baby-monitor-data` and
`go2rtc-config` Docker volumes, so they survive rebuilds and never land in
the git working tree. `docker compose down -v` wipes them.

## Install on a phone or tablet

Serve the app through an HTTPS reverse proxy with a certificate trusted by the
device. PWA installation, the service worker and screen wake lock require a
secure context (HTTPS, or `localhost` for development); plain HTTP on a LAN IP
does not enable these features.

In Chrome or Edge, use the browser's **Install app** action. On iPhone or iPad,
open the app in Safari and choose **Share → Add to Home Screen**. Launching from
the home screen opens Baby Monitor in its own window, in either orientation.

The app requests a screen wake lock automatically while visible, including
when running in a browser tab. It releases the lock when hidden or closed and
requests it again when you return. A tap or key press also retries a denied
or released lock. Browser support, device power saving and system policy can
prevent the lock; it cannot keep a background app or a manually locked screen
awake.

Production builds cache the app shell, including fonts and the settings page.
Camera streams, configuration and sensor readings still require the server and
are never cached by the service worker. App updates wait until all app windows
and tabs are closed, so an update does not reload a running monitor.

To check installation locally, run `npm run preview` and visit
`http://localhost:3000`. The service worker is disabled in the Vite dev server.

## Development

```sh
npm install
cp .env.example .env              # set HA_URL / HA_TOKEN if you have them
docker compose --profile demo up -d go2rtc demo-camera
npm run dev
```

`npm run dev` starts the API server on port 3000 (stop the `baby-monitor`
container first if it is running) and the Vite dev server
(default port 5173, listening on the LAN) which proxies `/api` to it. Open the
Vite URL on your phone or tablet, then tap **+** to add cameras (up to four).

For each camera you set:

| Field                     | Example                                     |
| ------------------------- | ------------------------------------------- |
| Camera name               | `Nursery`                                   |
| Stream address (RTSP)     | `rtsp://user:pass@192.168.1.20:554/stream1` |
| Sub-stream address (RTSP) | `rtsp://user:pass@192.168.1.20:554/stream2` |
| Cry detection (HA sensor) | `binary_sensor.nursery_crying`              |
| Temperature (HA sensor)   | `sensor.nursery_temperature`                |
| Humidity (HA sensor)      | `sensor.nursery_humidity`                   |

The sub-stream address is optional: a lower-resolution stream from the same
camera, registered with go2rtc as `<camera id>.sub`. With **Stream quality** set
to Auto on the settings page (saved per device), a tile plays it while it is
under about 960 physical pixels wide (CSS width × device pixel ratio) and
switches to the main stream above 1280, with a 2 second delay so rotating the
device doesn't cause reconnects. Cameras without a sub-stream address always play
their main stream. Turn on **Stream details** to see which one a tile is playing.
The sub-stream should carry audio too: the level meter, stirring and history
need it on small tiles, and a tile whose sub-stream has no audio falls back to
the main stream.

The camera id, which is also its go2rtc stream name, is derived from the name
when the camera is added (`Maya's room` → `maya-s-room`) and never changes.

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
| `npm run bump minor` | Bump the app version (`patch`, `minor` or `major`)        |

## Configuration

Server settings come from environment variables (see `.env.example`):

| Variable             | Default                               | Purpose                                                     |
| -------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `HA_URL`             | –                                     | Home Assistant base URL                                     |
| `HA_TOKEN`           | –                                     | Home Assistant long-lived access token                      |
| `GO2RTC_URL`         | `http://localhost:${GO2RTC_API_PORT}` | Optional explicit go2rtc API URL override                   |
| `GO2RTC_API_PORT`    | `1984`                                | Bundled go2rtc API listener and default app connection port |
| `GO2RTC_RTSP_PORT`   | `8554`                                | Bundled go2rtc RTSP listener (Compose)                      |
| `GO2RTC_WEBRTC_PORT` | `8555`                                | Bundled go2rtc WebRTC listener, TCP + UDP (Compose)         |
| `DEMO_API_PORT`      | `1985`                                | Optional demo camera API listener (Compose)                 |
| `DEMO_RTSP_PORT`     | `8654`                                | Optional demo camera RTSP listener (Compose)                |
| `PORT` / `HOST`      | `3000` / `0.0.0.0`                    | API server bind address                                     |
| `DATA_DIR`           | `./data`                              | Where `config.json` is stored                               |

Outside Compose, configure go2rtc's listeners in its own config to match;
the Node server uses `GO2RTC_API_PORT` to derive its default connection URL but
does not configure a separately running go2rtc process.

Everything else (cameras, entities, layout, battery sensors) is edited in the
app and persisted by the server. The settings page shows `HA_URL` and `GO2RTC_URL` read-only,
with a live check of the Home Assistant connection, which helps when setting
up `HA_TOKEN`.

## Security notes

This is designed for a trusted home network.

- The Home Assistant token stays on the server. The browser can only read the
  entities referenced in the saved config, and the config only accepts
  `sensor.*` and `binary_sensor.*` entities.
- go2rtc saves registered streams, credentials included, in its config
  file (the `go2rtc-config` volume under Docker).
- Camera RTSP URLs (which often include credentials) are stored in the app
  config and are visible in the edit dialog to anyone who can
  open the app. Do not expose the app or go2rtc to the internet without a
  reverse proxy that adds authentication.
- The go2rtc API has no authentication; keep port 1984 (and 1985 for the
  demo camera) on the LAN.

## Roadmap

- Local, in-browser cry detection fallback from the audio level.
- Remove go2rtc streams for deleted cameras and cleared sub-streams.
- Optional app login / PIN.

## Contributing

See [AGENTS.md](AGENTS.md) for architecture, conventions and the PR review
process. Every pull request runs CI (`npm run check` + build) and an automated
Claude review using the project's `pr-review` skill.
