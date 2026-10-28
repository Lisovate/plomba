# Architecture

First written 2026-10-26 as a plan; rewritten 2026-10-28 when development moved from a native iPhone app to an installable web app. Sections marked **(planned)** aren't built yet. What's built, and when, is in [build-log.md](build-log.md).

## Components

```
Phone (iPhone or Android): Plomba PWA in the browser or installed to the home screen
  ├─ camera photos of each face, container number entry, marks, confirmation
  └─ HTTPS (same origin) ─▶ Plomba server (Node 24, TypeScript)
                              ├─ Meta Model API: Muse Spark, SAM 3.1 (built);
                              │   Muse Voice Transcribe, Muse Image (planned)
                              ├─ SQLite database + content-addressed photo store
                              ├─ hash-chained handover history
                              └─ serves the built web app
Offline / on-premise mode (planned): Muse Glimmer (open weights) behind the same Responses API
```

One process serves the API and the web app, so a company can run Plomba as one container on its own machine ([self-hosting.md](self-hosting.md)).

### Repository layout

| Path | What | Depends on |
|---|---|---|
| `packages/core` | Domain logic with no dependencies: ISO 6346, size/type codes, the face coordinate system, CEDEX location codes, homography, the hash chain. Runs on the server and in the browser | nothing |
| `packages/contracts` | zod schemas for every API request and response | core, zod |
| `apps/server` | HTTP API, model calls, persistence | core, contracts |
| `apps/web` | The PWA | core, contracts |

### The server: ports and adapters

- **Services** (`apps/server/src/services`) hold the workflow: identifying a container, running a handover, sealing it.
- **Ports** (`apps/server/src/ports.ts`) are the interfaces the services need: `MarkingsReader`, `Segmenter`, `MediaStore`, repositories, a clock and an ID generator.
- **Adapters** implement them:
  - `adapters/meta`: the Meta Model API (Muse Spark, SAM 3.1);
  - `adapters/sqlite`: Node's built-in `node:sqlite`, so there are no native modules to build;
  - `media`: a content-addressed photo store on the filesystem.
- **`main.ts` is the only place that reads configuration and wires adapters to services.** Tests swap in in-memory fakes at the ports.
- **The HTTP layer** (`http/app.ts`) validates every body with the shared contracts and reports errors as RFC 9457 problem details.

Node 24 runs the TypeScript sources directly (type stripping), so the server has no build step; `tsc` only type-checks.

## The Meta Model API

- **The server holds the key.** The Meta Model API has no client tokens, so the phone never talks to it directly. The key is read from a file (`META_API_KEY_FILE`), such as a Docker secret.
- **Every request sets `store: false`.** Inspection photos can show people and vehicles.
- **Plain `fetch`, no SDK** (`adapters/meta/client.ts`). Timeouts, and retries with backoff on 429 and 5xx. Every response is logged with model, latency and token or image usage, for cost tracking.
- **`META_API_BASE_URL` and the model IDs are configuration.** Any endpoint that serves Meta models through the Responses API can be used, e.g. a self-hosted open-weights model.

## How each model is used

| Step | Model | Input | Output | Status |
|---|---|---|---|---|
| Read the number, size/type, seals and placards | Muse Spark 1.3, structured output | Photo of the doors, downscaled to 1600 px | JSON, transcribed as painted | Built |
| Choose between valid repairs of a misread number | Muse Spark 1.3, structured output | Same photo and 2+ candidate numbers | The matching candidate, or none | Built |
| Find the face's corners | SAM 3.1, prompt `shipping container` | Photo of one face | Mask; its extreme points give the four corners | Built |
| Privacy | SAM 3.1, prompts `human face`, `license plate` | Every face photo | Boxes, blurred before the photo is stored | Built |
| Propose damage | SAM 3.1 (`dent`, `hole`, `rust`, …), then Muse Spark | Face photo | Candidate outlines with suggested CEDEX codes | Planned |
| Notes and commands | Muse Voice Transcribe | Streaming audio, Polish and English | Commands and note text | Planned |
| Compare and close | Muse Spark, tools | Previous and current handover | EIR content, CODECO message, draft claim | Planned |
| Offline mode | Muse Glimmer | As above, reduced | Number reading and damage labelling without internet | Planned |
| Test cases | Muse Image | Real photo plus an instruction edit | Labelled synthetic damage, never counted in accuracy | Planned |

