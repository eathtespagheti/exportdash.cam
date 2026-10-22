# Dependency & Runtime Modernization — Design

**Date:** 2026-10-21
**Status:** Draft for approval
**Board:** `eathtespagheti/exportdash.cam` → "Development" (GitLab, Free tier)

---

## 1. Intent and why

The repository's npm dependency graph was last touched on 2026-01-25. Since then the
ecosystem has moved several majors and the project has accumulated a set of
version-pinning gaps that are now actively costing us:

- The container image builds on `node:20-alpine`. **Node 20 reached end-of-life on
  2026-04-30** and receives no security patches. Every image we publish ships from an
  unpatched toolchain.
- `next@16.1.4` and `protobufjs@8.0.0` carry **2 critical** advisories
  (`protobufjs` ≤8.6.5 is arbitrary-code-execution; `next` has multiple).
  `npm audit` reports **22 vulnerabilities** on `main` today.
- There is **no CI that lints, typechecks, tests, or builds** on the GitLab remote.
  `npm run lint` currently **fails on `main` with 10 errors** and nobody noticed,
  because nothing runs it.
- There are **no tests at all**, so no upgrade can be verified as behaviour-preserving.
- There is **no declared Node version** — no `engines`, no `.nvmrc`, no `packageManager`
  field — so the build silently tracks whatever Node the builder happens to have.
- The CI config is a leftover `.github/workflows/publish-ghcr.yml` on a repository whose
  remote is GitLab. GitLab CI has never existed here.

The goal is to move the whole toolchain to current, supported versions, establish a
regression net so that "it still works" is a *verified* claim rather than an assumption,
and put a CI pipeline in place so none of this silently rots again.

### A correction to the original premise

The starting request assumed "old Node and ancient packages". That is only half right, and
the distinction changes the shape of the work:

- **The npm dependencies are already largely modern.** `main` is on Next 16, React 19,
  Tailwind 4, ESLint 9, TypeScript 5.9. This is not a legacy app.
- **What is actually stale is the runtime, the CI, the version pinning, and the fact that
  nothing verifies anything.**

So this is not a "rewrite on a new framework" project. It is a **toolchain-and-guards**
project: bump what is behind, pin what is unpinned, delete what is unused, fix what the
new linter exposes, and add the tests + CI that make the next upgrade a non-event.

---

## 2. Goals, non-goals, anti-goals

### Goals

1. **No EOL runtime.** Standardize on a supported Node LTS and declare it in every place
   a builder or CI runner would look.
2. **Zero critical advisories**, and a documented, deliberate position on the remaining
   unfixable ones.
3. **A test suite that covers the logic most exposed to dependency drift**, so upgrades
   can be verified rather than eyeballed.
4. **A CI pipeline on GitLab** that runs install → typecheck → lint → test → build on
   every push and merge request, and that fails on regressions.
5. **A clean `npm run lint`** — fixing the 10 pre-existing errors, 2 of which are real
   React correctness bugs.
6. **Remove unused dependencies** to shrink the supply-chain surface.
7. **Documentation that matches reality** (the README still says "Next.js 15").

### Non-goals

- Rewriting the application, changing its behaviour, or redesigning any UI.
- Changing the deployment model (static export served by nginx stays as-is).
- Migrating the video export pipeline off `mp4-muxer` (see §6).
- Adding feature work of any kind.

### Anti-goals

- **"Latest" must not mean "bleeding edge".** Every version bump must pass the full
  verify loop. A version that breaks the toolchain is not an upgrade.
- **No version pin that silently drifts.** Declared ranges stay in `package.json`;
  the lockfile stays committed and `npm ci` is used in CI.
- **No behaviour change disguised as a dependency bump.** Behaviour-affecting fixes
  (the `rules-of-hooks` repairs) are isolated in their own commit and issue so they
  can be reviewed independently.

---

## 3. Constraints

