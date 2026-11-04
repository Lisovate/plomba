# Self-hosting

Plomba is one container: the API server, which also serves the web app. It keeps its data in one directory: a SQLite database, photos and redacted videos.

## What you need

- A Linux machine with Docker (or Node.js 24+).
- A Meta Model API key from https://dev.meta.ai.
- A domain name and HTTPS. **Phones only allow the camera on HTTPS pages.**

When running without Docker, install **ffmpeg and ffprobe** on the server's `PATH` for video evidence (Debian/Ubuntu: `sudo apt-get install ffmpeg`). The Docker image includes them. The server checks once at startup; without them it still handles photos and video analysis, but refuses to keep clips with a 503 response and hides that option in the app. Restart after installing them. Kept clips have people and number plates blurred and audio removed before storage.

## Run with Docker Compose

1. Save the key in a file readable only by you, outside any repository:

   ```sh
   install -d -m 700 /etc/plomba
   printf '%s' 'LLM_…' > /etc/plomba/meta.key && chmod 600 /etc/plomba/meta.key
   ```

2. Build and start:

   ```sh
   META_API_KEY_PATH=/etc/plomba/meta.key docker compose up -d --build
   ```

   - The key is passed as a Docker secret, mounted at `/run/secrets/meta_api_key`. It never appears in the image or in the container's environment.
   - Data lives in the `plomba-data` volume, at `/data` in the container.
   - The server listens on port 8080; set `PLOMBA_PORT` to change the host port.

3. Put HTTPS in front (next section), open the site on a phone and install it: **Add to Home Screen** on iPhone, **Install app** on Android.

## HTTPS with a reverse proxy

Any TLS-terminating proxy works. With Caddy, which obtains certificates automatically, the whole configuration is:

```
plomba.example.com {
	reverse_proxy 127.0.0.1:8080
	request_body {
		max_size 25MB
	}
}
```

- The server allows uploads up to 20 MB; phones send about 0.5 MB, because the app downscales photos first.
- Plomba has no user accounts of its own yet. Either put your company's single sign-on in front of the proxy, or set `PLOMBA_ACCESS_CODE` so that each device must enter a shared code once. Without one of the two, anyone who knows the address can use the installation and its Meta Model API credit.

## Configuration

All settings are environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `META_API_KEY_FILE` | — | File holding the Meta Model API key (preferred) |
| `META_API_KEY` | — | The key itself, for platforms without secret files |
| `META_API_BASE_URL` | `https://api.meta.ai/v1` | Any endpoint serving Meta models through the Responses API |
| `META_VISION_MODEL` | `muse-spark-1.3` | Reads markings |
| `META_SEGMENTATION_MODEL` | `sam-3.1` | Finds the container, faces and number plates; outlines damage |
| `META_SPEECH_MODEL` | `muse-voice-transcribe-1.0` | Transcribes spoken notes |
| `PLOMBA_ACCESS_CODE` | — | If set (8+ characters), each device enters this code once and gets a 30-day session cookie; without it the API and photos answer 401. Leave unset behind single sign-on |
| `EDI_SENDER_ID` | `PLOMBA` | This installation's ID in EDIFACT messages (UNB sender, NAD+MS) |
| `PLOMBA_NOTICE` | — | One line shown at the foot of every screen, before and after the access code, e.g. "Demo data" or credits for the photos |
| `PLOMBA_API_TOKENS_FILE` | — | API tokens for other systems, one `<name> <token>` per line (tokens of 24+ characters); they send `Authorization: Bearer <token>`. See [integrations.md](integrations.md) |
| `PLOMBA_WEBHOOK_URLS` | — | Comma-separated endpoints that receive signed `handover.started` and `handover.sealed` events |
| `PLOMBA_WEBHOOK_SECRET_FILE` | — | The secret webhooks are signed with (16+ characters); required with `PLOMBA_WEBHOOK_URLS` |
| `PLOMBA_PUBLIC_URL` | `http://localhost:<PORT>` | This installation's address, used in links sent to other systems |
| `PLOMBA_SAMPLES_DIR` | — | A folder of sample clips and JPEG photos for trying the app (see below) |
| `META_VISION_BASE_URL` | — | A separate endpoint for reading markings and finding damage (see below) |
| `META_VISION_API_STYLE` | `responses` | `responses`, or `chat-completions` for OpenAI-compatible servers |
| `META_VISION_API_KEY_FILE` / `META_VISION_API_KEY` | — | That endpoint's own key, if it needs one |
| `META_REASONING_EFFORT` | `low` | `minimal`, `low`, `medium` or `high` |
| `META_TIMEOUT_MS` | `90000` | Per model request |
| `DATA_DIR` | `/data` in the image | Database and photos |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Where the server listens |
| `LOG_LEVEL` | `info` | Logs are JSON lines on stdout |

