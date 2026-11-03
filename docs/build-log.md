# Build log

A dated record of what was built and when. The newest entry is at the bottom.

## 2026-10-26 (Mon): Day 0

- Created the repository at the hackathon kickoff.
- Wrote the project documentation: [README](../README.md), [product](product.md) and [architecture](architecture.md).
- Development starts today, after the kickoff.

**Next:**
- backend skeleton that holds the API key and calls Muse Spark and SAM 3.1;
- iPhone app skeleton with an ARKit camera view;
- ISO 6346 check-digit validation with tests.

## 2026-10-28 (Wed): Day 2

**Decision: an installable web app instead of a native iPhone app.**
- One app for iPhone and Android, installed from the browser, and a single container that a terminal or depot can host itself. The repository is now licensed Apache-2.0.
- Safari on iPhone has no WebXR, so there's no world-tracked AR in a web app on iPhone. Previous damage is drawn on photos of each face through a homography instead, the same on both platforms. A native ARKit app stays an option if live tracking turns out to matter.
- Meta's glasses toolkit is a native SDK, so glasses capture becomes uploading a walk-around recorded on the glasses.

**Built:**
- `packages/core`: ISO 6346 check digit, parsing and look-alike repair; size/type codes; the face coordinate system; CEDEX location codes and section cells; face-to-photo homography; SHA-256 hash chain over canonical JSON.
- `packages/contracts`: zod schemas for the whole API, shared by server and web app.
- `apps/server` (Node 24, Hono, `node:sqlite`, sharp):
  - Meta Model API client (Responses API, `store: false`, retries, usage logging);
  - identification with Muse Spark plus check-digit verification;
  - face photos with SAM 3.1 corner detection and blurring of faces and number plates;
  - marks coded to CEDEX locations;
  - handovers sealed into a per-container hash chain.