| Constraint | Consequence |
|---|---|
| Static export (`output: "export"`) | Node is **build-time only**. It never runs in production; nginx serves the output. Runtime risk is zero, but the *build* toolchain risk is real. |
| `typescript-eslint@8.72.0` peers `typescript: ">=4.8.4 <6.1.0"` | **TypeScript 7 is unusable** with ESLint 10 today. See §4.1. |
| `braces` CVE-2026-93687 has `first_patched_version: null` | 5 high advisories are **unfixable upstream** today. See §4.5. |
| GitLab **Free tier** | No scoped labels (`status::todo` is Premium), no epics, no iterations, no custom workflows. Column membership is maintained by swapping plain labels. |
| ~7,100 lines of TypeScript, zero tests | Behaviour preservation cannot be asserted today. Tests must land *before* the risky bumps. |
| Source imports use the `@/*` alias in 10+ files, with **single quotes** | Vitest needs `resolve.tsconfigPaths` configured, or it cannot resolve `@/types/video`. |
| No local Node was installed until 2026-10-21 | Verification must run through nvm, Docker, or CI. |

---

## 4. Approaches considered

### 4.1 TypeScript version

| Option | Verdict |
|---|---|
| **6.0.3** ✅ | **Chosen.** Latest stable that the *whole* toolchain supports. Verified: `tsc --noEmit` clean, `next build` clean, ESLint 10 loads and runs. |
| 7.0.2 (npm `latest`, native Go port) | Rejected for now. `tsc` and `next build` both work, but `typescript-eslint` **hard-throws** `"typescript-eslint does not support TS 7.0"` — the entire lint step dies. Upstream support is tracked in typescript-eslint#10940 and is aimed at TS 7.1, which is still in beta. |
| 5.9.3 (stay) | Rejected. Leaves the compiler on the previous line for no reason; 6.0.3 is verified working. |

**Decision: TypeScript 6.0.3.** Revisit TS 7 once typescript-eslint ships support —
that is a future, self-contained upgrade, not a blocker for this work.

### 4.2 Node version

| Option | Verdict |
|---|---|
| 26.12.1 ✅ | **Chosen** (explicit user decision). Becomes LTS on 2026-10-28; runs until 2029-04-30. Verified: `tsc`, `next build`, ESLint 10, Vitest 5, and the `node:26-alpine` Docker build all pass. |
| 24.22.1 | Was the fallback. Fully supported to 2028-04-30 and one week less battle-tested as LTS than 26 will be. |
| 22.x | Rejected. Shortest runway (security support ends 2027-04-30) and oldest toolchain. |

**Decision: Node 26.12.1**, pinned via `.nvmrc`, `engines`, `packageManager`, the
Dockerfile base image, and the CI image. Node 20 (current Dockerfile) is EOL and is
replaced.

### 4.3 Test stack

| Option | Verdict |
|---|---|
| **Vitest 5 + happy-dom + Testing Library** ✅ | **Chosen.** Vitest 5.0.5 requires Node `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` — satisfied by 26.12.1. Native ESM/TS, no Babel config, and Vite now resolves tsconfig paths **natively** via `resolve.tsconfigPaths: true` (no `vite-tsconfig-paths` plugin needed). |
| Jest + `next/jest` | Rejected. Slower, needs a Babel/SWC transform, and `next/jest` is not a supported path in Next 16. |
| `node:test` | Rejected. Zero-dependency appeal is outweighed by the TS transform and DOM-environment story. |

Verified working: `vitest.config.mts` with `resolve.tsconfigPaths: true` and
`environment: "happy-dom"` resolves `@/types/video` and runs a test against
`src/lib/sequence-detector.ts` on Node 26.

**Coverage scope: unit tests for `src/lib/` and `src/hooks/`.** Component-level tests for
`VideoPlayer.tsx` (1,590 lines) and `TelemetryTimeline.tsx` (927 lines) are explicitly
out of scope — those files lean on WebCodecs, canvas, and File APIs that would need
heavy mocking for little real signal.

