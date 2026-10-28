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

### Not measured yet

- Whole door photos taken the way the app is used (the author's own photos, planned).
- Size/type codes (TRUDI has labelled crops: `22G1`, `45G1`, …).
- Damage proposals and privacy blurring (see [build-log.md](build-log.md) for first observations).
