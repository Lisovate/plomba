# Rail operator: train arrival

**For:** intermodal and rail operators, and the inland terminals that receive their trains.

**The pain:** a block train brings 30 to 80 containers at once, on wagons of two or three each. Checkers walk it with a printed wagon list and retype each container number into the gate system. A wrong digit becomes a handover of the wrong container, and nobody notices until the damage claim names a box that was never on the train. The train is also a handover: damage found at the gate in is the railway's, and only if it was recorded before the containers left the wagons.

**What it does:** it reads the train's wagon list, checks every container number (ISO 6346 check digit) and wagon number (UIC check digit) before anything is sent, and opens a gate-in handover for each container, ready for the checker: by rail, with the wagon's UIC number, the seals, the place and the checker. Then it prints the checker's list, wagon by wagon, with a link to each handover.

## The flow

1. Read the wagon list: CSV with the columns `wagon`, `container`, `size_type` and `seals`, in any order (seals separated by semicolons). Spaces in numbers are fine: `33 51 4556 012-4` is how wagon numbers are painted.
2. Check every row (`planTrain`, using `parseContainerNumber`, `parseWagonNumber` and `parseSizeType` from `@plomba/core`):
   - the container number's ISO 6346 check digit, owner code, category and serial;
   - the wagon number's UIC check digit;
   - the size/type code, when given;
   - at most 10 seals of at most 40 characters;
   - each container only once on the train.

   A row with any problem is refused whole, with its line and the fix ("it should end in 2"). The good rows go ahead.
3. For each good row:
   1. register the container (`POST /api/containers`), which is harmless if it is registered already;
   2. open its gate-in handover (`POST /api/handovers`), by rail, with the wagon as `vehicleId`, the seals, the place, the checker, and who hands it over (`--from`).
4. A container that already has an open handover gets a 409 from Plomba. It is reported with the open handover and its checker, so running the list twice does no harm. Any other refusal is reported for that row and the rest go ahead. A refused token or an unreachable server stops the run.
5. Print the checker's list. The exit code is 1 when any row was refused or failed, so a script can tell.

## Running it

With `PLOMBA_URL` and `PLOMBA_API_TOKEN` set as in [the examples README](../README.md#running-them-against-your-plomba):

```sh
node examples/rail-operator-train-arrival/main.ts \
  --wagons examples/rail-operator-train-arrival/sample-train.csv \
  --place "Łódź inland terminal" --checker "A. Nowak" \
  --train "TR 41021" --from "Vistula Rail"
```

`--dry-run` checks the list and prints it without opening anything. The sample wagon list is invented: PLBU is a made-up owner code, and the container and wagon numbers were made up and given valid check digits.

```text
Train TR 41021 at Łódź inland terminal: 8 container(s) on 4 wagon(s)

 1. Wagon 33 51 4556 012-4  PLBU 400007 0 (45G1)  seals PL 0412380
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000025
 2. Wagon 33 51 4556 012-4  PLBU 400008 5 (22G1)  seals PL 0412381
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000026
 3. Wagon 33 51 4556 013-2  PLBU 400009 0 (42G1)  seals PL 0412382, PL 0412383
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000027
 4. Wagon 33 51 4556 013-2  PLBU 400010 4 (22G1)  no seals listed
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000028
 5. Wagon 33 51 4556 014-0  PLBU 400011 0 (45G1)  seals PL 0412384
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000029
 6. Wagon 33 51 4556 015-7  PLBU 400012 5 (22G1)  seals PL 0412385
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000030
 7. Wagon 33 51 4556 015-7  PLBU 400013 0 (22G1)  seals PL 0412386
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000031
 8. Wagon 33 51 4556 015-7  PLBU 400014 6 (22G1)  seals PL 0412387
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000032
```

Run again, the same list reports what is already open:

```text
 1. Wagon 33 51 4556 012-4  PLBU 400007 0 (45G1)  seals PL 0412380
    already open (Łódź inland terminal, A. Nowak): http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000025
```

A list with mistakes ([`sample-train-with-errors.csv`](sample-train-with-errors.csv)) opens the good row and says what to fix in the others:

```text
Train at Łódź inland terminal: 1 container(s) on 1 wagon(s), 4 row(s) refused

 1. Wagon 33 51 4556 016-5  PLBU 400015 1 (22G1)  seals PL 0412390
    opened: http://127.0.0.1:8787/handovers/00000000-0000-4000-8000-000000000041

Refused (correct the wagon list and run it again):
  line 3: wagon number 33 51 4556 016-4 fails the UIC check digit: it should end in 5
  line 4: container number PLBU4000173 fails the ISO 6346 check digit: it should end in 2, not 3
  line 5: container PLBU4000151 is already on line 2; "XX99" is not an ISO 6346 size/type code (e.g. 22G1, 45G1)
  line 6: wagon number 3351455 must have 12 digits
```

## The code

| File | What it does |
|---|---|
| [`train.ts`](train.ts) | `parseWagonList`, `planTrain` (the checks, no I/O), `openArrivals` (the API calls) and `checkerList` |
| [`main.ts`](main.ts) | The command line |
| [`sample-train.csv`](sample-train.csv), [`sample-train-with-errors.csv`](sample-train-with-errors.csv) | Invented wagon lists |

## What a production version would add

- **The wagon list from the source.** Read the railway's train composition message or the operator's TOS export instead of a CSV, triggered when the train is announced.
- **A train reference on each handover**, so the terminal can close the train as one visit. Plomba has no field for it yet; the train number only heads the list.
- **Parallel requests with a limit** for long trains, and retries for transient failures.
- **Single sign-on** for the people who run it, and one API token per terminal.