### 4.4 CI platform

**Chosen: add GitLab CI, keep the existing GitHub Actions GHCR workflow.**

- New `.gitlab-ci.yml` with `install → typecheck → lint → test → build` jobs on Node 26,
  plus an `npm audit` gate.
- `.github/workflows/publish-ghcr.yml` is **left in place and untouched** — it still
  publishes the GHCR image, and removing it would change where the image lives. Its
  action versions are one-to-three majors behind (`checkout@v4`→v7, `build-push-action@v5`→v7,
  `login-action@v3`→v4, `metadata-action@v5`→v6, `setup-buildx-action@v3`→v4); those get
  refreshed in a dedicated issue so the change is reviewable in isolation and cannot
  break image publishing.

### 4.5 The unfixable advisories

`braces` CVE-2026-93687 (stack exhaustion via deeply nested glob patterns) has
**no patched version** — `first_patched_version: null`, and 3.0.3 is the latest release.
The affected chain is `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` →
`micromatch` → `braces`.

Assessment: **dev-time only, not exploitable in practice.** The globs are static patterns
compiled into the ESLint config from this repository's own file layout; no user input
reaches a glob matcher. The package never ships to production — the output is a static
site served by nginx. `npm audit`'s only suggested remediation is a **breaking downgrade**
to `eslint-config-next@14.2.35`, which is strictly worse and is rejected.

**Decision:** accept and document these 5. The CI audit gate tolerates exactly this
known set and fails on anything new, so a *new* advisory still breaks the build while
today's unfixable one does not.

### 4.6 Dependency removal

Four declared dependencies are imported **nowhere** in `src/`:

| Package | Imports in `src/` | Action |
|---|---|---|
| `@ffmpeg/ffmpeg` | 0 | Remove |
| `@ffmpeg/util` | 0 | Remove |
| `html2canvas` | 0 | Remove |
| `react-leaflet` | 0 | Remove (`leaflet` itself **is** used, in `MapView.tsx` via dynamic import) |

Verified: removing all four and rebuilding produces a clean `next build`.
`@ffmpeg/ffmpeg` is a heavy WASM package, so this is a meaningful supply-chain and
install-time win.

---

## 5. The plan — steps, mirrored as GitLab tickets

Every step below becomes one GitLab issue on the "Development" board, in the order
given. Each is independently verifiable and lands as its own commit.

### Phase 0 — Safety net (lands first, so everything after is verifiable)

| # | Ticket | Area | Type |
|---|---|---|---|
| 1 | Set up Vitest 5 + happy-dom + Testing Library; add `test`, `test:watch`, `test:coverage` scripts; `vitest.config.mts` with `resolve.tsconfigPaths: true`; setup file with `@testing-library/jest-dom` matchers | infra | chore |
| 2 | Unit tests for `src/lib/sequence-detector.ts` — `detectSequences` (sequence merging, gap threshold, event attachment), `findMomentForTime`, `toAbsoluteTime` | playback | chore |
| 3 | Unit tests for `src/lib/dashcam-mp4.ts` — `DashcamMP4` box parsing and SEI NAL extraction, using synthetic MP4 byte fixtures | telemetry | chore |
| 4 | Hook tests for `src/hooks/useSeiData.ts` — protobuf SEI decoding against a fixture, using Testing Library's `renderHook` | telemetry | chore |

### Phase 1 — Runtime and CI plumbing

| # | Ticket | Area | Type |
|---|---|---|---|
| 5 | Pin Node 26.12.1: add `.nvmrc`, `engines.node`, `packageManager` to `package.json`; switch Dockerfile to `node:26-alpine` | infra | chore |
| 6 | Add `.gitlab-ci.yml`: `install → typecheck → lint → test → build` on Node 26, artifact `out/`, `npm audit` gate tolerating the known `braces` set | infra | chore |

### Phase 2 — Dependency upgrades (grouped so each is revertable in isolation)

