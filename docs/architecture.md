# Architecture

First written 2026-10-26 as a plan; rewritten 2026-10-28 when development moved from a native iPhone app to an installable web app. Sections marked **(planned)** aren't built yet. What's built, and when, is in [build-log.md](build-log.md).

## Components

```
Phone (iPhone or Android): Plomba PWA in the browser or installed to the home screen
  ├─ camera photos of each face, container number entry, marks, confirmation
  └─ HTTPS (same origin) ─▶ Plomba server (Node 24, TypeScript)
                              ├─ Meta Model API: Muse Spark, SAM 3.1, Muse Voice
                              │   Transcribe (built); Muse Image for synthetic tests only
                              ├─ SQLite database + content-addressed photo store
                              ├─ hash-chained handover history
                              └─ serves the built web app
On-premises option: reading and damage detection on Muse Glimmer (open weights) through any
OpenAI-compatible Chat Completions server (e.g. Ollama), configured as a separate vision endpoint
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
| Privacy | SAM 3.1, prompts `face`, `license plate` | Every face photo | Boxes, blurred before the photo is stored | Built |
| Find and code damage | Muse Spark 1.3, structured output | Registered face photo | Rough boxes with CEDEX damage and component codes, a description and a confidence | Built |
| Outline damage | SAM 3.1, one box prompt per finding | Same photo and Spark's boxes | Precise masks, mapped onto the face in metres as proposed marks | Built |
| Spoken notes | Muse Voice Transcribe 1.0, push-to-talk | A note recorded in the browser, converted there to 24 kHz mono WAV | Note text in Polish or English, biased to container vocabulary | Built |
| Voice commands, disputes by speaker | Muse Voice Transcribe, streaming and diarisation | Live audio | Commands; statements labelled by speaker | Planned |
| Compare and close | Deterministic code | Previous and current handover | EIR report, CODECO message | Built |
| Draft a claim | Muse Spark 1.3, tool calling + structured output | Photos of the new damage; tools for the comparison and the container's history | A claim letter whose items and evidence are verified against the sealed records | Built |
| On-premises vision | Muse Glimmer through Chat Completions (Ollama, llama.cpp, vLLM) | As the two Muse Spark vision rows | The same JSON, from a model on the company's own hardware | Path built and tested against the Meta API; not yet run on Glimmer |
| Test cases | Muse Image 1.0, image edits | A clean container photo and an instruction ("add a dent…") | Labelled synthetic damage for robustness tests, never counted in accuracy (`scripts/synthetic-damage.ts`) | Built |

### Identification is a verifiable loop

A vision model can read a worn number wrongly and still sound sure. So the model reads, deterministic code checks, and the checker decides.

1. **Muse Spark transcribes the markings as painted.** The prompt tells it not to "fix" characters to make the check digit work. When it did that unprompted, it produced a confident wrong number.
2. **The ISO 6346 check digit verifies the read.** If the read fails, `suggestContainerNumbers` (core) tries look-alike swaps (O/C/Q/D/0, S/5/9, B/8, I/1, …):
   - a character that can't stand where it is (a digit in the owner code) is always replaced;
   - up to two others may change.
3. **Every repair that passes the check digit is a candidate.**
   - Exactly one: it's suggested.
   - Several: Muse Spark compares them with the photo and may suggest one.
4. **Only a read that passes as read is accepted** (`verified`). A suggestion or a choice between candidates is shown with the changed characters highlighted, and the checker taps the right one or types the number.
   - Measured on 96 real crops ([evaluation.md](evaluation.md)): no verified read was wrong, but most unique repairs were. The check digit detects misreads reliably and corrects them poorly.
   - Small photos are enlarged before reading, which doubled accuracy.

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
  - **Live ghosts:** when the checker opens the camera on a face with previous marks, the app sends a 768 px frame about every 1.5 s to `POST /api/handovers/:id/frames`. SAM 3.1 finds the face there, the frame is not stored, and the marks are drawn over the live preview. Between registrations the overlay doesn't track movement; ARKit-style tracking would need a native app.
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

## Damage proposals

SAM 3.1 doesn't find container damage from concept prompts: `dent`, `damage` and `crushed metal` return nothing even on a crushed container, and `hole` finds bolt holes. So the two models split the work:

1. **Muse Spark finds and codes the damage** on a registered face photo: a rough box per damage, CEDEX damage and component codes, a description and a confidence.
2. **SAM 3.1 outlines each finding** from a box prompt, all boxes in one request. On a torn panel it tightened Spark's box from x = 957 to the tear's real edge at x = 832.
3. **The outline is mapped onto the face** through the inverse homography. It becomes a rectangle and outline in metres with a computed CEDEX location code, stored as a mark with source `proposed`.
   - Findings below 30% confidence, mostly off the face, or overlapping an existing mark are dropped.
4. **The checker confirms or rejects every proposal.** A handover can't be sealed while proposals are pending.

## The claim agent: verified, not trusted

When a sealed handover shows damage that the previous handover didn't record, Muse Spark drafts a claim against the party that had custody in between (`services/claims.ts`).

1. **The agent gathers facts with tools.** `get_handover_comparison` returns both handovers, the new damage with sizes in mm and photo hashes, and what happened to earlier damage. `get_container_history` returns every sealed handover and whether the hash chain verifies. Photos of the new damage go with the task.
2. **It answers in a fixed JSON shape**: addressee, subject, summary, cited items and the letter.
3. **The service verifies the draft against the sealed records.**
   - Every cited item must be new damage, with the recorded location, damage code and photo SHA-256.
   - Every new damage must be cited.
   - The letter must state the container number and both record hashes.

   Any failure goes back to the agent as feedback, up to three drafts, and the API returns only a draft that passed. Tests use a scripted agent that cites an invented mark first.
4. **The conversation travels with each request.** Requests are sent with `store: false`, so the agent replays the model's output items (including its encrypted reasoning) and the tool results instead of using `previous_response_id`.

Live, on a container with one old hole and one new dent, Muse Spark called both tools, passed verification on the first draft and claimed only the dent. It took 7 s, in English or Polish.

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
- **EDIFACT CODECO D.95B** in the SMDG 1.6 profile (`packages/core/src/codeco.ts`):
  - the gate-in / gate-out report: BGM 34 = gate-in, 36 = gate-out; then EQD, DTM, LOC, SEL, and DAM/COD for up to 9 damages;
  - Plomba adds the sealed record's SHA-256 in an FTX segment, so the message points to the tamper-evident record;
  - generated only for sealed handovers.
- **EIR (equipment interchange receipt):** a printable page in the web app; Print → Save as PDF gives the document the parties keep.

## Meta AI glasses (planned)

Meta's Wearables Device Access Toolkit is a native iOS/Android SDK, so a web app can't stream from the glasses. A walk-around video recorded on the glasses can instead be uploaded into the same pipeline, as keyframes per face. Anything shown from this path is labelled as recorded on glasses.

## Security and privacy

- API keys exist only on the server, read from a file outside the repository; nothing secret goes into this repository.
- Faces and number plates are blurred, and EXIF/GPS metadata stripped, before photos are stored.
- Meta Model API requests are sent with `store: false`.
- History entries are hash-chained, so a changed record breaks the chain.
- Only openly licensed datasets and the author's own footage are used; sources and licences are listed when data is added.