### Identification is a verifiable loop

A vision model can read a worn number wrongly and still sound sure. So the model reads, deterministic code checks, and the checker decides.

1. **Muse Spark transcribes the markings as painted.** The prompt tells it not to "fix" characters to make the check digit work. When it did that unprompted, it produced a confident wrong number.
2. **The ISO 6346 check digit verifies the read.** If the read fails, `suggestContainerNumbers` (core) tries look-alike swaps (O/C/Q/D/0, S/5/9, B/8, I/1, …):
   - a character that can't stand where it is (a digit in the owner code) is always replaced;
   - up to two others may change.
3. **Every repair that passes the check digit is a candidate.**
   - Exactly one: it's proposed as a correction.
   - Several: Muse Spark compares them with the photo and may pick one.
4. **The checker confirms.** The model's pick between valid numbers is only advice, so the app shows every candidate with the changed characters highlighted.

A real example from 2026-10-28, on a worn `LSCU 107737 9`:
- Spark read `L90U1077379`. Three repairs pass the check digit: `LGDU…`, `LQDU…` and `LSCU…`.
- Across runs, Spark declined to choose, or chose `LQDU` with a plausible but wrong explanation.
- The checker picks `LSCU`. The check digit alone can't decide, so a person decides.

## Marks live on the container, not in the photo

A container moves between cities, so Plomba stores every mark in the container's own coordinates, keyed by the container number.

- **Face coordinates.** Each face (`D` door end, `R` right, `F` front, `L` left, `T` roof) has (u, v) in metres:
  - measured from its bottom-left corner, as seen by someone standing outside the face (u to the right, v up);
  - left and right are as seen from the door end looking towards the front;
  - the face's size comes from the size/type code (e.g. `42G1` is 12.192 × 2.438 × 2.591 m).
- **A photo is registered by its face's four corners.** SAM 3.1 outlines the container and the extreme points of the mask give the corners; the checker drags them into place if needed. Four corners define a homography between metres on the face and pixels in the photo.
- **A mark is a rectangle in metres on a face**, drawn by the checker on the photo and mapped through the inverse homography.
- **The next handover draws the same marks on its own photos.** Any photo of that face, from any phone, gets them through its own homography. These are the dashed "ghosts" the checker confirms as still there, changed or repaired.
- **Why not live AR:** Safari on iPhone has no WebXR, so world-tracked AR isn't available to a web app on iPhone. Overlays on photos work the same on iPhone and Android.
  - **(planned)** Overlays on the live camera preview, re-registered once or twice a second.
  - A native ARKit app remains an option if live tracking turns out to matter.

### CEDEX location codes

The server computes the ISO 9897 (CEDEX) location code from a mark's position (`packages/core/src/cedex.ts`), following IICL TB 002:

- **1st character:** the face.
- **2nd character:** the part of the face. T/B for the top/bottom half of the sides and ends; L/R for the left/right half of the roof; X when a mark crosses both.
- **3rd–4th characters:** the sections the mark covers.
  - Sides and roof: 5 sections on a 20 ft container, 10 on a 40 ft (numbered 1–9, then 0), counted from the door end.
  - Ends: 1 left corner post, 2 left half, 3 right half, 4 right corner post, seen from the door end.
  - One section is written `<n>N`, the whole length `XX`.

**Assumption to verify:** that side sections are counted from the door end. IICL numbers side posts, roof bows and cross-members that way, but the section rule isn't stated in the free sources.

## Evidence and the hash chain

