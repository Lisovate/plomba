# Leasing company: fleet condition and off-hire charges

**For:** container owners and leasing companies, and their fleet and M&R (maintenance and repair) teams.

**The pain:** a lessor's containers are out with lessees for months, and their condition is known only from scattered depot surveys. At off-hire, the depot finds damage and the lessor recharges the lessee, who answers that it was there at on-hire. Without one record of each container's condition at both ends, recharging is slow and often written off.

**What it does:**
- **Fleet report.** For an owner code, the condition of every container from Plomba's sealed records: open damage, repaired damage, the last handover, and whether the container's hash chain verifies. CSV for the fleet system, Markdown for people.
- **Off-hire statement.** For a container and two handovers, on-hire and off-hire, the damage first recorded between them: what the lessee is charged for. Each item comes with its evidence: the handover that last showed the spot clean and the one that first recorded the damage, with their record hashes.

## The flow

**Fleet report** (`fleet`):
1. List the owner's containers: `GET /api/containers?owner=PLBU&limit=500`.
2. Read each container's history (`GET /api/containers/{number}`), four at a time.
3. For each container (`conditionOf`): damage not repaired is open, the rest repaired. Damage comes from the sealed records only. Plomba gives none for a container whose chain doesn't verify, so the report says "unknown" there rather than "none".
4. Write `fleet-<owner>.csv` (one line per container) and `fleet-<owner>.md`.

**Off-hire statement** (`lease`):
1. Read the container's history. Its chain must verify, and both handovers must be sealed, with off-hire after on-hire.
2. For each damage in the passport (`compareLease`), by its position in the chain:
   - first recorded at or before on-hire, and not repaired by then: **already there at on-hire**, not charged;
   - first recorded after on-hire, up to and including off-hire, and repaired by off-hire: **repaired during the lease**;
   - first recorded in the lease, and `lastClear` is the on-hire handover or a later one: **chargeable**. A handover in the lease saw the spot clean;
   - first recorded in the lease, but damage was already recorded on that spot (`recordedNearbyAt`), or no handover in the lease photographed it clean: **for review**, with the reason;
   - first recorded after off-hire: not part of this lease.
3. Print the statement as Markdown, or as JSON with `--json`.

## Running it

