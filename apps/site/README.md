# Plomba product website

The public website for Plomba: what it is, who it's for, how it integrates, the open-source and Cloud plans, and the Plomba Cloud waitlist.

- **Static pages, generated at build time** from TypeScript page modules with a shared layout. No client-side framework.
- **One small script** improves the waitlist form (sends it without leaving the page, shows errors beside the fields). Without JavaScript the form posts normally and the server answers with a page.
- **A small server** (Hono on Node 24) serves the built pages and takes `POST /api/waitlist`, storing sign-ups in SQLite.

## Pages

| Path | Page |
|---|---|
| `/` | Home: the problem, how a handover works, the app's standout moments, Meta's models and measured results, who it's for, open source or Cloud |
| `/solutions/` and five pages under it | Shipping lines, rail and intermodal, trucking, container owners and leasing, terminals and depots |
| `/integrations/` | REST API, signed webhooks, EDIFACT CODECO, the EIR, and the runnable examples |
| `/open-source/` | What's in the repository, self-hosting in one container, the licence |
| `/cloud/` | The three plans and the waitlist form |
| `/privacy/` | What the waitlist stores and how to have it deleted |

## Develop

```sh
npm ci
npm run dev:site        # builds, serves http://localhost:8080, rebuilds on every change
```

`npm run check` at the repository root lints, type-checks and tests this workspace with the others.

## Build and run

```sh
npm run build --workspace @plomba/site    # writes apps/site/dist
npm start --workspace @plomba/site        # serves it on port 8080
```

The build writes `dist/public/` (what the server serves: pages, assets under a content-hashed folder, images, sitemap) and, beside it, the 404 page and `render-context.json`, which the server uses to render its own pages with the same assets. Restart the server after a rebuild.

`SITE_URL` sets the address the site is published at (default `https://plomba.lisovate.com`), for canonical URLs, link previews and the sitemap.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Where the server listens |
| `WAITLIST_DB` | `./data/waitlist.db` | The SQLite database of sign-ups, created on first start |
| `SITE_DIST_DIR` | `apps/site/dist` | The build to serve |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy, so the rate limit sees each visitor's address (the last `X-Forwarded-For` entry) rather than the proxy's |

The waitlist accepts five sign-ups per address (per /64 network for IPv6) every ten minutes. The addresses are held in memory only.

## Docker

```sh
docker build -f apps/site/Dockerfile -t plomba-site --build-arg SITE_URL=https://plomba.lisovate.com .
docker run -d --name plomba-site -p 8080:8080 -e TRUST_PROXY=true -v plomba-site-data:/data plomba-site
```

The image runs as the unprivileged `node` user and keeps the database at `/data/waitlist.db`. Put HTTPS in front with any reverse proxy (see the Caddy example in [docs/self-hosting.md](../../docs/self-hosting.md)).

## Waitlist leads

There is no web admin. The operator exports the leads as CSV:

```sh
node apps/site/server/export.ts > leads.csv                        # reads WAITLIST_DB
docker exec plomba-site node apps/site/server/export.ts > leads.csv
```

The CSV is UTF-8, and cells that a spreadsheet would run as formulas are prefixed with an apostrophe.

When someone asks for their entry to be deleted, as the privacy page offers:

```sh
docker exec plomba-site node apps/site/server/delete-lead.ts anna@example.com
```

## Where things are

| Path | What |
|---|---|
| `src/pages/` | One module per page. Each exports its path, title, description and body |
| `src/solutions.ts` | The copy for the five solution pages, the home page's cards and the footer |
| `src/layout.ts`, `src/components.ts` | The document, header and footer; the building blocks pages use |
| `src/figures.ts`, `src/example.ts` | The diagrams, drawn as SVG. They follow one example container whose codes, hashes and CODECO message come from `@plomba/core` |
| `src/images.ts` | Every image path, size, description and credit. Swap screenshots here |
| `src/styles/site.css` | The stylesheet: tokens, then one block per component |
| `src/client/waitlist.ts` | The form script, shipped with its types stripped |
| `server/` | The HTTP server, validation, rate limit, storage and the CLIs |
| `scripts/make-images.ts` | Crops the app screens and the link-preview image from `docs/images/screens.jpg` (`npm run images --workspace @plomba/site`) |

## Credits

- The app screens show frames of "How to buy a shipping container in 10 minutes" by Cowboy Steve Builds and "40' reefer shipping container delivery and repositioning" by Life, Take 2, both CC BY 3.0. The site's footer credits them.
- Fonts: IBM Plex Sans and IBM Plex Mono, SIL Open Font License, from Fontsource. The licence ships with the font files.
- Icons: [Lucide](https://lucide.dev), ISC licence.
