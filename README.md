# Plomba

**A digital seal on a shipping container's condition at every handover.**

*Plomba* is Polish for the seal on a container's doors, the tag that proves the box wasn't opened. Plomba does the same for the container's condition.

On its way from a seaport to the customer, a container changes hands several times: ship, port terminal, train, inland terminal, truck, depot. Each handover moves liability for damage. Yet at most inland and rail terminals, the container's condition is still recorded on paper or in loose phone photos. When a dent turns up later, nobody can prove where it happened.

Plomba is an iPhone app for the checker doing the walk-around at a handover, with optional hands-free capture from Meta AI glasses. It uses Meta's models to see, read, listen and reason, and AR on the phone to show what the previous handover recorded on the same container.

## What it will do

1. **Identify:** point the phone at the doors. The app reads the container number (validated with the ISO 6346 check digit), the seal number and any hazard placards, and loads the container's handover history.
2. **Locate:** the app recognises the container's faces and corner castings and builds a coordinate frame attached to the container itself, not to the room.
3. **Show the last handover:** damage recorded at the previous handover, even in another city, appears on the same spot of the same container in AR. The checker only confirms what's new.
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

- **iPhone:** the main device. Camera, ARKit overlays, review and confirmation.
- **Meta AI glasses (planned):** hands-free capture. The glasses stream video and audio to the iPhone app through Meta's Wearables Device Access Toolkit, so the checker can walk around the container with both hands free. AR overlays stay on the phone.

## Meta models

| Model | Job in Plomba |
|---|---|
| **SAM 3.1** | Segment and track the container's faces, corner castings, doors, seals and damage in video. It also anchors the AR overlay to the container |
| **Muse Spark** | Read the container number, seal and placards; suggest damage codes; run the agent that compares handovers and drafts the EIR, EDI message and claim |
| **Muse Voice Transcribe** | Spoken notes and commands in Polish and English; statements labelled by speaker when a handover is disputed |
| **Muse Glimmer** (open weights) | An offline and on-premise mode for terminals without reliable connectivity |
| **Muse Image** | Synthetic test cases of rare damage, labelled as synthetic and never counted in reported accuracy |

## Status

**2026-10-26: Day 0.** Project documentation is in place, and development starts today after the kickoff. Progress is recorded day by day in [docs/build-log.md](docs/build-log.md).

Plomba is being built for the **Meta Global AI Developer Hackathon 2026** (Startup Track, theme "Build for Your World"). Everything in this repository is created during the hackathon, starting 2026-10-26.

## Documentation

- [docs/product.md](docs/product.md): users, the handover flow, scope for the hackathon, principles
- [docs/architecture.md](docs/architecture.md): planned components, how each model is used, AR approach, data model, standards
- [docs/build-log.md](docs/build-log.md): dated log of what was built and when

## Author

Paweł Lisowski, [Lisovate](https://github.com/Lisovate), Gdynia, Poland