With `PLOMBA_URL` and `PLOMBA_API_TOKEN` set as in [the examples README](../README.md#running-them-against-your-plomba):

```sh
node examples/leasing-fleet-condition/main.ts fleet --owner PLBU --out /tmp/reports
node examples/leasing-fleet-condition/main.ts lease --container PLBU4000043 \
  --on-hire 00000000-0000-4000-8000-000000000001 --off-hire 00000000-0000-4000-8000-000000000014
```

Handover ids are in the app's address bar, in the webhooks, and in `GET /api/containers/{number}`. The ids above are the [sandbox's](../README.md#without-a-meta-key-the-sandbox): the Gdynia gate out (on-hire) and the Łódź gate out by rail (off-hire).

The fleet report against the sandbox:

```text
3 container(s) with owner code PLBU: 1 with open damage, 0 with a broken chain.
Wrote /tmp/reports/fleet-PLBU.csv
Wrote /tmp/reports/fleet-PLBU.md
```

`fleet-PLBU.csv`:

```csv
container,size_type,handovers,sealed,chain,open_damage,open_codes,repaired_damage,repaired_codes,last_handover_at,last_handover_place,last_handover_leg,last_handover_status
PLBU4000064,45G1,1,0,none,0,,0,,2026-10-28T08:00:31.000Z,Łódź inland terminal,"gate in, by road, truck EL 4K217",open
PLBU4000059,22G1,1,1,verified,0,,0,,2026-10-28T08:00:29.000Z,Łódź inland terminal,"gate in, by road, truck LD 5520C",closed
PLBU4000043,42G1,3,3,verified,4,RX5N DT; DX2N BT; RX5N DT; TX56 HO,1,LB89 CO,2026-10-28T08:00:19.000Z,Łódź inland terminal,"gate out, by rail, wagon 33 51 4556 012-4",closed
```

`fleet-PLBU.md`:

```markdown
# Fleet condition: PLBU

3 container(s), 1 with open damage. Generated 2026-11-03 16:53 UTC from Plomba's sealed records.

| Container | Type | Chain | Open | Repaired | Last handover |
|---|---|---|---|---|---|
| PLBU 400006 4 | 45G1 | none | 0 | 0 | Łódź inland terminal, 2026-10-28 08:00 UTC, gate in, by road, truck EL 4K217 (open) |
| PLBU 400005 9 | 22G1 | verified | 0 | 0 | Łódź inland terminal, 2026-10-28 08:00 UTC, gate in, by road, truck LD 5520C |
| PLBU 400004 3 | 42G1 | verified | 4 | 1 | Łódź inland terminal, 2026-10-28 08:00 UTC, gate out, by rail, wagon 33 51 4556 012-4 |

## PLBU 400004 3

| Location | Damage | Status | First recorded |
|---|---|---|---|
| RX5N | Dent (DT), right side | open, seen again since | Łódź inland terminal, 2026-10-28 08:00 UTC |
| DX2N | Bent (BT), door end | open | Łódź inland terminal, 2026-10-28 08:00 UTC |
| RX5N | Dent (DT), right side | open | Łódź inland terminal, 2026-10-28 08:00 UTC |
| TX56 | Holed (HO), roof | open | Łódź inland terminal, 2026-10-28 08:00 UTC |
| LB89 | Corroded (CO), left side | repaired | Gdynia container terminal, 2026-10-28 08:00 UTC |

http://127.0.0.1:8787/containers/PLBU4000043
```

The off-hire statement for the lease from Gdynia to the train:

```markdown
# Off-hire statement: PLBU 400004 3

|  | Handover | Record (SHA-256) |
|---|---|---|
| On-hire | Gdynia container terminal, 2026-10-28 08:00 UTC (#1), gate out, by road, truck EL 4K217 | `a2ce6b5fe6ce21a832f840c4ede9117b1dd7d2c6e594d6792e2fc70ec0f8c1f9` |
| Off-hire | Łódź inland terminal, 2026-10-28 08:00 UTC (#3), gate out, by rail, wagon 33 51 4556 012-4 | `ce2ab2183dfaeb8e256f8b3e522e65353922f8ed24384a957fc5d98763812386` |

The container's hash chain verified (3 sealed records). Numbers after a place are positions in the chain.

## Chargeable to the lessee (2)

| Location | Damage | Last clean | First recorded | Record hashes |
|---|---|---|---|---|
| RX5N | Dent (DT), right side | Gdynia container terminal, 2026-10-28 08:00 UTC (#1) | Łódź inland terminal, 2026-10-28 08:00 UTC (#2) | `a2ce6b5fe6ce…`, `09bda6590a99…` |
| DX2N | Bent (BT), door end | Łódź inland terminal, 2026-10-28 08:00 UTC (#2) | Łódź inland terminal, 2026-10-28 08:00 UTC (#3) | `09bda6590a99…`, `ce2ab2183dfa…` |

## For review, not charged yet (2)

| Location | Damage | Last clean | First recorded | Record hashes | Why |
|---|---|---|---|---|---|
| RX5N | Dent (DT), right side | — | Łódź inland terminal, 2026-10-28 08:00 UTC (#3) | `ce2ab2183dfa…` | damage was already recorded on this spot at Łódź inland terminal, 2026-10-28 08:00 UTC; it may be the same damage |
| TX56 | Holed (HO), roof | — | Łódź inland terminal, 2026-10-28 08:00 UTC (#3) | `ce2ab2183dfa…` | no handover photographed this spot clean |

## Repaired during the lease (0)

None.

## Already there at on-hire, not charged (1)

- LB89: Corroded (CO), left side, first recorded at Gdynia container terminal, 2026-10-28 08:00 UTC (#1)
```

The rust was recorded at on-hire, so the lessee isn't charged for it. Damage recorded at a handover after off-hire wouldn't appear at all.

## The code

| File | What it does |
|---|---|
| [`fleet.ts`](fleet.ts) | `conditionOf` (no I/O), `fleetReport`, and the CSV and Markdown |
| [`lease.ts`](lease.ts) | `compareLease(history, onHire, offHire)` (no I/O) and the Markdown statement |
| [`main.ts`](main.ts) | The `fleet` and `lease` commands |

## What a production version would add

- **Paging and change feeds.** The API lists at most 500 containers per owner code and has no paging, so the report warns when it hits the limit. A fleet system would page through the list, or keep its own copy current from `handover.sealed` webhooks instead of reading every history.
- **Lease records from the leasing system.** Take on-hire and off-hire from the lease contract (dates, depots) rather than handover ids typed in, and send the chargeable items to billing with repair estimates.
- **Single sign-on** for the fleet team, and scheduled reports by email.
