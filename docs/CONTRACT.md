# PlayzAnime Web: frontend ↔ server contract

PlayzAnime Web is the browser version of the PlayzAnime desktop app (`C:\Users\Moses\Desktop\Dev Code\Electron Conversion`, read-only reference, never edit it). It has the same design and the same features, except the ones only a desktop app can do (downloads, offline files, Windows folder protection, taskbar buttons).

## Layout

```
PlayzAnime Web/
  src/            React web app (port of the desktop renderer)        owner: frontend
    shared/       types.ts + api.ts copied from desktop src/shared     owner: frontend (server imports types only)
    web/          window.playzanime implementation for the browser     owner: frontend
  server/         Node server: RPC, stream + image proxies, static     owner: server
    package.json  its own deps (keep them few)
  legacy/         the old vanilla-TS frontend and the Python/Selenium backend, kept for reference
  package.json    frontend deps + scripts                               owner: frontend
  start.bat       launches server + vite (dev) or the built site        (written at integration)
```

## Ports

- Server: `http://localhost:5310`. In production it also serves the built frontend from `dist/`.
- Vite dev server: `http://localhost:5311`. It proxies `/api` and `/proxy` to 5310.

## RPC

`POST /api/rpc/<channel>`, JSON body `{ "args": [ ...same arguments as the desktop IPC call... ] }`.

- 200 → the JSON result (exactly the desktop's return type, from `src/shared/types.ts`).
- 4xx/5xx → `{ "error": "Human-readable message" }`.

Every RPC request carries the viewer's preferences in the header `x-pz-prefs`, a JSON string: `{"hideAdult":true,"dataSaver":false,"mangaProvider":"auto","titleLanguage":"english"}`. The server uses them wherever the desktop read `store().settings` (adult filtering, MangaDex data-saver pages, the preferred manga source). If the header is missing or malformed, the server uses those defaults.

The server implements these channels, with the same semantics as the desktop `src/main/ipc.ts`:

| Channel | Args | Returns |
|---|---|---|
| `anilist:home` | `[refresh?]` | `HomeFeed` |
| `anilist:mangaHome` | `[refresh?]` | `MangaFeed` |
| `anilist:browse` | `[BrowseFilters]` | `Paged<Media>` |
| `anilist:media` | `[id]` | `MediaDetail` |
| `anilist:schedule` | `[fromUnix, toUnix]` | `AiringItem[]` |
| `episodes:list` | `[mediaId, refresh?]` | `EpisodeList` |
| `stream:resolve` | `[embedUrl, refresh?]` | `ResolvedStream` (URLs already proxied, see below) |
| `manga:chapters` | `[mediaId, provider?, refresh?]` | `ChapterList` |
| `manga:pages` | `[Chapter]` | `ChapterPage[]` (URLs already proxied when the host needs a Referer) |
| `manga:health` | `[force?]` | `ProviderHealth[]` |
| `app:info` | `[]` | `AppInfo` (`platform: 'web'`, `packaged: true`) |

The browser implements everything else itself (see "Client-side" below).

## Proxies

The browser can't set `Referer`, and the stream and manga hosts send no CORS headers. The server forwards those requests for it.

- `GET /proxy/hls?u=<url>&r=<referer>&s=<sig>`: fetches a playlist and rewrites every URI inside it (variants, segments, `#EXT-X-KEY` URIs, `#EXT-X-MAP`) to proxied URLs, including relative ones.
- `GET /proxy/file?u=<url>&r=<referer>&s=<sig>`: streams any other resource (segments, keys, `.vtt`, images). It passes `Range` through and sends `Access-Control-Allow-Origin: *`. Images get `Cache-Control: public, max-age=2592000`.
- `s` is an HMAC-SHA256 of `u + '|' + r` with a secret generated at server start (or taken from the `PROXY_SECRET` env var). Requests without a valid `s` get 403. The proxy only fetches URLs the server itself handed out, so it's never an open proxy.
- The server signs every URL it returns: in `ResolvedStream` (`master`, `variants[].url`, `subtitles[].url`) and in `ChapterPage.url` wherever the host needs a Referer.

## Client-side (frontend owns)

`window.playzanime` is installed in `src/web/` before React renders. It keeps the same `PlayzAnimeApi` shape as the desktop app, so views barely change:

- `library`, `history`, `reading`, `settings`, `profile`, `setup` are all local: localStorage (IndexedDB if needed), with the same return types.
- `profile.export` downloads a `.playzanime` file (Blob). `profile.pick` opens `<input type=file>`. Validation mirrors desktop `src/main/profiles.ts`.
- `downloads.*`, `offline.*`, `app.openDir`, `app.setPlayer`, `app.onCommand` and `setup.allowFolders` return empty or graceful values. The UI hides those features on web and shows "Get the Windows app" where downloads would be.
- `app.openExternal` → `window.open(url, '_blank', 'noopener')`. `app.online` → `navigator.onLine`.

## Links

Every "GitHub", "Download for Windows", "Docs" or "Support" link goes to `https://github.com/PlayzAe` until real URLs exist.

## Contributing

- Keep live tests small: a few seconds of video, one or two manga pages. Sources are other people's servers.
- Prefer the packages the desktop app already uses (React 19, Vite 8, TypeScript, hls.js, motion, @fontsource-variable/archivo, node-html-parser) over adding new ones.
- No ads. No trackers.
