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

The image is a two-stage build: a **Node 26.12.1** builder produces the static
export, and the runtime stage is plain `nginx` serving it. Node never runs in
production.

```bash
# Build image
docker build -t exportdash .

# Run container
docker run -p 8080:80 exportdash
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
│   └── LoadingScreen.tsx # Processing progress UI
├── hooks/
│   ├── useSeiData.ts     # SEI extraction & time sync
│   └── __tests__/        # Hook tests
├── lib/
│   ├── dashcam-mp4.ts    # MP4 parsing & SEI extraction
│   ├── sequence-detector.ts # Clip merging logic
│   └── __tests__/        # Unit tests (+ shared MP4 fixture helpers)
└── types/
    └── video.ts          # TypeScript definitions
```

## Credits

- [Tesla Dashcam](https://github.com/teslamotors/dashcam) — Official SEI metadata protobuf schema
- [ViewDash.cam](https://viewdash.cam/) ([source](https://github.com/pixeye33/viewdashcam)) — Original inspiration

## License

MIT