- **Photos are re-encoded on the server before anything else.** sharp turns them upright, resizes them to 2048 px and re-encodes them, which strips EXIF metadata including GPS. The phone also downscales before upload.
- **Faces and number plates are blurred** (SAM 3.1 boxes plus a margin) before a photo is stored.
- **Photos are content-addressed**: a stored file's name is the SHA-256 of its bytes.
- **Closing a handover seals it.** The handover, its marks and its photos' hashes are serialised as canonical JSON (sorted keys). The record's hash covers the previous sealed record's hash and the record. Records chain per container.
- **Verification.** `GET /api/containers/:number` re-hashes the whole chain and reports where it breaks, e.g. after a record is edited directly in the database.
- **Concurrency.** Sealing uses optimistic concurrency, backed by a unique index on (container, sequence). A partial unique index allows only one open handover per container.

## Data model

| Table | Holds |
|---|---|
| `containers` | ISO 6346 number, size/type code, external dimensions |
| `handovers` | container, direction (in/out), place, checker, parties, seal numbers, status, previous handover; once sealed: sequence, previous hash, hash, the sealed record |
| `photos` | handover, face, SHA-256, size, the face's corners and whether they were detected or adjusted, number of blurred regions, capture time |
| `marks` | handover, face, rectangle in metres, CEDEX location code, damage and component codes, status (new, still there, changed, repaired), source (proposed, confirmed, rejected), the previous handover's mark it confirms, photo |

Migrations live in `apps/server/src/adapters/sqlite/migrations.ts` and are applied at startup.

## The web app

- **Stack:** React 19, React Router, TanStack Query (server state) and Vite, with vite-plugin-pwa providing the manifest and the Workbox service worker.
- **Installable on both platforms:**
  - Android and desktop Chrome show an install prompt;
  - iOS gets instructions for Share → Add to Home Screen, plus the iOS home-screen meta tags and icons.
- **Caching:** the app shell is precached; photos are cached for good (their URLs are content hashes); API calls always go to the network, so an inspection never shows stale data.
- **Camera:** the live rear camera through `getUserMedia`. Where that isn't available, the phone's camera app or the photo library.
- **Overlays:** SVG over the photo with `viewBox` in image pixels, so homography output is drawn directly and pointer positions map back to the face.
- **Languages:** English and Polish, chosen from the browser language and switchable.
- **Security:** a strict Content-Security-Policy with no inline scripts and no eval (zod runs in its `jitless` mode); the camera is allowed for this origin only.

## Standards used

- **ISO 6346 container numbers:**
  - A 3-letter owner code, a category letter (U, J or Z), a 6-digit serial and a check digit.
  - The check digit uses letter values A = 10 counting up and skipping multiples of 11, weights 2^position, then mod 11 and mod 10.
  - Test case: `CSQU305438` → check digit 3.
  - A/K/U, B/L/V, C/M/W, … collide in the check digit, so a repair can be ambiguous.
- **ISO 6346 size/type codes:** e.g. 22G1, 42G1, 45G1, L5G1 → length, width and height.
- **ISO 9897 (CEDEX):** location, damage (DT dent, HO holed, BT bent, CU cut, CO corroded, …) and component codes (PAA panel, RLA rail, CPS corner post, …), each in its own type, since the same letters mean different things in different lists.
- **EDIFACT CODECO (planned):** gate-in / gate-out report. BGM 34 = gate-in, 36 = gate-out; EQD, DTM, LOC, SEL and DAM segments.

## Meta AI glasses (planned)

Meta's Wearables Device Access Toolkit is a native iOS/Android SDK, so a web app can't stream from the glasses. A walk-around video recorded on the glasses can instead be uploaded into the same pipeline, as keyframes per face. Anything shown from this path is labelled as recorded on glasses.

## Security and privacy

- API keys exist only on the server, read from a file outside the repository; nothing secret goes into this repository.
- Faces and number plates are blurred, and EXIF/GPS metadata stripped, before photos are stored.
- Meta Model API requests are sent with `store: false`.
- History entries are hash-chained, so a changed record breaks the chain.
- Only openly licensed datasets and the author's own footage are used; sources and licences are listed when data is added.
