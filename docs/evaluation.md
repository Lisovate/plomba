# Evaluation

Measured results of Plomba's model pipeline on openly licensed, labelled data. Numbers are reproducible with the scripts in the repository. Synthetic images are never counted here.

## Container identification

**What's measured:** the production `IdentifyService` with the Muse Spark adapter, exactly as the app runs it.
1. Muse Spark reads the markings.
2. The ISO 6346 check digit verifies the read.
3. Look-alike repair proposes candidates when it fails.
4. Muse Spark picks between several candidates.

### Data

- **Dataset:** TRUDI, the ground-perspective text-recognition test split. E. Gülsoylu et al., "TRUDI and TITUS: A Multi-Perspective Dataset and A Three-Stage Recognition System for Transportation Unit Identification", BMVC 2025. https://github.com/egulsoylu/trudi
- **Licence:** CC BY-SA 4.0.
- **Use:** the images are used for evaluation only and are not stored in or distributed with this repository; only aggregate results are published here.
- **Samples:**
  - 96 crops of container numbers from photos taken at inland ports with phones, action cameras and DSLRs.
  - The 293 crops of the split were filtered to labels that are valid ISO 6346 numbers. Nine `LKWA…` swap-body codes (EN 13044, category A) were left out.
- **Harder than the app's own input.** Many crops are tiny (e.g. 132 × 29 px), blurred, worn or written vertically. In the app the checker photographs the doors from a few metres at up to 1600 px.

### Results (2026-10-28, `muse-spark-1.3`, reasoning `low`)

| | No enlarging | **Enlarged to ≥ 1024 px (shipped)** |
|---|---|---|
| Muse Spark's raw read exactly right | 28.1% | **61.5%** |
| Unreadable | 53.1% | 19.8% |
| **Verified and right**: accepted with no input from the checker | 32.3% | **61.5%** |
| **Silent errors**: verified but wrong | — | **0 of 59 (0%)** |
| Latency p50 / p90 | 2.9 s / 11.0 s | 2.4 s / 9.2 s |
| Cost per photo | $0.0045 | $0.0044 |

Run with: `node --env-file=.env apps/server/scripts/eval-identify.ts <TRUDI text_recognition/ground/test> [--min-long-side 0]`.

**Uncertainty:** with 0 errors in 59 verified reads, the "rule of three" puts the true silent-error rate below about 5% at 95% confidence. More data is needed to claim less.

### Open weights: Muse Spark Open (2026-11-03)

The same 96 crops, the same service and settings (enlarged to ≥ 1024 px), with the markings read by **Muse Spark Open** (`meta-models/muse-spark-open-1026`, open weights, hosted on Baseten) through the Chat Completions path that a self-hosted model would use (`META_VISION_*`).

| | Muse Spark 1.3 (Meta Model API, 2026-10-28) | **Muse Spark Open (open weights)** |
|---|---|---|
| Raw read exactly right | 61.5% | 54.2% |
| Unreadable | 19.8% | 31.3% |
| **Verified and right** | 61.5% | **54.2%** |
| **Silent errors** | **0 of 59** | **0 of 52** |
| Latency p50 / p90 | 2.4 s / 9.2 s | 4.4 s / 9.4 s |

Run with the vision endpoint pointed at the open model, e.g.:

```sh
META_VISION_BASE_URL=https://inference.baseten.co/v1 META_VISION_API_STYLE=chat-completions \
META_VISION_API_KEY_FILE=~/.config/plomba/baseten.key META_VISION_MODEL=meta-models/muse-spark-open-1026 \
node --env-file=.env apps/server/scripts/eval-identify.ts <TRUDI text_recognition/ground/test>
```

**Finding:** the open model reads less (more crops come back unreadable), but what it accepts is as safe. The check digit keeps silent errors at zero on both, so a company can run identification on open weights and lose only convenience (more numbers typed or tapped), not correctness.

### Findings and the decisions they drove

1. **Enlarging small photos before reading doubles accuracy.** Tight or distant shots are scaled up to a long side of at least 1024 px, so the model sees more pixels per character. Verified-and-right rose from 32.3% to 61.5% at the same cost. This is now the default (`DEFAULT_MIN_LONG_SIDE`).
2. **The check digit is a reliable detector and an unreliable corrector.**
   - No read that passed the check digit was wrong.
   - The first version also accepted "corrections": a misread repaired by swapping look-alike characters until the check digit passed. Across the two runs, 3 corrections were right and 12 were wrong (all 6 were wrong with enlarging).
   - The reason: a read with two wrong characters has dozens of one-character variants, and about one in ten passes the check digit by chance. So a "unique valid repair" is usually a coincidence.
   - **Decision:** only a read that passes as read is accepted. A repair is a suggestion the checker must tap explicitly; the number field stays empty until then. With this rule the shipped configuration has no silent errors on this set.
3. **When several repairs pass, Muse Spark's pick is advice, not evidence.**
   - On a worn `LSCU 107737 9` it either declined or confidently picked a wrong candidate.
   - In the final run its suggestion was right in 3 of 10 suggested cases.
   - The app shows every valid candidate.

## Privacy: finding faces and number plates (2026-10-28)

A small check: five photos of trucks and people, from Wikimedia Commons (CC BY 4.0, CC BY-SA 4.0 and public domain), used for testing only and not stored in the repository. Ground truth was counted by eye. SAM 3.1 ran on each photo with each prompt.

| | Visible | Found |
|---|---|---|
| Readable number plates | 4 | **4**, plus 2 "ROAD TRAIN" signs (over-blurring is harmless) |
| Faces | 7 | **6** with `face`, 5 with `human face`. Missed by both: a driver in profile behind a side window |

**Decision:** the privacy prompts are `face` and `license plate`. `face` found everything `human face` found, plus a driver behind a windscreen.

An earlier observation: a plate of 22 × 8 px (far away, unreadable) was found in a lossless PNG at confidence 0.52 but not after JPEG re-encoding. Plates too small to read carry no privacy risk, but small faces deserve more measurement. Tiling large photos is the next step if recall on real yard photos is low.

## Synthetic robustness tests (not counted in accuracy)

**Method:**
1. Muse Image (`muse-image-1.0`, image edits) adds one known damage to a clean container photo.
2. The production damage detector (Muse Spark) must find it.
3. A negative control adds only mud and dirt, and must produce no damage.

**Labelling:** every generated image carries a "SYNTHETIC · Muse Image · not a real photo" label in its pixels and a `synthetic-` file name. The images stay out of the repository.

Run with: `node --env-file=.env apps/server/scripts/synthetic-damage.ts <clean photo> <output dir>`.

2026-10-28, on the flat drawn container in `e2e/fixtures/container-side.jpg`:

| Synthetic case | Expected | Found by Muse Spark | Pass |
|---|---|---|---|
| dent | DT, BW, BT | DT 95%, BT 90% | yes |
| hole | HO, CU, BR | HO 99% | yes |
| corrosion | CO, PH | CO 96% | yes |
| bent-rail | BT, DT, BW, BR | BW 95% | yes |
| dirt-only | none | none | yes |

These are easy cases: damage drawn by a model on a drawing. They show that the pipeline reads each damage type and leaves dirt alone; they say nothing about accuracy on real containers. The next run uses the author's own clean photos as the base.

## Not measured yet

- Whole door photos taken the way the app is used (the author's own photos, planned).
- Size/type codes (TRUDI has labelled crops: `22G1`, `45G1`, …).
- Damage proposals on labelled damage photos.
- Privacy recall on the author's own yard photos.
