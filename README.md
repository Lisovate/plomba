# Plomba

**A digital seal on a shipping container's condition at every handover.**

*Plomba* is Polish for the seal on a container's doors, the tag that proves the box wasn't opened. Plomba does the same for the container's condition.

On its way from a seaport to the customer, a container changes hands several times: ship, port terminal, train, inland terminal, truck, depot. Each handover moves liability for damage. Yet at most inland and rail terminals, the container's condition is still recorded on paper or in loose phone photos. When a dent turns up later, nobody can prove where it happened.

Plomba is an app for the checker doing the walk-around at a handover. It installs from the browser onto an iPhone or an Android phone. It uses Meta's models to see, read, listen and reason, and draws what the previous handover recorded onto photos of the same container.

It's open source (Apache-2.0) and built to be self-hosted: a terminal, depot or rail operator runs one container on its own machine and keeps its data. See [docs/self-hosting.md](docs/self-hosting.md).

## What it will do

1. **Identify:** point the phone at the doors. The app reads the container number (validated with the ISO 6346 check digit), the seal number and any hazard placards, and loads the container's handover history.
2. **Locate:** the checker photographs each face. The app finds the face's corners and maps the photo onto the container's own coordinates, in metres on each face, not in the room or the photo.
3. **Show the last handover:** damage recorded at the previous handover, even in another city, is drawn on the same spot of the same container in the new photos. The checker only confirms what's new.
4. **Record:**
   - The app proposes outlines of possible damage; the checker confirms by tap or by voice, in Polish or English.
   - Where each mark sits on the container becomes the standard ISO 9897 (CEDEX) location code, with damage and component codes suggested.
   - Faces and number plates are blurred.
5. **Close:**
   - an equipment interchange receipt (EIR) with annotated photos;
   - a comparison with the previous handover;
   - an EDIFACT CODECO gate message;
   - a draft claim when new damage is found;
   - a tamper-evident entry in the container's history.

## Devices

- **Phone (iPhone or Android):** the main device, through the installable web app. Camera, overlays, review and confirmation.
- **Meta AI glasses (planned):** hands-free capture. A walk-around recorded on the glasses is uploaded into the same pipeline. The glasses toolkit is a native SDK, so live streaming would need a native app.

## Meta models

| Model | Job in Plomba |
|---|---|
| **SAM 3.1** | Outline the container to register each photo to its face; find faces and number plates to blur; propose damage outlines |
| **Muse Spark** | Read the container number, seal and placards (checked by the ISO 6346 check digit); suggest damage codes; run the agent that compares handovers and drafts the EIR, EDI message and claim |
| **Muse Voice Transcribe** | Spoken notes and commands in Polish and English; statements labelled by speaker when a handover is disputed |
| **Muse Glimmer** (open weights) | An offline and on-premise mode for terminals without reliable connectivity |
| **Muse Image** | Synthetic test cases of rare damage, labelled as synthetic and never counted in reported accuracy |

## Status

**2026-10-28: Day 2.** Working end to end against the Meta Model API:

- reading the container number with Muse Spark, checked by the ISO 6346 check digit, with look-alike repair;
- photographing each face, with corners found by SAM 3.1 and faces and number plates blurred;
- damage marks stored in metres on the container and coded to CEDEX locations;
- the previous handover's marks drawn on the new photos, to be confirmed;
- sealing each handover into a hash-chained history;
- the installable web app in English and Polish, and a Docker image for self-hosting.

Progress is recorded day by day in [docs/build-log.md](docs/build-log.md).

Plomba is being built for the **Meta Global AI Developer Hackathon 2026** (Startup Track, theme "Build for Your World"). Everything in this repository is created during the hackathon, starting 2026-10-26.

## Quick start

```sh
npm ci
cp .env.example .env    # point META_API_KEY_FILE at a file holding your Meta Model API key
npm run dev:server      # API on http://localhost:8787
npm run dev:web         # app on http://localhost:5173
```

`npm run check` runs lint, type checks and tests. To run Plomba for real, with HTTPS and a phone, see [docs/self-hosting.md](docs/self-hosting.md).

## Documentation

- [docs/product.md](docs/product.md): users, the handover flow, scope for the hackathon, principles
- [docs/architecture.md](docs/architecture.md): components, how each model is used, marks in container coordinates, the hash chain, data model, standards
- [docs/evaluation.md](docs/evaluation.md): measured accuracy on openly licensed data
- [docs/self-hosting.md](docs/self-hosting.md): running Plomba on your own machine
- [docs/build-log.md](docs/build-log.md): dated log of what was built and when

## Licence

[Apache-2.0](LICENSE).

## Author

Paweł Lisowski, [Lisovate](https://github.com/Lisovate), Gdynia, Poland
