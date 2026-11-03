# Integration examples

Four small programs, one for each kind of company that works with a Plomba installation. Each one uses only what any other system gets: the API with an API token, signed webhooks, and the links to the EIR and the CODECO message. [docs/integrations.md](../docs/integrations.md) describes all three.

| Example | For | The problem it solves | Uses |
|---|---|---|---|
| [`shipping-line-claims-desk`](shipping-line-claims-desk) | Shipping lines, shipowners | A dent found at an inland terminal turns into weeks of emails about who had the container when it happened. The desk opens the claim as soon as the handover is sealed, addressed to whoever had the container on that leg, with both sealed records as evidence. | `handover.sealed` webhooks, the container's history, EIR and CODECO links |
| [`rail-operator-train-arrival`](rail-operator-train-arrival) | Intermodal and rail operators | A block train brings 30 to 80 containers at once, and checkers retype numbers from the wagon list, where a wrong digit becomes a handover of the wrong container. The wagon list is checked digit by digit and becomes open gate-in handovers before the train arrives. | `POST /containers`, `POST /handovers` with UIC wagon numbers |
| [`trucking-driver-receipt`](trucking-driver-receipt) | Trucking companies | A driver leaves the gate with nothing in hand, and a week later the haulier is billed for a dent. The receipt shows what the terminal recorded at that gate, and the hash that proves the record hasn't changed since. | `GET /handovers`, the container's history, EIR and CODECO links |
| [`leasing-fleet-condition`](leasing-fleet-condition) | Container owners and lessors | A lessor recharges damage at off-hire, and the lessee asks for proof that it wasn't there at on-hire. The fleet report shows each container's condition from the sealed records, and the off-hire statement lists only the damage that appeared during the lease, with its evidence. | `GET /containers?owner=`, the container's history |

All the data in these examples is invented: the PLBU owner code, the container and wagon numbers (valid check digits, made up), the companies, places and trucks.

## How they're built

- **Plain TypeScript, no build step.** Node 24 runs each `main.ts` directly (`node examples/<name>/main.ts …`) by stripping the types, so the code avoids what can't be stripped (enums, namespaces, parameter properties).
- **The contracts are the client.** [`shared/client.ts`](shared/client.ts) is a small API client: the installation's address, `Authorization: Bearer <token>`, and RFC 9457 problem details thrown as `PlombaApiError` with the HTTP status. Every answer is parsed with the zod schemas from `@plomba/contracts`, the same ones the server validates with, so a client and a server that disagree fail loudly at the call. `@plomba/core` provides the domain checks: ISO 6346 and UIC check digits, CEDEX codes, size and type codes.
- **Logic apart from the command line.** Each example's decisions are plain functions that tests call directly (`buildClaims`, `planTrain`, `buildReceipt`, `compareLease`). `main.ts` only reads options (`parseArgs` from `node:util`) and the environment, and prints.
- **Tested against a real server.** The tests in [`test/`](test) run every example against the Plomba HTTP API built from the server's own `createTestApp`: real routes, validation, access control, hash chain and damage passport, over an in-memory database and fake models. Webhooks are delivered by the server's own `WebhookNotifier`, so the claims desk is tested on real signed deliveries.

## Running them against your Plomba

Any installation works, including `npm run dev:server` on your machine (see [docs/self-hosting.md](../docs/self-hosting.md)).

1. **Give the examples an API token, and a webhook secret for the claims desk.** Keep both in files outside the repository:

   ```sh
   mkdir -p ~/.config/plomba
   printf 'examples %s\n' "$(openssl rand -hex 24)" > ~/.config/plomba/api-tokens
   openssl rand -hex 24 > ~/.config/plomba/webhook-secret
   ```

2. **Tell the server about them**, in its `.env`. API tokens apply when the installation asks for an access code:

   ```sh
   PLOMBA_ACCESS_CODE=a-long-code-for-the-people-who-use-the-app
   PLOMBA_API_TOKENS_FILE=/home/you/.config/plomba/api-tokens   # full paths: .env doesn't expand ~
   PLOMBA_WEBHOOK_URLS=http://localhost:8790/plomba     # the claims desk
   PLOMBA_WEBHOOK_SECRET_FILE=/home/you/.config/plomba/webhook-secret
   PLOMBA_PUBLIC_URL=http://localhost:8787               # for the links in webhooks
   ```

   Restart the server after changing them.

3. **Tell the examples where Plomba is**, in the shell you run them from:

   ```sh
   export PLOMBA_URL=http://localhost:8787
   export PLOMBA_API_TOKEN="$(awk '$1 == "examples" { print $2 }' ~/.config/plomba/api-tokens)"
   export PLOMBA_WEBHOOK_SECRET="$(cat ~/.config/plomba/webhook-secret)"   # claims desk only
   ```

Then follow each example's README.

## Without a Meta key: the sandbox

The sandbox is the same Plomba API the tests use: fake models, an in-memory database, nothing kept. It starts with one container's journey recorded through the API ([`sandbox/journey.ts`](sandbox/journey.ts)): three handovers of PLBU 400004 3 from Gdynia to Łódź and onto a train, with a dent on the road leg, a bent locking bar inside the terminal, a dent recorded twice and a hole in a roof nobody photographed.

```sh
node examples/sandbox/main.ts      # --port to move it off 8787, --empty to start with no data
```

It prints the `PLOMBA_URL` and `PLOMBA_API_TOKEN` to export, and the ids of the handovers it recorded. To see the claims desk receive the journey's webhooks, choose the token and secret first, start the desk, then give the sandbox the webhook settings a real server takes:

```sh
export PLOMBA_URL=http://127.0.0.1:8787
export PLOMBA_API_TOKEN="$(openssl rand -hex 24)"
export PLOMBA_WEBHOOK_SECRET="$(openssl rand -hex 24)"
node examples/shipping-line-claims-desk/main.ts --out /tmp/claims-desk &
PLOMBA_WEBHOOK_URLS=http://127.0.0.1:8790/plomba node examples/sandbox/main.ts
```

```text
Plomba sandbox on http://127.0.0.1:8787 (fake models, in-memory database)

  export PLOMBA_URL=http://127.0.0.1:8787
  export PLOMBA_API_TOKEN=3b1f…(the token you chose, or a generated one)

Webhooks go to http://127.0.0.1:8790/plomba

Recorded (invented data):
  00000000-0000-4000-8000-000000000001  PLBU4000043  Gdynia container terminal, gate out, by road, truck EL 4K217  sealed #1
  00000000-0000-4000-8000-000000000007  PLBU4000043  Łódź inland terminal, gate in, by road, truck EL 4K217  sealed #2
  00000000-0000-4000-8000-000000000014  PLBU4000043  Łódź inland terminal, gate out, by rail, wagon 33 51 4556 012-4  sealed #3
  00000000-0000-4000-8000-000000000023  PLBU4000059  Łódź inland terminal, gate in, by road, truck LD 5520C  sealed #1
  00000000-0000-4000-8000-000000000024  PLBU4000064  Łódź inland terminal, gate in, by road, truck EL 4K217  open

Times are the sandbox's clock: 2026-10-28 08:00 UTC on.
```

The sample output in each example's README comes from the sandbox. Its clock starts at 2026-10-28 08:00 UTC and moves a second per step, so every handover shows the same minute.

## Tests

```sh
npx vitest run --project examples    # these tests only
npm run check                        # lint, type checks and every test in the repository
```

The tests cover, for each example, the decisions on their own and the whole run against the server, including the command line as `node` runs it.
