# Contributing

Plomba records evidence that parties may rely on in a dispute, so the rules below are about keeping that evidence, and the data behind it, trustworthy.

## Before every commit

- `npm run check`: lint (Biome), type checks and tests (Vitest).
- After changing the web app: `npm run build`, then `npm run test:e2e` (the end-to-end test in a phone-sized browser, against the real server and a fake Meta Model API).
- Commit messages follow conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`.

## Secrets

- The repository is public. API keys, `.env` files and key files never go into it.
- The server reads the Meta Model API key from a file outside the repository (`META_API_KEY_FILE`); see `.env.example`.
- Check that no staged change contains a key before committing.

## Data

- Use only openly licensed datasets or your own footage, and record the source and licence when adding data.
- No footage from restricted port areas, and no third parties' operational data.
- Blur faces and number plates before storing or publishing media. For video, `apps/server/scripts/blur-clip.ts` does it with SAM 3.1.
- Synthetic images (Muse Image) are labelled as synthetic and never counted in reported accuracy.

## Models

- Every model the product calls at run time is a Meta model, through the Meta Model API or Meta open weights.
- Accuracy claims come from the evaluation scripts in `apps/server/scripts/`, on labelled data, and go into `docs/evaluation.md` with the date, model and settings.

## Docs

- Plain, concrete English.
- `docs/build-log.md` records what was built and when.
