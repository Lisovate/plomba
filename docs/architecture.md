# Architecture (planned)

Written 2026-10-26, before development started. It will change as the build progresses; changes are recorded in [build-log.md](build-log.md).

## Components

```
Meta AI glasses (optional) ── video + audio via Wearables Device Access Toolkit ──┐
                                                                                   ▼
iPhone app (Swift, SwiftUI, ARKit, RealityKit)
  ├─ camera keyframes (phone or glasses), audio, AR poses
  └─ HTTPS / WebSocket ─▶ Backend (TypeScript, Node)
                            ├─ Meta Model API: SAM 3.1, Muse Spark, Muse Voice Transcribe, Muse Image
                            ├─ containers, handovers, marks, evidence (database + media store)
                            ├─ EIR PDF, EDIFACT CODECO, hash-chained history
                            └─ web view of a container's history
Offline / on-premise mode: Muse Glimmer (open weights) served as an endpoint
Stretch: Quest 3 web app (WebXR) showing a container's history at full size
```

- **The backend holds all API keys.** The app never talks to model APIs directly.
- **SAM output is parsed on the backend** into polygons for the app.
- **Glasses are a second capture source.**
  - The iPhone app receives the glasses' video and audio through the Wearables Device Access Toolkit and sends keyframes into the same pipeline.
  - AR overlays and confirmation stay on the phone.
  - Development and tests use the toolkit's Mock Device Kit, which replays an H.265 video file as the glasses' camera feed.

## How each model is used

| Step | Model | Input | Output |
|---|---|---|---|
| Read the number, seal and placards | Muse Spark (vision, structured output) | Keyframe of the doors | Container number, size/type, seal number, placard classes, as JSON |
| Find the container's geometry | SAM 3.1 | Keyframes, one text prompt per concept ("corner casting", "container door", …) | Masks and boxes used to register the AR frame |
| Propose damage | SAM 3.1, then Muse Spark | Keyframes; prompts such as "dent", "hole", "rust", "bent bar" | Candidate outlines, which Spark ranks and labels with suggested CEDEX damage and component codes |
| Notes and commands | Muse Voice Transcribe | Streaming audio, Polish and English | Commands ("mark: dent", "still there"), note text, speaker-labelled statements |
| Compare and close | Muse Spark (tools) | Previous and current handover records | Comparison, EIR content, CODECO message, draft claim |
| Offline mode | Muse Glimmer | As above, reduced | Number reading and damage labelling without internet |
| Test cases | Muse Image | Real photo plus an instruction edit | Labelled synthetic damage for robustness tests only |
| Privacy | SAM 3.1 | Keyframes; prompts "person" and "license plate" | Masks blurred before storage |

## AR approach: attach marks to the container, not the room

Room-scale AR anchors only work in the same place on the same device. A container moves between cities, so Plomba stores every mark in the container's own coordinates.

1. ARKit detects the vertical planes of the container's faces.
2. SAM 3.1 finds the corner castings, and raycasts turn them into 3D points.
3. Those points define a frame attached to the container: origin at a reference corner, axes along its length, width and height. The container's dimensions come from its size/type code.
4. Each mark is stored as `(face, u, v)` in metres, keyed by the container number.
5. At the next handover, any phone rebuilds the same frame from the container and draws the stored marks in place.

Between the model updates (1–2 per second), ARKit's tracking keeps the overlay steady. **Fallback:** overlays drawn on recorded frames by mapping each flat face onto the image.

## Data model (first version)

- **Container:** number, owner code, size/type, dimensions.
- **Handover:** container, place, time, parties, device, checker, direction (in or out), status, previous handover, hash of the previous entry.
- **Mark:** handover, face, u, v, extent, CEDEX location, damage code, component code, status (new, still there, changed, repaired), source (proposed or confirmed).
- **Evidence:** handover, frame (blurred), pose, time, the masks behind it.
- **Statement:** handover, speaker, transcript.

## Standards used

- **ISO 6346 container numbers:**
  - A 3-letter owner code, a category letter (U for freight containers), a 6-digit serial and a check digit.
  - The check digit uses letter values A = 10 counting up and skipping multiples of 11, weights 2^position, then mod 11 and mod 10.
  - Test case: `CSQU305438` → check digit 3.
- **ISO 9897 (CEDEX) location codes:**
  - Four characters: the face (L, R, F, D, T, B, U, I…), the part of the face (top or bottom half, etc.) and two characters for sections along the length.
  - A 20 ft side has 5 sections; a 40 ft side has 10.
  - Damage codes include DT (dent), HO (hole), BT (bent), CU (cut) and CO (corroded).
- **EDIFACT CODECO** (gate-in / gate-out report): BGM 34 = gate-in, 36 = gate-out. The equipment (EQD), dates (DTM), place (LOC), seals (SEL) and damage (DAM) segments.

## Security and privacy

- API keys exist only on the backend; nothing secret goes into this repository.
- Faces and number plates are blurred on the backend before frames are stored.
- History entries are hash-chained, so a changed record breaks the chain.
- Only openly licensed datasets and the author's own footage are used; sources and licences are listed when data is added.
