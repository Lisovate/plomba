# Integrations

How other systems work with Plomba: a shipping line's claims desk, a rail operator's or terminal's operating system, a trucking company's dispatch, a container owner's fleet system. Runnable examples for each are in [`examples/`](../examples).

## What other systems get

| Need | How |
|---|---|
| Know when a handover is sealed, with its damage and evidence | **Webhooks**: signed `handover.sealed` and `handover.started` events |
| Read a container's history and damage passport | `GET /api/containers/{number}` |
| Follow a fleet (an owner code) | `GET /api/containers?owner=PLBU` |
| Find handovers by truck, wagon, container, status, direction or place | `GET /api/handovers?vehicle=EL4K217&status=closed` |
| Attach and watch walk-around evidence | `POST /api/handovers/{id}/videos` (multipart `video`, optional `views` JSON, 150 MB); clips in `GET /api/handovers/{id}`, cached overlays at `GET /api/handovers/{id}/videos/{videoId}/tracking` |
| Prepare handovers before the train or truck arrives | `POST /api/containers`, `POST /api/handovers` |
| Send the gate event to systems that speak EDIFACT | `GET /api/handovers/{id}/codeco` (CODECO D.95B, SMDG 1.6) |
| Give the other party the receipt | The EIR at `/handovers/{id}/report` (print or save as PDF) |

The full description is OpenAPI 3.1, generated from the same schemas the server validates with: **`GET /api/openapi.json`** on any installation (public, no token needed). The two webhooks are described there too.

## Authentication

- **People** sign in with the installation's access code and get a session cookie, or reach it through the company's single sign-on.
- **Other systems** send an API token: `Authorization: Bearer <token>`. Tokens live in a file outside the repository, one per line, a name and a token of at least 24 characters:

  ```text
  # PLOMBA_API_TOKENS_FILE=/run/secrets/plomba_api_tokens
  claims-desk  3f1c9a…(at least 24 characters)
  rail-tos     b7e0d2…
  ```

  Give each system its own token, so one can be revoked without the others. Tokens are compared in constant time.

  Tokens apply when the installation asks for an access code (`PLOMBA_ACCESS_CODE`). Without one, the API is open to anyone who can reach it, so keep such an installation on a private network.

## Search and paging

`GET /api/handovers` accepts these optional filters together:

- `vehicle`: the truck plate or wagon number. Spaces, hyphens and case do not matter.
- `container`: an ISO 6346 container number. The API normalises it and checks its check digit.
- `status`: `open` or `closed`.
- `direction`: `in` or `out`.
- `place`: the exact place name, including case.

Set `limit` to a page size from 1 to 100 (default 30). Searches return handovers by `startedAt`, newest first, with `id` breaking ties. A request with no query parameters keeps the existing open-first order and returns up to 30 handovers.

The body is always a JSON array. When more matches exist, the response has a `Link` header (RFC 8288):

```http
Link: </api/handovers?vehicle=EL4K217&status=closed&limit=30&cursor=...>; rel="next"
```

Follow that URL to get the next page. It keeps the filters and page size. Treat the cursor as opaque. The last page has no next link. Invalid filters, limits and cursors return a 400 problem response.

The cursor keeps the page's position by start time and ID. Handovers added ahead of that position do not shift later pages or cause repeats. Cursors from a bare request keep its open-first order. This is not a snapshot: a handover can still be closed between requests.

The [examples client](../examples/shared/client.ts) provides `searchHandovers(filters)`, which returns `{ handovers, nextCursor }`, and `allHandovers(filters)`, an async iterator over every matching page. Pass `nextCursor` as `cursor` to resume a search.

## Webhooks

Set where events go and the secret they're signed with:

```sh
PLOMBA_WEBHOOK_URLS=https://claims.example.com/plomba,https://tos.example.com/hooks/plomba
PLOMBA_WEBHOOK_SECRET_FILE=/run/secrets/plomba_webhook_secret   # 16+ characters
PLOMBA_PUBLIC_URL=https://plomba.example.com                    # for links in the events
```