| # | Ticket | Area | Type |
|---|---|---|---|
| 7 | **Security-critical bumps:** `protobufjs` 8.0.0→8.8.1 (fixes critical RCE), `next` 16.1.4→16.4.2 (fixes multiple critical/high) | infra | chore |
| 8 | **Toolchain bumps:** `eslint` 9→10.13.0, `eslint-config-next` →16.4.2, `typescript` 5.9.3→6.0.3, `tailwindcss` + `@tailwindcss/postcss` →4.3.3, `@types/node` →26, `@types/react`/`@types/react-dom` →19.3.0, `@types/leaflet` →1.9.22 | infra | chore |
| 9 | **Runtime library bumps:** `react`/`react-dom` 19.2.3→19.3.1, `@tabler/icons-react` 3.36.1→3.49.0 | ui | chore |
| 10 | **Remove unused dependencies:** `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `html2canvas`, `react-leaflet` | infra | chore |
| 11 | **Fix the 11 lint errors** the new ESLint surfaces — 2 conditional `useMemo` calls in `TelemetryTimeline.tsx:505,518` (a genuine `rules-of-hooks` bug), 6 `react-hooks/set-state-in-effect`, 2 `react-hooks/preserve-manual-memoization`, 1 new `set-state-in-effect` in `useSeiData.ts:50` | playback | bug |

### Phase 3 — Sustainment and accuracy

| # | Ticket | Area | Type |
|---|---|---|---|
| 12 | Refresh GitHub Actions to current majors in `publish-ghcr.yml` (`checkout@v7`, `setup-buildx-action@v4`, `login-action@v4`, `metadata-action@v6`, `build-push-action@v7`) — no behavioural change to publishing | infra | chore |
| 13 | Update `README.md`: "Next.js 15"→16, document the required Node version, add test/lint commands, correct the GitHub→GitLab repo links, refresh the Tech Stack list | infra | docs |
| 14 | Add dependency-update automation (Renovate or GitLab equivalent) so future bumps arrive as MRs rather than as a yearly fire drill | infra | chore |

### Deferred (explicitly out of scope, tracked separately)

- **Migrating `mp4-muxer` → Mediabunny.** `mp4-muxer@5.2.2` prints a deprecation notice
  ("This library is superseded by Mediabunny"). This is a *functional rewrite* of the
  export path, not a version bump, and it does not block anything here.

---

## 6. Parts of the how, as decided

- **Node** → 26.12.1, declared in `.nvmrc` + `engines` + `packageManager` + Dockerfile +
  CI image. `engines` is `>=26 <27` so nvm/asdf/Docker/CI all agree.
- **TypeScript** → 6.0.3. `typescript-eslint` cannot consume TS 7 yet; revisit later.
- **Test runner** → Vitest 5.0.5, `environment: "happy-dom"`, `resolve.tsconfigPaths: true`
  in `vitest.config.mts` (a `.mts` extension, because the package is CommonJS and Vite warns
  about ESM syntax in a CJS-loaded config). No `vite-tsconfig-paths` plugin — Vite resolves
  tsconfig paths natively.
- **Test placement** → `src/lib/__tests__/*.test.ts` and `src/hooks/__tests__/*.test.ts`,
  mirroring the source tree.
- **CI** → GitLab CI as the gate (typecheck/lint/test/build/audit); GitHub Actions retained
  for GHCR publishing only.
- **Audit policy** → `npm audit` gate in CI that fails on any advisory outside the known
  unfixable `braces` chain.
- **Column discipline** → each ticket carries exactly one status label
  (`todo` → `doing` → `review`), swapped, never accumulated. Labels are plain
  (Free tier has no scoped labels).
- **Order matters** → Phase 0 before Phase 2. The lint fixes (ticket 11) land *after* the
  ESLint 10 bump (ticket 8) because the new linter is what surfaces them.

---

## 7. What's left to the builder

Deliberately open, to be settled during implementation:

- Exact fixture format for the `dashcam-mp4.ts` MP4 byte fixtures — synthetic boxes built
  in-test vs. a checked-in binary fixture. The builder should pick whichever keeps the
  tests readable; no behavioural difference.
- Whether the `set-state-in-effect` lint errors are fixed by restructuring the effects or
  by targeted rule suppression with a comment explaining why. The two conditional
  `useMemo` calls are a genuine bug and **must** be fixed properly, not suppressed.
- Whether to enable `npm run test:coverage` thresholds in CI, and at what level. A
  starting point of no hard threshold (report only) is acceptable.
- Whether the `build` CI job should also produce the GHCR image, or stay a pure
  verification job. Default: verification only; publishing stays in the GitHub workflow.

---

## 8. Execution notes (added after the work landed)

Everything above is the plan as approved. This section records where execution
differed from it, so the document stays honest about what actually happened.

### Deviations from the plan

- **`@types/node` moved in ticket 1, not ticket 8.** Phase 0 was unbuildable as
  ordered: `vitest@5.0.5` declares `peerOptional: { "@types/node": "^22.0.0 || >=24.0.0" }`,
  so `npm install vitest` fails with `ERESOLVE` against the project's `@types/node@^20`.
  The bump was folded into the Vitest harness commit as a hard prerequisite.
- **`vite` had to be declared explicitly.** The plan relied on
  `resolve.tsconfigPaths: true`, which exists **only in Vite 8**. `vite` was an
  undeclared transitive peer of vitest, so under Vite 6 or 7 the option is
  silently ignored and every `@/…` import in the tests breaks. The alias is now
  mapped explicitly in `vitest.config.mts`, which does not depend on the Vite
  version at all, and `vite` is a declared devDependency.
- **Test and application type-checking were split.** The root `tsconfig.json`
  included `**/*.ts`, so a type error in a test file failed `next build` — and
  therefore the production Docker image. The root config now excludes the tests
  and `tsconfig.test.json` includes them; CI runs both passes.
- **The audit gate resolves root causes instead of matching package names.**
  Matching names meant the *parents* in the unfixable `braces` chain still
  blocked the build, even though they carry no independent vulnerability. Each
  advisory is now traced to its cause, and only the specific GHSA is tolerated.
- **CI was restructured for the Free tier.** Five jobs each doing a full
  `npm ci` became one `verify` job, a no-install `audit` job and a `build` job.
- **Node pins became enforcement rather than documentation.** Added `.npmrc`
  with `engine-strict=true` (verified: a mismatched engine now fails `npm ci`
  with `EBADENGINE`) and pinned the Dockerfile and CI image to
  `node:26.12.1-alpine` instead of the floating `node:26-alpine`.
- **The vulnerability count in §1 was 20 on `main`, not 22.** The 22 figure came
  from an earlier install with a different tree. Corrected: 20 before, 5 after,
  all five tracing to the one unfixable `braces` advisory.

### Added beyond the plan

- **A targeted `eslint-disable-next-line` policy for three effects.** The object
  URL lifecycles and the camera-segment reconciliation are genuinely effects;
  each disable carries the reason inline.
- **`renovate.json`** alongside the scheduled dependency-check job, so a future
  Renovate instance behaves correctly from the start.
- **Browser smoke check.** The static export was loaded in a real Chromium
  instance, with and without a persisted localStorage layout config, and
  confirmed to hydrate with zero console errors, zero page errors and zero
  hydration mismatches.

### Not done, and why

- **The `mp4-muxer` → Mediabunny migration stayed deferred** (§5, Deferred). It
  is a functional rewrite of the export path, not a version bump.
- **Upstream parity was not pursued.** This was discovered during the work: the
  upstream `nobig-deals/exportdash.cam` is four commits ahead and contains an
  encrypted-clip decryption feature that the live site serves. That is a feature
  port with its own deployment implications (Cloudflare Pages Functions), not a
  dependency upgrade, and it needs a maintainer decision. It is tracked as its
  own issue.
