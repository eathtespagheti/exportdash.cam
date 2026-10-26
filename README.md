# ExportDash

> Tesla dashcam viewer with seamless playback, live telemetry overlays, and video export.

**[Live Demo → exportdash.cam](https://exportdash.cam)**

![ExportDash Screenshot](public/screenshot.png)

**[How it works (full walkthrough) →](https://www.youtube.com/watch?v=6MzdHHmzrME)**

## Features

- **Seamless Playback** — Consecutive 1-minute Tesla clips automatically merged into continuous video
- **Live Telemetry Overlay** — Speed, GPS coordinates, steering angle, and G-forces displayed in real-time
- **All 6 Camera Angles** — Front, rear, left/right repeaters, and pillar cameras with flexible layouts
- **Interactive Map** — Live GPS tracking synced with video playback
- **Event Timeline** — Visual timeline showing brake, gas, turn signals, and steering events
- **Video Export** — Export clips with telemetry burned into the video
- **Encrypted Clip Support** — Decrypt Tesla 2026.20+ encrypted recordings in-browser using your Tesla account token
- **100% Client-Side** — All processing happens in your browser, no uploads required

## Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.app/new/template?template=https://github.com/eathtespagheti/exportdash.cam)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/eathtespagheti/exportdash.cam)
[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy/?template=https://github.com/eathtespagheti/exportdash.cam)

## Requirements

- **Node.js 26.12.1** (or any `>=26 <27` — the range is enforced by `engines` plus
  `engine-strict=true` in `.npmrc`, so a mismatched Node fails the install)
- **npm 11.20.0**

The exact version is pinned in `.nvmrc`. If you use [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install   # reads .nvmrc
nvm use
```

`package.json` also records `packageManager: "npm@11.20.0"`. npm itself ignores
that field; it is there for tooling that honours it (such as corepack), and it
documents the npm version the lockfile was produced with.

## Quick Start

```bash
# Clone the repo
git clone https://gitlab.com/eathtespagheti/exportdash.cam.git
cd exportdash.cam

# Install dependencies from the lockfile
npm ci

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and drop your TeslaCam folder.

Use `npm install` (rather than `npm ci`) when you intend to change dependencies —
it updates `package-lock.json` as well.

> This repository lives on GitLab. It is mirrored to
> [github.com/eathtespagheti/exportdash.cam](https://github.com/eathtespagheti/exportdash.cam),
> which is what the GHCR image is published from. GitLab is the canonical
> source — issues and merge requests are tracked there.

### Development commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build (static export into `out/`) |
| `npm run lint` | ESLint, with the React Compiler rules enabled |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run the test suite in watch mode |
| `npm run test:coverage` | Run the tests with a coverage report |
| `npx tsc --noEmit` | Type-check the application sources |
| `npx tsc --noEmit -p tsconfig.test.json` | Type-check the test sources |

The application and the tests are type-checked separately on purpose: the root
`tsconfig.json` excludes the test files, so a type error in a test can never
break the production build or the published container image. CI runs both
passes.

### CI

`.gitlab-ci.yml` runs the whole verification chain on every push and merge
request: typecheck → lint → test → build, plus an `npm audit` gate. The
container image is published separately to GHCR by
`.github/workflows/publish-ghcr.yml`.

### Docker

The image is a two-stage build: a **Node 26.12.1** builder produces the
standalone Next.js server, and the runtime stage runs it with `node startup.js`
on port 3000. The library feature needs server-side API routes, so the app is no
longer a static export.

```bash
# Build image
docker build -t exportdash .

# Run container
docker run -p 3000:3000 exportdash
```

Open [http://localhost:8080](http://localhost:8080)

### Docker Compose

```bash
docker compose up
```

Open [http://localhost:8080](http://localhost:8080)

## How It Works

Tesla dashcam videos contain embedded SEI (Supplemental Enhancement Information) metadata with telemetry data:

- Vehicle speed
- GPS coordinates & heading
- Steering wheel angle
- Accelerator & brake pedal state
- Turn signal status
- G-force readings

ExportDash extracts this metadata using [Tesla's official protobuf schema](https://github.com/teslamotors/dashcam) and displays it as an overlay synchronized with video playback.

### Sequence Detection

Tesla records 1-minute clips continuously. ExportDash automatically detects consecutive clips and merges them:

```
Clip 1: 10:30:00 (60s) ─┐
Clip 2: 10:31:00 (60s)  ├─→ Single 5-minute sequence
Clip 3: 10:32:00 (60s)  │
Clip 4: 10:33:00 (60s)  │
Clip 5: 10:34:00 (60s) ─┘

Clip 6: 10:45:00 (60s) ─→ New sequence (12min gap)
```

## Encrypted Clips (firmware 2026.20+)

Recent Tesla firmware encrypts dashcam and Sentry recordings on the USB drive.
When you drop encrypted clips, ExportDash detects them and offers to decrypt
them in your browser:

1. Sign in at [dashcam.tesla.com](https://dashcam.tesla.com) and grab your
   dashcam token from DevTools → Network → any `/api/1/` request →
   `Authorization: Bearer …`.
2. Paste it into the prompt. ExportDash fetches the per-file decryption keys from
   Tesla and decrypts the video locally.

**How it stays private:**

- Your video **never leaves your device** — decryption runs entirely in the
  browser using the native WebCrypto AES engine.
- Only per-file identifiers and ownership metadata (never footage) are sent to
  Tesla to retrieve the decryption keys — exactly what Tesla's own web viewer
  sends.
- Your token is stored only in your browser (localStorage, opt-in "remember")
  and is sent only to Tesla. Treat it like a password; it expires periodically.

**Why a proxy:** browsers can't call `dashcam.tesla.com` directly from another
origin (CORS). The key request is routed same-origin through a thin reverse
proxy that forwards only to Tesla — the Next.js server handles it via a rewrite
in `next.config.ts`, and a Cloudflare Pages Function handles it on exportdash.cam
(`functions/tesla-decrypt/[[path]].ts`). Point it elsewhere with
`NEXT_PUBLIC_TESLA_KEY_URL` if needed.
The proxy adds no credentials of its own; it only relays your authenticated
request to Tesla. Note that this means your bearer token transits the proxy host
on its way to Tesla — it is never logged or stored there, but if you'd rather it
never left your machine, run the Docker image yourself and use that instance.

## TeslaMate Integration

If you run [TeslaMate](https://github.com/teslamate-org/teslamate), ExportDash can
match each clip to the trip it came from and show what the camera cannot: motor
power, battery level, tire pressure, range, odometer, elevation and temperature,
plus the trip's distance, duration, energy used and start/end place.

It works by asking the Grafana that already fronts your TeslaMate database to run
a read-only query. ExportDash never talks to Postgres directly, and nothing leaves
your machine except those queries to your own Grafana.

### Connecting

Open the plug icon in the player toolbar and enter your Grafana address. A
**service account token** with the Viewer role is enough — the app only ever runs
`SELECT`s. Leave the token empty if your Grafana allows anonymous access.

There are two ways to reach Grafana, and which one you should use depends on
where you run ExportDash:

**Same-origin proxy (recommended for a self-hosted server).** Set
`GRAFANA_UPSTREAM` to your Grafana's address and use `/grafana-proxy` in the
settings:

```yaml
environment:
  GRAFANA_UPSTREAM: "http://grafana:3000"
  # Optional. With this set, there is nothing to paste into the UI and the
  # token never reaches the browser.
  GRAFANA_TOKEN: "glsa_…"
```

The browser then makes a same-origin request, so **no CORS configuration is
needed** and Grafana does not have to be reachable from outside your network. The
app server relays only the two read-only endpoints the integration uses
(`api/ds/query` and `api/datasources`), and the upstream is fixed at deploy time
rather than taken from the request, so this is not an open relay. It needs a
server deployment — the Docker image, or any host running `next start`.

With both variables set the integration **enables itself**: no settings dialog,
no token in the browser. Open a clip and the trip panel appears.

**Direct.** Enter your Grafana's public URL in the settings. This works on any
deployment, including exportdash.cam — but Grafana OSS emits **no CORS headers**,
so you must add them at whatever reverse proxy fronts Grafana:

```nginx
# In the nginx/caddy/envoy in front of YOUR Grafana.
add_header Access-Control-Allow-Origin  "https://exportdash.cam" always;
add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;

if ($request_method = OPTIONS) {
    return 204;
}
```

Adjust `Access-Control-Allow-Origin` to wherever your ExportDash is served from.
Without it the browser blocks the request, and ExportDash says so explicitly
rather than reporting a generic failure.

### What it shows

Every metric is opt-in. The sliders icon in the toolbar picks which fields appear
in the trip summary, which appear live during playback, and which are burned into
the exported video — plus where the panel sits and which units to use.

The trip summary is constant for the whole trip; the live values follow the
playback position. TeslaMate records tire pressures and temperatures only every
15–40 seconds, so those carry the last known value forward rather than being
interpolated — ExportDash will not invent a number the car never reported. A value
that was never recorded reads as **—**, never as 0.

Tire pressures are drawn as a **2×2 grid** in the positions they describe — FL and
FR on the top row, RL and RR below — both on screen and burned into the export, so
a low corner is obvious at a glance.

To link each trip back to Grafana, set a **Trip dashboard link** in the settings.
It is a URL template, so it works with any dashboard:

```
https://grafana.example/d/abc123/drive-details?var-car_id={carId}&var-drive_id={driveId}
```

Placeholders: `{driveId}`, `{carId}`, `{start}`, `{end}` (ISO-8601) and
`{startMs}`, `{endMs}`. When set, the panel shows a **Trip stats ↗** link.

Clips are matched by timestamp, treating a clip's filename time as local time in
your browser. If you recorded elsewhere, set the recording timezone offset in the
settings. A drive that is still in progress matches too, and is labelled as such.

### Not supported

- TeslaMate instances backed by InfluxDB (modern TeslaMate is Postgres-only).
- Writing anything back to TeslaMate or Grafana.

### Verifying a connection

`scripts/verify-teslamate.mjs` runs the same queries against your instance and
reports what it found:

```bash
GRAFANA_URL=https://grafana.example.com \
GRAFANA_TOKEN=glsa_… \
node scripts/verify-teslamate.mjs
```

## Tech Stack

- **Framework:** Next.js 16 with App Router (static export)
- **UI:** React 19, TypeScript 6
- **Styling:** Tailwind CSS 4
- **Video:** Native HTML5 video with WebCodecs for export
- **Maps:** Leaflet with OpenStreetMap
- **Protobuf:** protobufjs for SEI metadata decoding
- **Tests:** Vitest 5 with Testing Library
- **Lint:** ESLint 10 with the React Compiler rules

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` `→` | Seek ±5 seconds |
| `[` `]` | Previous / Next clip |
| `1` `2` `3` `4` | Layout: Single / PiP / Triple / All |
| `T` | Toggle telemetry overlay |
| `M` | Toggle map |
| `D` | Toggle date/time overlay |
| `E` | Toggle edit mode (trim) |
| `U` | Toggle mph / km/h |
| `F` | Fullscreen |

## Project Structure

```
src/
├── app/
│   └── page.tsx          # Main app component
├── components/
│   ├── VideoPlayer.tsx   # Multi-camera player with controls
│   ├── TelemetryCard.tsx # Speed/telemetry overlay
│   ├── TelemetryTimeline.tsx # Event timeline visualization
│   ├── MapView.tsx       # GPS map overlay
│   ├── VideoExporter.tsx # WebCodecs-based export
│   ├── DropZone.tsx      # File/folder drop handling
│   ├── DecryptDialog.tsx # Encrypted-clip token prompt & decrypt progress
│   └── LoadingScreen.tsx # Processing progress UI
├── hooks/
│   ├── useSeiData.ts     # SEI extraction & time sync
│   └── __tests__/        # Hook tests
├── lib/
│   ├── dashcam-mp4.ts    # MP4 parsing & SEI extraction
│   ├── tesla-crypto.ts   # MD5 + AES-128-CBC primitives (verified vs test vectors)
│   ├── tesla-decrypt.ts  # Encrypted container parsing, key fetch & decryption
│   ├── sequence-detector.ts # Clip merging logic
│   └── __tests__/        # Unit tests (+ shared MP4 fixture helpers)
├── types/
│   └── video.ts          # TypeScript definitions
functions/
└── tesla-decrypt/        # Cloudflare Pages proxy for Tesla's key API
```

## Credits

- [Tesla Dashcam](https://github.com/teslamotors/dashcam) — Official SEI metadata protobuf schema
- [ViewDash.cam](https://viewdash.cam/) ([source](https://github.com/pixeye33/viewdashcam)) — Original inspiration

## License

MIT