The server checks the configuration at startup and exits with a list of every problem.

## Running the vision model on your own hardware

Reading markings, naming faces and finding damage can run on Meta's open weights, so photos of the doors and damage don't have to leave the company. SAM 3.1 (outlines, privacy blurring) and Muse Voice Transcribe stay on the Meta Model API.

**Measured: Muse Spark Open.** The open-weights `meta-models/muse-spark-open-1026`, hosted on Baseten, runs every vision job; the results are in [evaluation.md](evaluation.md):

```sh
META_VISION_BASE_URL=https://inference.baseten.co/v1
META_VISION_API_STYLE=chat-completions
META_VISION_MODEL=meta-models/muse-spark-open-1026
META_VISION_API_KEY_FILE=/run/secrets/vision_api_key
META_VISION_MAX_IMAGES=8      # Baseten takes at most 8 images per request
```

**On your own machine** (not yet measured): any server that speaks the OpenAI-compatible Chat Completions API with image input and JSON-schema output works, for example Ollama with Muse Glimmer:

```sh
# On a Mac with 24–32 GB of memory or more
ollama pull muse-glimmer:30b-mlx
OLLAMA_HOST=0.0.0.0 ollama serve
```

Then point Plomba at it:

```sh
META_VISION_BASE_URL=http://<that machine>:11434/v1
META_VISION_API_STYLE=chat-completions
META_VISION_MODEL=muse-glimmer:30b-mlx
# META_VISION_API_KEY_FILE=…   only if the server needs a key
```

- The Meta key is never sent to `META_VISION_BASE_URL`; that endpoint gets `META_VISION_API_KEY(_FILE)` or no key at all.
- The claim agent stays on the Meta Model API.
- **Status:** the Chat Completions path is measured on Muse Spark Open (Baseten) and tested against the Meta Model API. It hasn't been run against Glimmer itself; measure it with `apps/server/scripts/eval-identify.ts` before relying on it.

## Backups

Back up the data directory:

- `plomba.db` (with `-wal` and `-shm`): use `sqlite3 plomba.db ".backup backup.db"` for a consistent copy while the server runs;
- `media/`: photos, named by their SHA-256. Files never change once written, so incremental copies (e.g. `rsync`) are enough.

## Run without Docker

```sh
npm ci
npm run build
cp .env.example .env   # then set META_API_KEY_FILE and DATA_DIR
WEB_DIST_DIR=apps/web/dist node --env-file=.env apps/server/src/main.ts
```

## Demo data

`scripts/seed-demo.ts` fills an empty data directory with what an installation looks like after a few weeks of use: the story in [`apps/server/scripts/demo/scenario.ts`](../apps/server/scripts/demo/scenario.ts), recorded through the real services. Each handover starts at its scenario time; SAM 3.1 registers and blurs every photo; Muse Spark looks for damage where the scenario asks; damage from the last handover is confirmed; and every handover not left open is sealed into its container's hash chain. The public demo's data was made this way.

```sh
cd apps/server
DATA_DIR=/tmp/plomba-demo node --env-file=../../.env scripts/seed-demo.ts --clips <folder with the clips>
```

The movements, places, people and companies in the scenario are invented; the photos are frames of openly licensed clips, credited in the scenario. It needs ffmpeg and the Meta Model API key, and it refuses a data directory that already has data.

## Development

