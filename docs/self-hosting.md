# Self-hosting

Plomba is one container: the API server, which also serves the web app. It keeps its data in one directory: a SQLite database and the photos.

## What you need

- A Linux machine with Docker (or Node.js 24+).
- A Meta Model API key from https://dev.meta.ai.
- A domain name and HTTPS. **Phones only allow the camera on HTTPS pages.**

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
- Put your company's single sign-on in front of the proxy if Plomba must not be reachable by everyone who knows the address. Plomba has no user accounts of its own yet.

## Configuration

All settings are environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `META_API_KEY_FILE` | — | File holding the Meta Model API key (preferred) |
| `META_API_KEY` | — | The key itself, for platforms without secret files |
| `META_API_BASE_URL` | `https://api.meta.ai/v1` | Any endpoint serving Meta models through the Responses API |
| `META_VISION_MODEL` | `muse-spark-1.3` | Reads markings |
| `META_SEGMENTATION_MODEL` | `sam-3.1` | Finds the container, faces and number plates |
| `META_REASONING_EFFORT` | `low` | `minimal`, `low`, `medium` or `high` |
| `META_TIMEOUT_MS` | `90000` | Per model request |
| `DATA_DIR` | `/data` in the image | Database and photos |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Where the server listens |
| `LOG_LEVEL` | `info` | Logs are JSON lines on stdout |

The server checks the configuration at startup and exits with a list of every problem.

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

## Development

```sh
npm ci
cp .env.example .env     # point META_API_KEY_FILE at your key
npm run dev:server       # API on http://localhost:8787
npm run dev:web          # web app on http://localhost:5173, proxying /api to the server
npm run check            # lint, type checks and tests
```

To test the camera on a phone during development, serve the web app over HTTPS on your network with a self-signed certificate: `HTTPS=1 npm run dev:web`. Then open `https://<your computer's IP>:5173` on the phone and accept the certificate warning.
