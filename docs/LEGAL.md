# Legal

**PlayzAnime Web does not host, upload, store or distribute any video, image or manga page.**

- Titles, artwork, descriptions and schedules come from AniList's public API.
- Episodes and chapters are published by third-party websites. Browsers can't reach some of them directly, so the server forwards those requests as they happen and keeps nothing.
- With `PLAYZANIME_RELAY=off` (recommended for public deployments) the server never forwards video at all: episodes play in the source's own embedded player.

PlayzAnime isn't affiliated with, endorsed by or connected to AniList, any source website, streaming service, publisher, studio or rights holder. All names, trademarks and artwork belong to their owners.

Using PlayzAnime means agreeing to its policies (Terms of Service, Copyright & DMCA, Disclaimer, Privacy Policy). The full texts are in the PlayzAnime website's docs, under Policies. Until the site has its own domain, they're linked from [github.com/PlayzAe](https://github.com/PlayzAe).

## Takedowns

Valid copyright notices are acted on within 72 hours:

1. The title's AniList id goes into `server/blocklist.json`. Its episodes, streams and chapters are then refused with HTTP 451.
2. Any named source host is added to the same file.

`DEPLOY.md` has the details. Notices go to [github.com/PlayzAe](https://github.com/PlayzAe) as an issue titled "Copyright notice".