- `apps/web`: the PWA. Camera capture, identify, container history with chain status, the handover screen (face tabs, corner adjustment, drawing damage, the previous handover's marks as ghosts to confirm), sealing. English and Polish.
- Docker image, compose file with the key as a Docker secret, CI workflow, [self-hosting guide](self-hosting.md).
- 69 unit and integration tests.
- An end-to-end run in a phone-sized browser against the live Meta API: two handovers of one container (Gdynia gate-in, Łódź gate-out), the gate-in damage confirmed at gate-out, and the 2-entry chain verified. The second location is simulated.

**Findings from the live API:**
- **SAM 3.1** on a door-and-side photo of a 40 ft container (Wikimedia Commons, CC BY-SA 3.0, used for testing only and not stored in the repository):
  - `shipping container` segments the whole box with confidence 0.95;
  - `container door` finds one door leaf (0.52);
  - `corner casting`, `corner fitting` and `door locking bar` find nothing.

  So faces are registered from the container's outline, not from the corner castings.
- **SAM 3.1 now accepts box and point prompts and returns confidence scores** (`metadata.include_confidence`). Earlier research said it didn't.
- **Muse Spark misreads worn markings.**
  - It read `LSCU 107737 9` as `LSOU…` (its own "correction") and, when told to transcribe literally, as `L90U…`.
  - With the check digit and look-alike repair, three valid candidates remain. When asked to choose, Spark either declined or confidently chose a wrong one.
  - So the app shows every valid candidate and the checker decides.
- **Latency:**
  - Muse Spark (reasoning `low`) took 6–12 s per call; reasoning was 85–97% of the output tokens.
  - SAM 3.1 took about 2 s per image.

**Later on day 2:**
- **Damage proposals.** SAM 3.1 finds nothing for `dent`, `damage`, `crushed metal` or `torn metal`, even on a crushed container; `hole` finds bolt holes. So Muse Spark finds and codes the damage, and SAM 3.1 outlines each finding from a box prompt.
  - On a crushed 20 ft side, the result was `RXXX BT PAA` (Spark 98%, SAM 88%), in 6.7 s.
  - The checker confirms or rejects each proposal; sealing waits until all are reviewed.
- **EIR report** (printable; Save as PDF) with the seal, a comparison with the previous handover, the damage table, annotated photos and signature lines.
- **EDIFACT CODECO D.95B** (SMDG 1.6 layout) for sealed handovers, carrying the record's SHA-256.
- **First measured evaluation** ([evaluation.md](evaluation.md)): container identification on 96 TRUDI crops (CC BY-SA 4.0).
  - Enlarging small photos took verified-and-right from 32% to 62%.
  - The look-alike "corrections" were mostly wrong (3 right, 12 wrong across runs), so a read is now accepted only if it passes the check digit as read; repairs are suggestions the checker taps.
  - Result: 0 silent errors in 59 verified reads.
- **Privacy:** SAM 3.1 found a 22 × 8 px truck plate in a lossless PNG (confidence 0.52) but not after JPEG re-encoding. A plate that small is unreadable, but recall on small plates must be measured on photos with readable plates and faces before blurring is claimed to work.
- **Coverage per CEDEX section.** A section counts as covered when its whole outline, mapped through a photo's homography, lies inside that photo. Sealing with gaps needs the checker's consent, and the sealed record lists the sections that were not inspected.
- **Spoken notes with Muse Voice Transcribe.**
  - The browser records in its own codec (WebM/Opus or MP4/AAC) and converts the note to 24 kHz mono WAV, so the server needs no ffmpeg.
  - Recognition is biased to Polish and English and to container vocabulary.
  - A synthetic Polish note (espeak-ng) came back word for word in 3.7 s for 9.4 s of audio, apart from "wgniecenie" → "wgniecenia"; tested end to end through Chromium's fake microphone.
- **Claim agent.**
  - Muse Spark calls tools (the handover comparison, the container history) and drafts a claim for new damage.
  - The server checks every cited item, code and photo hash, and the record hashes in the letter, against the sealed records, and sends failing drafts back as feedback.
  - Live: 7 s, first draft passed, only the new dent claimed, in English and Polish.
- **Access code** (`PLOMBA_ACCESS_CODE`) for installations without single sign-on: a signed, HttpOnly session cookie gates the API and photos, so a public demo URL can't spend the Meta credit.
- **End-to-end test in CI**: Playwright drives the built app in a phone-sized browser against the real server, with a fake Meta Model API replaying SAM 3.1's recorded outline of a synthetic photo.
- **Vision on your own hardware**: reading and damage detection can use any OpenAI-compatible Chat Completions server (e.g. Ollama serving Muse Glimmer) via `META_VISION_BASE_URL`. Tested against Meta's own Chat Completions endpoint; Glimmer itself is still to be tried on a Mac with enough memory.
- **Live ghosts on the camera preview.** On a face with previous marks, a frame goes to SAM 3.1 every 1.5 s (not stored) and the marks are drawn over the live video. Tested with a fake camera feed in Chromium.
- **Synthetic robustness tests with Muse Image.**
  - Muse Image added a dent, a hole, corrosion and a bent rail to a drawn container, plus a mud-only control. Muse Spark found every damage and nothing on the control.
  - Images are labelled SYNTHETIC in their pixels and kept out of the repository and out of accuracy figures.
- **Privacy prompts measured** on five openly licensed truck photos: every readable plate found; `face` found 6 of 7 faces, `human face` 5.
- **Rail and road transport.** A handover records whether the container came by truck (registration) or rail wagon. Wagon numbers are checked with the UIC check digit as they're typed (e.g. `21 81 2471 217-3`). The CODECO message carries the leg as TDT (rail 2, road 3).
- **The app explains identification and errors in Polish or English**, with Muse Spark's own note shown separately.

**Next (day 3):**
- test on a real iPhone and Android phone over HTTPS: camera, installing to the home screen, dictation;
- photograph real containers (own footage, outside restricted port areas), head-on per face;
- measure identification, damage proposals and privacy blurring on those photos;
- try Muse Glimmer on a Mac through Ollama as the vision model, and measure it with the eval script;
- deploy a demo instance behind HTTPS with an access code.

**Evening (day 2):** a desktop simulation of the walk-around, since live AR on a phone needs a trusted HTTPS address.
- **AR on recorded video with SAM 3.1 video tracking.**
  - A clip is uploaded through the Files API and SAM 3.1 tracks the container through every frame in one request: 450 frames in 26 s.
  - The browser plays it with the container's CEDEX sections and the previous handover's damage drawn on it, frame by frame, following SAM's stable object ID.
  - Tracking results are cached by the clip's hash; clips aren't stored.
- **Test footage:** "StraddleCarrierLiftsContainerFromDoubleStackTrain" by 4300streetcar, Wikimedia Commons, CC BY 4.0 (2021). Converted to 30 s of 15 fps MP4 for testing; not stored in the repository. Openly licensed walk-around inspection footage hardly exists, so the next clips will be the author's own.
- **Video tracking on a real inspection clip** (a YouTube video, used locally for testing only; not stored or published).
  - A 40 ft container sliding off a tilt trailer, side-on: SAM 3.1 tracked all 302 frames, and the CEDEX grid and the earlier damage stayed on the side as it tilted and levelled.
  - **Finding:** a close-up of the door end failed. The face didn't fit in the frame, and registering from the container's outline needs all four corners of the face in view. Close-ups will need another anchor (corner castings, locking bars, markings).

## 2026-11-03 (Tue): Day 8

**Built:**
- **Walk-around video → face photos.** One clip from a phone or Meta AI glasses becomes the handover's photos.
  - SAM 3.1 tracks the container through every frame.
  - Plomba scores each frame: zero when the face is cut off by the frame edge; otherwise its size times how square-on it is. It picks up to 12 frames at least a second apart.
  - The browser cuts the frames out of the clip, so the server needs no video decoder.
  - Muse Spark names the face in every frame in one call, with the frames in clip order, and reads the doors; the number is compared with the handover's.
  - The checker confirms, and the frames go through the photo pipeline (registration, blurring, coverage, damage proposals).
  - While the clip plays, the overlay follows the face in view. This replaces the desktop simulation page.
- **Damage passport** on the container page.
  - Every damage on a map of the faces, coloured by the sealed handover that first recorded it.
  - For each damage, the latest earlier handover whose photos covered that spot and didn't record it: the damage happened between the two. Handovers with no photo of the spot are listed.
  - Built only from the sealed records, and only while the hash chain verifies.
- **Open weights, measured.** The identification eval now reads markings through the configured vision endpoint. On Muse Spark Open (`meta-models/muse-spark-open-1026`, open weights, hosted on Baseten), 54.2% of the 96 TRUDI crops were verified and right, with no silent errors, against 61.5% for Muse Spark 1.3 ([evaluation.md](evaluation.md)).

- **Damage by voice.** The checker says "wgniecenie, lewy bok, sekcja trzecia, na dole".
  - Muse Voice Transcribe hears it, and Muse Spark codes each damage: the face, the CEDEX sections and half, and the damage and component codes.
  - `sectionRect`, the inverse of the location code, turns the sections into a proposed mark for the checker to confirm.
  - Damage said without a place ("a hole somewhere on the roof") is reported back, not guessed.
  - Live: a synthetic Polish note was transcribed word for word and placed at `LB3N DT` in 7.3 s. Typed notes in Polish and English gave `LB3N DT`, `DB3N CO` and `LT90 DT RLA`.
- **Corner views register two faces.**
  - A container seen corner-on from about eye level has a hexagonal outline: the near edge stands out above and below the outer corners, at the same x. Plomba splits SAM 3.1's mask there into the two faces' quads.
  - Muse Spark names the faces either side of the edge, checked by the rule that the right-hand face follows the left-hand one round the container.
  - On a CC BY clip of a 40 ft container, 169 of 180 frames split, and one corner frame registered the end and the long side.
- **Clear frames first.** Muse Spark also flags frames where the face is blurred or something stands in front of it; they count half when choosing photos. The rule had to name small obstructions: at first Spark noted "finger in foreground" and still called the frame clear.
- **The whole vision pipeline on open weights.** With `META_VISION_*` pointed at Muse Spark Open (Baseten), a walk-around on the rusty CC BY clip named the left side, registered it, and proposed the real corrosion (`LX68 CO PAA`, `LX56 CO PAA`). Spoken notes coded 20 of 20, as on Muse Spark 1.3. Baseten takes at most 8 images per request, so the face classifier now sends long walk-arounds in balanced runs.
- **Code review of the day's work** found five real defects, all fixed:
  - the frame rate was guessed from SAM's last frame, which shifted grabbed frames; it is now read from the MP4/MOV boxes;
  - the passport could date damage "between" handovers when an earlier record showed damage on the same spot, or from records without coverage data;
  - a broken chain or unloaded history read as "no damage" or "at this handover";
  - a corner frame could also be chosen whole, out of sight;
  - an earlier analysis could overwrite a newer one.
- **The EIR says where each damage was first recorded,** or for new damage, the last handover that photographed the spot clean.
- **The demo installation** runs behind HTTPS on the author's server, with an access code. It holds one container's story from openly licensed footage: rust recorded at gate-in, then drawn as a ghost on a different photo at gate-out. A one-line operator notice (`PLOMBA_NOTICE`) labels it as a demo and credits the footage.
- **README:** screenshots, a pipeline diagram, findings about the models, and the limits. The home screen explains the steps on a first visit. Fonts are named before `system-ui`, which resolved to a monospace font on a Linux desktop.

**Findings:**
- **Naming faces from a walk-around** (test clips used locally only, not stored or published):
  - On a drone clip of a 20 ft container, Muse Spark named the long side (95%) and called every corner-on frame "no single face".
  - On a 40 ft container on a trailer (side and door end in separate clips), it named the left side and the doors correctly.
  - With the ends of the side out of view, the clue that containers ride doors to the rear raised its confidence from 75% to 90%.
- **Close-range clips give no usable frames.** When the camera stays a few metres from a 40 ft container, the top corners never come into view, and a face can't be registered from a partial outline. The app now says so and asks for a recording from further back. Registering partial faces (from corner castings or markings) is the next step.
- **Test footage:** 26 clips cut for local testing, a few from YouTube videos their uploaders marked CC BY. Openly licensed walk-around footage of a single container is still scarce on Wikimedia Commons.

**Next (day 9, the last):**
- deploy the demo instance behind HTTPS with an access code, and test on a real phone;
- record the 3-minute demo video;
- final README pass and submission.
