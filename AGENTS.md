# Agent guide

## Project reality

- **Current state:** Plomba is in development for the Meta Global AI Developer Hackathon 2026 (Oct 26 – Nov 4). `docs/product.md` and `docs/architecture.md` describe the target; `docs/build-log.md` records what actually exists.
- **Update the build log daily** with what was built.

## Rules

- **Only work created during the hackathon belongs in this repository.** Don't import code from other projects.
- **The repository is public, so no secrets.** API keys, `.env` files and key files stay out of commits, and out of screen recordings.
- **Data:** only openly licensed datasets (record the source and licence when adding data) and the author's own footage. No footage from restricted port areas, and no third parties' operational data.
- **Privacy:** blur faces and number plates before storing or publishing media.
- **Models:** every model the product calls at run time is a Meta model, through the Meta Model API or Meta open weights.
- **Synthetic images** (Muse Image) are labelled as synthetic and never counted in reported accuracy.

## Stack

- **iPhone app:** Swift, SwiftUI, ARKit, RealityKit.
- **Backend:** TypeScript on Node 22+.
- **Meta models:** SAM 3.1, Muse Spark, Muse Voice Transcribe, Muse Glimmer, Muse Image.

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- Plain, concrete English in docs.