```sh
npm ci
cp .env.example .env     # point META_API_KEY_FILE at your key
npm run dev:server       # API on http://localhost:8787
npm run dev:web          # web app on http://localhost:5173, proxying /api to the server
npm run check            # lint, type checks and tests
```

To test the camera on a phone during development, serve the web app over HTTPS on your network with a self-signed certificate: `HTTPS=1 npm run dev:web`. Then open `https://<your computer's IP>:5173` on the phone and accept the certificate warning.

## Sample clips and photos

An installation used for demonstrations or training can offer sample footage and photos. People can open **No container nearby? See it on sample footage** on the home screen, or go straight to `/try`, to see the tracked outline, face names and CEDEX grid without creating a handover. Sample door and face photos also let them try the normal handover flow.

Put MP4/MOV clips and JPG/JPEG photos in a folder with a `samples.json` that names and credits each one:

```json
[
  {
    "file": "corner.mp4",
    "title": "40 ft container seen corner-on",
    "credit": "Life, Take 2, CC BY 3.0 (people blurred)",
    "sourceUrl": "https://www.youtube.com/watch?v=CZkrwiKmvpY",
    "containerNumber": "CSQU3054383"
  },
  {
    "file": "door-markings.jpg",
    "title": "Door markings",
    "credit": "Your name, your own photo, Apache-2.0",
    "use": "doors"
  },
  {
    "file": "left-side.jpeg",
    "title": "Left side",
    "credit": "Your name, your own photo, Apache-2.0",
    "use": "L",
    "containerNumber": "CSQU3054383"
  }
]
```

- `file`: a file name in this folder, without a path. Clips end in `.mp4` or `.mov`; photos end in `.jpg` or `.jpeg` (case does not matter). Each file can appear only once. Missing files are left out; symlinks are rejected.
- `title` and `credit`: required. Credit the author and the licence. Use openly licensed material or your own footage, and label synthetic material as synthetic.
- `sourceUrl`: optional link to the source.
- `containerNumber`: optional ISO 6346 number, including its check digit, in uppercase without spaces. This links footage to the container it stands for in this installation's data; it does not register a container or change its history. On `/try`, the linked container's open damage appears as ghosts with the place and date of its first recording. An information tag follows the container, showing its size and type, owner code, last handover and chain verification. A broken chain suppresses the damage layer. Without a link, only the outline, faces and grid are shown.
- `use`: required for photos. `"doors"` offers a photo on the identify screen for reading the number. `"D"`, `"R"`, `"F"`, `"L"` or `"T"` offers it in that face's panel. To offer the same image both for reading and as the door face, give two copies different file names and roles. Clips have no `use`.

Set `PLOMBA_SAMPLES_DIR` to the folder (with Docker, mount it read-only and point the variable at the mount), then restart the server. Existing clip-only manifests work unchanged. `GET /api/samples` lists all samples with `kind` (`clip` or `photo`), `use` (null for clips) and `containerNumber` (null when omitted), as well as the title, credit, source link and download URL. JPEGs are served with `image/jpeg`. Only listed files are served, behind the installation's access code like the rest of the API.

Every offered sample shows its credit. Sample photos use the normal identification or photo upload pipeline, including registration, EXIF removal and privacy blurring. The `/try` screen does not store a handover; clips selected from a handover's walk-around screen still become face photos through the existing workflow. Tracking is cached by the clip's SHA-256, so a clip is faster after its first run. Face naming still calls Muse Spark. An unknown linked container or a failed request is shown as an error, without inventing a passport.

For local development, set `PLOMBA_SAMPLES_DIR=/absolute/path/to/samples` in the gitignored `.env`, start `npm run dev:server` and `npm run dev:web`, and open `http://localhost:5173/try`. Register the linked container and record its handovers first if you want damage and information in the preview. Supply photos with each of the six roles above to try every photo step.

Blur people and number plates before sharing samples, since the files themselves are served directly. For a clip:

```sh
node --env-file=.env apps/server/scripts/blur-clip.ts in.mp4 out.mp4
```

SAM 3.1 tracks every person and number plate through the clip, and the app's own blurring covers them frame by frame. This script uses the same ffmpeg adapter as handover video evidence and removes audio too; sample clips must be processed before putting them in the shared folder.
