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

**Next:**
- damage proposals from SAM 3.1, ranked and coded by Muse Spark;
- EIR report and EDIFACT CODECO message;
- coverage per CEDEX section;
- test on a real phone over HTTPS.

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
