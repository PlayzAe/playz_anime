# Deploying PlayzAnime Web

The site is two parts: the **page** (static files built into `dist/`) and the **server**
(search, episodes, streams and manga pages). Pick one of the three setups below.

| Setup | Page | Server | Effort |
|---|---|---|---|
| **A. Vercel** (recommended) | Vercel | Vercel functions | Import the repo, set two variables |
| **B. GitHub Pages + Vercel** | GitHub Pages | Vercel (setup A) | A, then one Pages variable |
| **C. Your own machine or VPS** | the Node server | the Node server | `start.bat built`, or `npm --prefix server start` |

## A. Vercel

1. Push this folder to a GitHub repository.
2. On vercel.com: **Add New → Project**, import the repository. `vercel.json` already sets the install
   command, build command, output folder and functions, so leave the defaults.
3. Under **Settings → Environment Variables**, add:

   | Variable | Value | Why |
   |---|---|---|
   | `PROXY_SECRET` | any long random string | Signs proxy links. Every function copy must share it. |
   | `PLAYZANIME_RELAY` | `off` (recommended for a public site) | The server never relays video; episodes play in the source's own embedded player. Manga pages and metadata still work. |

4. Deploy. The site and its server are at your `*.vercel.app` address (or your domain).

## B. GitHub Pages for the page, Vercel for the server

1. Do setup A first. Note its address, e.g. `https://playzanime-web.vercel.app`.
2. On Vercel, add the variable `ALLOWED_ORIGINS` = your Pages address, e.g. `https://yourname.github.io`
   (no path, no trailing slash), and **`PUBLIC_URL`** = the Vercel address. Redeploy.
3. On GitHub: **Settings → Pages → Source: GitHub Actions**.
4. **Settings → Secrets and variables → Actions → Variables**:
   - `API_BASE` = the Vercel address.
   - `BASE_PATH` = `/` only if you use a custom domain; otherwise leave it unset and it becomes `/<repo>/`.
5. Push to `main`. `.github/workflows/pages.yml` builds with `npm run build:pages` (which also writes
   `404.html` so links like `/anime/123` work) and publishes.

## C. Your own machine or a VPS

```bash
npm install && npm install --prefix server
npm run build && npm --prefix server run build
npm --prefix server start
```

It serves everything on port 5310. Set `HOST=0.0.0.0` to accept connections from other devices,
`PORT` to change the port, and put it behind a reverse proxy with HTTPS for public use.

## All server variables

| Variable | Default | Meaning |
|---|---|---|
| `PLAYZANIME_RELAY` | `on` | `off`: never relay video; the page uses the embed player. |
| `PROXY_SECRET` | random per start | Required on Vercel (see above). |
| `PUBLIC_URL` | empty | The server's own public address, when the page is hosted elsewhere. |
| `ALLOWED_ORIGINS` | the dev server | Comma-separated sites allowed to call the server. |
| `PROXY_BASE` | `/proxy` (`/api/proxy` on Vercel) | Where the proxy routes live. |
| `BLOCKLIST_FILE` | `server/blocklist.json` | The takedown list (below). |
| `HOST`, `PORT` | `127.0.0.1`, `5310` | Node server only. |

## Takedowns

When a valid copyright notice arrives (see the site's Copyright & DMCA policy):

1. Add the title's AniList id to `mediaIds` in `server/blocklist.json` (the number in `/anime/<id>` or
   `/manga/<id>`). If the notice names a source website, add its hostname to `hosts`.
2. A running Node server picks the change up immediately. On Vercel, commit and push: the next deploy
   includes it.
3. Blocked titles answer with HTTP 451 and a plain message in the app.
4. Keep a record of each notice: date, sender, and what you disabled.