**Events**
- `handover.started`: a handover was opened.
- `handover.sealed`: a handover was sealed into the container's hash chain.

**Delivery**
- Each event is a JSON `POST` with these headers:
  - `Plomba-Event`: the event type;
  - `Plomba-Delivery`: the event id, the same on every retry;
  - `Plomba-Signature`.
- Any 2xx response means received. Anything else is retried after 1 s, 10 s and 60 s, then logged as given up.
- Delivery never delays or fails the checker's work.

**Payload** (`WebhookEvent` in the OpenAPI description):

```json
{
  "id": "6f0a…",
  "type": "handover.sealed",
  "occurredAt": "2026-11-03T14:05:11.000Z",
  "data": {
    "handover": { "id": "…", "containerNumber": "PLBU4000043", "direction": "out", "place": "Łódź inland terminal", "transportMode": "road", "vehicleId": "EL 4K217", "status": "closed", "seal": { "sequence": 1, "hash": "3c6f…", "previousHash": "…" }, "…": "…" },
    "container": { "number": "PLBU4000043", "sizeTypeCode": "42G1", "…": "…" },
    "marks": [{ "locationCode": "LX50", "damageCode": "CO", "status": "still-there", "…": "…" }],
    "damage": [{ "locationCode": "LB4N", "damageCode": "DT", "firstRecorded": "<this handover>", "lastClear": "<the previous handover>", "notInspectedAt": [], "recordedNearbyAt": null, "…": "…" }],
    "links": {
      "app": "https://plomba.example.com/handovers/…",
      "receipt": "https://plomba.example.com/handovers/…/report",
      "codeco": "https://plomba.example.com/api/handovers/…/codeco",
      "container": "https://plomba.example.com/containers/PLBU4000043"
    }
  }
}
```

`damage` is what a claims desk needs. For each damage this handover recorded, it gives where it was first recorded and the last earlier handover whose photos showed that spot clean. If `firstRecorded` is this handover and `lastClear` is set, the damage happened between the two.

**Checking the signature.** `Plomba-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256, keyed with your secret, of `"<t>.<raw body>"`. Refuse old timestamps, so a captured delivery can't be replayed:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret: string, header: string, rawBody: string, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2)));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const sent = String(parts.v1 ?? '');
  return sent.length === expected.length && timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
}
```

Verify against the raw body, before parsing it. Use `Plomba-Delivery` to skip duplicates.

## EDIFACT CODECO

`GET /api/handovers/{id}/codeco?recipient=<EDI ID>` returns the gate-in or gate-out message of a sealed handover, as EDIFACT CODECO D.95B in the SMDG 1.6 layout:
- BGM 34 for gate-in, 36 for gate-out;
- EQD, DTM and LOC;
- SEL for the seals;
- TDT for the rail or road leg;
- DAM/COD for up to nine damages;
- an FTX carrying the sealed record's SHA-256.

The sender is the installation's `EDI_SENDER_ID`.

## Examples

| Example | Who | What it shows |
|---|---|---|
| [`shipping-line-claims-desk`](../examples/shipping-line-claims-desk) | Shipping lines, shipowners | Receives `handover.sealed`, checks the signature, and opens a claim file for damage that appeared between two handovers |
| [`rail-operator-train-arrival`](../examples/rail-operator-train-arrival) | Intermodal and rail operators | Turns a train's wagon list into gate-in handovers before the train arrives, with UIC wagon numbers |
| [`trucking-driver-receipt`](../examples/trucking-driver-receipt) | Trucking companies | Finds the sealed handover for a truck and gives the driver the receipt and its hash |
| [`leasing-fleet-condition`](../examples/leasing-fleet-condition) | Container owners and lessors | A fleet condition report by owner code, and the damage that appeared during a lease (on-hire to off-hire) |
