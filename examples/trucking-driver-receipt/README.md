# Trucking company: the driver's receipt

**For:** trucking companies and their dispatchers, and the drivers at the terminal gate.

**The pain:** the driver hands the container over at the gate, or picks one up, and drives off with nothing in hand. A week later the haulier is billed for a dent "found at the gate". Without the terminal's own record from that moment, it's the driver's word against the terminal's, and the haulier usually pays. Gate disputes are about what was recorded, where and when, and whether the record has been changed since.

**What it does:** given the truck's registration (and optionally the container), it finds the truck's latest sealed handover through the API and makes the driver's receipt:
- the container, gate in or gate out, the place and time, who handed it over to whom;
- the damage the terminal recorded, with CEDEX codes and descriptions, and whether each item was new at this gate or already on record;
- the sealed record's SHA-256 hash, checked against the container's hash chain when the receipt is made, and how anyone can check it later;
- links to the EIR and the CODECO gate message.

It prints the receipt, or writes it as an HTML page to print, save as PDF or send to the driver's phone.

## The flow

1. Find the handover (`findLatestSealed`) with `GET /api/handovers?vehicle=<truck>&status=closed`. The API compares registrations without spaces, hyphens or case. `--container` adds a container filter; it is optional even for older handovers.

   Follow every next-page `Link` through the client's `allHandovers` async iterator. Keep road handovers and take the most recently sealed one. The search is ordered by start time, so the latest seal may be on a later page. Open handovers don't count: their record can still change.
2. Read the handover with its marks (`GET /api/handovers/{id}`) and the container's history.
3. Build the receipt (`buildReceipt`): confirmed marks become the damage list. The record counts as verified only if the container's chain verifies and holds this hash at this position.
4. Print it as text, or as HTML with `--html`. The exit code is 1 if no handover was found or the record didn't verify.

## Running it

With `PLOMBA_URL` and `PLOMBA_API_TOKEN` set as in [the examples README](../README.md#running-them-against-your-plomba):

```sh
node examples/trucking-driver-receipt/main.ts --truck "EL 4K217"
node examples/trucking-driver-receipt/main.ts --truck EL4K217 --container PLBU4000043 --html receipt.html
```

Against the [sandbox](../README.md#without-a-meta-key-the-sandbox), the truck EL 4K217 took PLBU 400004 3 out of Gdynia and brought it into Łódź, and is waiting at the Łódź gate with another container. The receipt is for the latest sealed handover, the gate in at Łódź:

```text
GATE IN RECEIPT  PLBU 400004 3 (42G1)
=====================================
Place:        Łódź inland terminal
Time:         2026-10-28 08:00 UTC (sealed 2026-10-28 08:00 UTC)
Leg:          gate in, by road, truck EL 4K217
Handed over:  Kociewie Trans → Łódź inland terminal
Checker:      A. Nowak
Seals:        PL 0412377

Damage recorded (2):
  LB89  Corroded (CO), Panel (PAA), left side: already recorded
  RX5N  Dent (DT), Panel (PAA), right side: new
        “Dent about 30 cm across”

Sealed record, handover 2 of 3 in the container's chain:
  SHA-256   09bda6590a9962c5797114b516c9ac653a977788e76f41321ed33fe8800bd7f4
  previous  a2ce6b5fe6ce21a832f840c4ede9117b1dd7d2c6e594d6792e2fc70ec0f8c1f9
  Checked when this receipt was made: the chain verifies and holds this hash.

To check it later:
  Open the container's history (http://127.0.0.1:8787/containers/PLBU4000043), or ask the API for GET /api/containers/PLBU4000043:
  the chain must be shown as verified, and handover 2 must carry this hash.
  Any change to the record after sealing would change its hash and break the chain.
  The same hash, in capitals, is in the CODECO gate message (FTX segment) sent to the line.

EIR:     http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000007/report
CODECO:  http://127.0.0.1:8787/api/handovers/00000000-0000-4000-8000-000000000007/codeco
```

The dent is "new" here: the terminal recorded it at this gate. With the Gdynia record showing the spot clean, that puts it on the road leg; the [claims desk](../shipping-line-claims-desk) would open a claim to the haulier. The rust was already on record, so it isn't the haulier's.

## The code

| File | What it does |
|---|---|
| [`receipt.ts`](receipt.ts) | `findLatestSealed`, `buildReceipt` (no I/O), `driverReceipt`, and the text and HTML renderings |
| [`main.ts`](main.ts) | The command line |

## What a production version would add

- **Delivery to the driver**: the HTML as a PDF by SMS or in the haulier's driver app, the moment the handover is sealed.
- **The dispatcher's sign-on** to the haulier's own portal, and one Plomba API token per haulier.
- **Independent verification.** The receipt trusts the server's chain check. Recomputing the hash outside Plomba would need the sealed record itself, which the API doesn't expose.
