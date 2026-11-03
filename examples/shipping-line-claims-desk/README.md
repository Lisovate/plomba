# Shipping line claims desk

**For:** a shipping line's or shipowner's claims desk (equipment control, damage and repair).

**The pain:** a container leaves the port clean and turns up at an inland terminal with a dent. The line pays for the repair, and recovering the cost means proving which leg it happened on: the truck, the train, the terminal. Without records from both ends, the claim turns into weeks of emails, photos with no dates, and a write-off. Liability moves with every handover, so the claim has to name the right leg and the party who had the container on it.

**What it does:** it receives Plomba's `handover.sealed` webhook. For each damage the handover recorded first, on a spot an earlier handover photographed clean, it opens a claim file: JSON for the claims system and a short Markdown letter to whoever had the container in between. Each claim holds:
- the container and the CEDEX codes (location, damage, component);
- both handovers, with place, time and transport leg;
- both sealed records' SHA-256 hashes;
- the links to both EIRs and CODECO messages.

What the records can't settle alone is filed for a person to review, not claimed.

## The flow

1. A checker seals a handover in Plomba. Plomba POSTs `handover.sealed` to the desk.
2. The desk reads the raw body (up to 1 MB) and checks `Plomba-Signature` on those exact bytes: HMAC-SHA256 with the webhook secret, compared in constant time. A signature more than 5 minutes old is refused, so a captured delivery can't be replayed later (401).
3. It parses the body with `WebhookEventSchema` from `@plomba/contracts` (400 if it isn't an event). `Plomba-Delivery` must be the id in the signed body, since the header itself isn't signed.
4. A delivery id it has already seen is answered 200 and skipped. Plomba retries the same id after 1, 10 and 60 seconds when it doesn't get a 2xx, so retries never open a claim twice.
5. It answers **202 at once** and processes the event in the background, one event at a time. Plomba's timeout never depends on the API or the disk.
6. It reads the container's history from the API (`GET /api/containers/{number}`). The webhook names the earlier handovers by id only; the history gives their place, time, leg and hash, and says whether the hash chain verifies.
7. For each damage in `data.damage`, `buildClaims` decides:

   | The records say | The desk |
   |---|---|
   | First recorded at this handover, and `lastClear` names an earlier handover that photographed the spot clean | **opens a claim** against whoever received the container at `lastClear` and handed it over here (and both parties of any handover in between) |
   | `recordedNearbyAt`: an earlier handover recorded damage on the same spot, not linked to this one | files it **for review**: it may be the same damage recorded again |
   | `notInspectedAt` but no `lastClear`: no earlier handover photographed the spot | files it **for review**: nothing shows the spot clean |
   | Known damage marked `changed` at this handover | files it **for review**: it may have got worse on the last leg |
   | The container's hash chain doesn't verify | files every new damage **for review**: the records can't support a claim |
   | Known damage seen again, or damage on the container's first sealed record | skips it |

8. It writes `claims/<container>-<damage id>.json` and `.md`, or the same under `review/`. File names come from the damage, so processing an event again rewrites the same files.
9. If processing fails (the API is down, say), the event is saved under `failed/`. Replay it with `--replay` once the cause is fixed.

## Running it

Set up the token and the webhook secret as in [the examples README](../README.md#running-them-against-your-plomba), with `PLOMBA_WEBHOOK_URLS=http://localhost:8790/plomba` on the server. Then:

```sh
export PLOMBA_URL=http://localhost:8787
export PLOMBA_API_TOKEN=…          # one of the server's API tokens
export PLOMBA_WEBHOOK_SECRET=…     # the server's webhook secret
node examples/shipping-line-claims-desk/main.ts --out /tmp/claims-desk
```

Options: `--port 8790`, `--host 127.0.0.1`, `--tolerance 300` (seconds a signature may be old), `--out ./claims-desk`. To replay saved events:

```sh
node examples/shipping-line-claims-desk/main.ts --replay --out /tmp/claims-desk /tmp/claims-desk/failed/*.json
```

With the [sandbox](../README.md#without-a-meta-key-the-sandbox) sending its webhooks here, the desk logs:

```text
Claims desk listening on http://127.0.0.1:8790/
Claim files go to /tmp/claims-desk
PLBU4000043 at Gdynia container terminal (handover 00000000-0000-4000-8000-000000000001): 0 claim(s), 0 for review, 1 skipped
PLBU4000043 at Łódź inland terminal (handover 00000000-0000-4000-8000-000000000007): 1 claim(s), 0 for review, 1 skipped
  claims/PLBU4000043-00000000-0000-4000-8000-000000000013.json
  claims/PLBU4000043-00000000-0000-4000-8000-000000000013.md
PLBU4000043 at Łódź inland terminal (handover 00000000-0000-4000-8000-000000000014): 1 claim(s), 2 for review, 2 skipped
  claims/PLBU4000043-00000000-0000-4000-8000-000000000020.json
  claims/PLBU4000043-00000000-0000-4000-8000-000000000020.md
  review/PLBU4000043-00000000-0000-4000-8000-000000000021.json
  review/PLBU4000043-00000000-0000-4000-8000-000000000021.md
  review/PLBU4000043-00000000-0000-4000-8000-000000000022.json
  review/PLBU4000043-00000000-0000-4000-8000-000000000022.md
PLBU4000059 at Łódź inland terminal (handover 00000000-0000-4000-8000-000000000023): 0 claim(s), 0 for review, 0 skipped
```

The first claim, for the dent on the road leg (`claims/…013.md`):

```markdown
# Claim: damage to PLBU 400004 3 at RX5N

|  |  |
|---|---|
| Claim | PLBU4000043-00000000-0000-4000-8000-000000000013 |
| Opened | 2026-11-03 16:52 UTC |
| To | Kociewie Trans |
| Container | PLBU 400004 3, 42G1 |
| Damage | Dent (DT), Panel (PAA), right side, at RX5N |

At Gdynia container terminal on 2026-10-28 08:00 UTC (gate out, by road, truck EL 4K217), the handover's sealed record has location RX5N photographed, with no damage there.

At Łódź inland terminal on 2026-10-28 08:00 UTC (gate in, by road, truck EL 4K217), the sealed record shows new damage at RX5N: Dent (DT), Panel (PAA), right side. The checker noted: “Dent about 30 cm across”.

The damage therefore happened between these two handovers, while the container was in the custody of Kociewie Trans. We hold you liable for it and ask you to acknowledge this claim.

## Evidence

|  | Last clean | First recorded |
|---|---|---|
| Place | Gdynia container terminal | Łódź inland terminal |
| Time | 2026-10-28 08:00 UTC | 2026-10-28 08:00 UTC |
| Leg | gate out, by road, truck EL 4K217 | gate in, by road, truck EL 4K217 |
| Handed over by → received by | Gdynia container terminal → Kociewie Trans | Kociewie Trans → Łódź inland terminal |
| Checker | K. Wiśniewska | A. Nowak |
| Sealed record (SHA-256) | `a2ce6b5fe6ce21a832f840c4ede9117b1dd7d2c6e594d6792e2fc70ec0f8c1f9` | `09bda6590a9962c5797114b516c9ac653a977788e76f41321ed33fe8800bd7f4` |
| Position in the chain | 1 | 2 |
| EIR | http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000001/report | http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000007/report |
| CODECO | http://127.0.0.1:8787/api/handovers/00000000-0000-4000-8000-000000000001/codeco | http://127.0.0.1:8787/api/handovers/00000000-0000-4000-8000-000000000007/codeco |

Both records are links of the container's SHA-256 hash chain, which verified (2 sealed records) when this claim was opened. Changing either record would change its hash and break the chain. The container's history: http://127.0.0.1:8787/containers/PLBU4000043
```

The second claim is for the locking bar, clean at the Łódź gate in and bent at the gate out, so it goes to the terminal itself. The two reviews are a dent recorded on top of the earlier one without being linked to it, and a hole in a roof that no handover photographed.

## The code

| File | What it does |
|---|---|
| [`signature.ts`](signature.ts) | `verifySignature`: the MAC on the raw bytes, the replay window, several `v1` values for secret rotation |
| [`claims.ts`](claims.ts) | `buildClaims(event, history)`: claim, review or skip for each damage, with the evidence. No I/O |
| [`letters.ts`](letters.ts) | The Markdown claim letter and review note |
| [`receiver.ts`](receiver.ts) | The `node:http` handler: body limit, signature, schema, duplicates, the background queue, the files |
| [`main.ts`](main.ts) | The command line |

## What a production version would add

- **A durable queue and store.** Deliveries and the seen delivery ids live in memory here; a restart forgets which ids were seen (file names keep claims from doubling). Production would put events on a queue with retries, and keep claims in the claims system's database.
- **Claims-system integration.** Create the claim through the claims system's API instead of writing files, attach the EIR as a PDF, and route it to the handler for the leg.
- **The secret in a secrets manager**, rotated by signing with both secrets for a while (the check already accepts two `v1` values).
- **Deployment behind HTTPS**, with monitoring of refused and failed deliveries.
