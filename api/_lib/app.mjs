import { createRequire as __pzRequire } from 'node:module'; const require = __pzRequire(import.meta.url);

// src/app.ts
import fs5 from "node:fs";
import path4 from "node:path";

// src/anilist.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/cache.ts
var TtlCache = class {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }
  maxEntries;
  values = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  get(key) {
    const hit = this.values.get(key);
    if (!hit) return void 0;
    if (Date.now() - hit.at > hit.ttl) {
      this.values.delete(key);
      return void 0;
    }
    return hit.value;
  }
  set(key, value, ttlMs) {
    if (this.values.size >= this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest !== void 0) this.values.delete(oldest);
    }
    this.values.set(key, { at: Date.now(), ttl: ttlMs, value });
  }
  delete(key) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
  async wrap(key, ttlMs, load, force = false) {
    if (!force) {
      const hit = this.get(key);
      if (hit !== void 0) return hit;
    }
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const p = load().then((value) => {
      this.set(key, value, ttlMs);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }
};

// src/config.ts
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var serverRoot = path.resolve(import.meta.dirname, "..");
var onVercel = Boolean(process.env.VERCEL);
var list = (v) => (v ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
function proxySecret() {
  if (process.env.PROXY_SECRET) return process.env.PROXY_SECRET;
  if (onVercel) return createHash("sha256").update(`playzanime|${process.env.VERCEL_PROJECT_ID ?? ""}|${process.env.VERCEL_ENV ?? ""}`).digest("hex");
  return randomBytes(32).toString("hex");
}
var config = {
  version: true ? "0.1.0" : "0.0.0",
  onVercel,
  port: Number(process.env.PORT) || 5310,
  /** Loopback only by default; set HOST=0.0.0.0 to serve other devices on the network. */
  hosts: process.env.HOST ? [process.env.HOST] : ["127.0.0.1", "::1"],
  dev: process.env.NODE_ENV === "development",
  /** Feed cache and logs. Serverless file systems are read-only except the temp folder. */
  dataDir: onVercel ? path.join(os.tmpdir(), "playzanime") : path.join(serverRoot, "data"),
  /** Takedown list (see blocklist.ts); shipped with the code so it works read-only too. */
  blocklistFile: process.env.BLOCKLIST_FILE || path.join(serverRoot, "blocklist.json"),
  /** The built frontend, served when this server hosts the site itself. */
  distDir: path.resolve(serverRoot, "..", "dist"),
  /**
   * Where browsers reach this server, when the site is hosted elsewhere (GitHub Pages):
   * proxy URLs are then absolute. Empty means same origin.
   */
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
  /** Vercel functions live under /api, so the proxies do too there. */
  proxyBase: process.env.PROXY_BASE || (onVercel ? "/api/proxy" : "/proxy"),
  /** Origins allowed to call the RPC cross-origin: the dev server, plus ALLOWED_ORIGINS (for example your GitHub Pages site). */
  allowedOrigins: ["http://localhost:5311", "http://127.0.0.1:5311", ...list(process.env.ALLOWED_ORIGINS)],
  /**
   * PLAYZANIME_RELAY=off: this server never relays video. Episodes then play in the
   * source's own embedded player, so the server only ever passes along metadata.
   */
  relay: (process.env.PLAYZANIME_RELAY ?? "on").toLowerCase() !== "off",
  proxySecret: proxySecret()
};
fs.mkdirSync(config.dataDir, { recursive: true });

// src/http.ts
var CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
var HttpError = class extends Error {
  constructor(status, url, body = "", retryAfter = 0) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
    this.retryAfter = retryAfter;
  }
  status;
  url;
  body;
  retryAfter;
};
function withTimeout(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}
async function request(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    body: opts.body,
    headers: { "User-Agent": CHROME_UA, ...opts.headers },
    signal: withTimeout(opts.timeoutMs ?? 15e3, opts.signal),
    redirect: "follow"
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 2e3);
    throw new HttpError(res.status, url, body, Number(res.headers.get("retry-after")) || 0);
  }
  return res;
}
async function getText(url, opts) {
  return (await request(url, opts)).text();
}
async function getJson(url, opts) {
  return (await request(url, { ...opts, headers: { Accept: "application/json", ...opts?.headers } })).json();
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true }
    );
  });
}
async function retry(fn, attempts = 3, signal, onRateLimit) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (signal?.aborted) throw err;
      const status = err instanceof HttpError ? err.status : 0;
      if (status && status < 500 && status !== 429) throw err;
      if (i === attempts - 1) break;
      let wait = 400 * (i + 1) ** 2;
      if (status === 429 || status === 503) {
        onRateLimit?.();
        const after = err instanceof HttpError ? err.retryAfter * 1e3 : 0;
        wait = Math.min(3e4, after || 1500 * 2 ** i) + Math.random() * 500;
      }
      await sleep(wait, signal);
    }
  }
  throw last;
}

// src/log.ts
import fs2 from "node:fs";
import path2 from "node:path";
var stream = null;
var opened = false;
function file() {
  if (opened) return stream;
  opened = true;
  try {
    const dir = path2.join(config.dataDir, "logs");
    fs2.mkdirSync(dir, { recursive: true });
    const target = path2.join(dir, "server.log");
    if (fs2.existsSync(target)) fs2.renameSync(target, path2.join(dir, "server.previous.log"));
    stream = fs2.createWriteStream(target, { flags: "a" });
  } catch {
    stream = null;
  }
  return stream;
}
function write(level, scope, args) {
  const text = args.map((a) => a instanceof Error ? `${a.message}
${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${text}`;
  if (level !== "debug" || config.dev) {
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
  }
  file()?.write(line + "\n");
}
function logger(scope) {
  return {
    debug: (...a) => write("debug", scope, a),
    info: (...a) => write("info", scope, a),
    warn: (...a) => write("warn", scope, a),
    error: (...a) => write("error", scope, a)
  };
}

// src/anilist.ts
var log = logger("anilist");
var ENDPOINT = "https://graphql.anilist.co";
var cache = new TtlCache(400);
var MIN = 6e4;
var CARD_FRAGMENT = (
  /* GraphQL */
  `
  fragment card on Media {
    id
    idMal
    type
    isAdult
    title { romaji english native userPreferred }
    coverImage { extraLarge large medium color }
    bannerImage
    format
    status
    episodes
    duration
    chapters
    volumes
    countryOfOrigin
    season
    seasonYear
    genres
    averageScore
    popularity
    nextAiringEpisode { episode airingAt timeUntilAiring }
    studios(isMain: true) { nodes { name } }
    startDate { year month day }
  }
`
);
async function gql(query, variables) {
  const vars = Object.fromEntries(Object.entries(variables).filter(([, v]) => v !== null && v !== void 0));
  return retry(async () => {
    const res = await request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: CARD_FRAGMENT + query, variables: vars }),
      timeoutMs: 15e3
    }).catch((err) => {
      if (err instanceof HttpError) {
        if (err.status === 429) log.warn("rate limited by AniList");
        try {
          const messages = JSON.parse(err.body).errors?.map((e) => e.message);
          if (messages?.length) log.warn(`AniList ${err.status}: ${messages.join("; ")}`);
        } catch {
        }
      }
      throw err;
    });
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    if (!json.data) throw new Error("AniList returned no data");
    return json.data;
  });
}
var adultVar = (hideAdult) => hideAdult ? false : null;
function currentSeason(date = /* @__PURE__ */ new Date()) {
  const m = date.getMonth();
  const season = m <= 2 ? "WINTER" : m <= 5 ? "SPRING" : m <= 8 ? "SUMMER" : "FALL";
  return { season, year: date.getFullYear() };
}
var disk = null;
var diskFile = () => path3.join(config.dataDir, "feed-cache.json");
function readDisk() {
  if (!disk) {
    try {
      disk = JSON.parse(fs3.readFileSync(diskFile(), "utf8"));
    } catch {
      disk = {};
    }
  }
  return disk;
}
function writeDisk(key, value) {
  readDisk()[key] = { at: Date.now(), value };
  fs3.writeFile(diskFile(), JSON.stringify(disk), () => {
  });
}
async function instant(key, fetchFresh, force) {
  const saved = readDisk()[key];
  const firstLoad = cache.get(key) === void 0;
  const fresh = fetchFresh().then((v) => {
    writeDisk(key, v);
    return v;
  });
  if (!force && firstLoad && saved && Date.now() - saved.at < 24 * 36e5) {
    fresh.catch((err) => log.warn(`background refresh of ${key} failed:`, String(err)));
    return saved.value;
  }
  return fresh;
}
var HOME_QUERY = (
  /* GraphQL */
  `
  query ($season: MediaSeason, $year: Int, $isAdult: Boolean) {
    trending: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: [TRENDING_DESC, POPULARITY_DESC], status_not: NOT_YET_RELEASED, isAdult: $isAdult) {
        ...card
        description(asHtml: false)
      }
    }
    season: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: [POPULARITY_DESC], season: $season, seasonYear: $year, isAdult: $isAdult, status_not: NOT_YET_RELEASED) {
        ...card
      }
    }
    top: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: [SCORE_DESC], status_not: NOT_YET_RELEASED, isAdult: $isAdult, popularity_greater: 30000) {
        ...card
      }
    }
  }
`
);
function home(hideAdult, force = false) {
  return instant(`home:${hideAdult}`, () => homeFresh(hideAdult, force), force);
}
function homeFresh(hideAdult, force) {
  const label = currentSeason();
  return cache.wrap(
    `home:${hideAdult}`,
    10 * MIN,
    async () => {
      const data = await gql(HOME_QUERY, {
        season: label.season,
        year: label.year,
        isAdult: adultVar(hideAdult)
      });
      return { trending: data.trending.media, season: data.season.media, top: data.top.media, seasonLabel: label };
    },
    force
  );
}
var MANGA_HOME_QUERY = (
  /* GraphQL */
  `
  query ($isAdult: Boolean) {
    trending: Page(page: 1, perPage: 24) {
      media(type: MANGA, sort: [TRENDING_DESC, POPULARITY_DESC], format_not_in: [NOVEL], isAdult: $isAdult) {
        ...card
        description(asHtml: false)
      }
    }
    manhwa: Page(page: 1, perPage: 24) {
      media(type: MANGA, countryOfOrigin: "KR", sort: [TRENDING_DESC], format_not_in: [NOVEL], isAdult: $isAdult) {
        ...card
      }
    }
    top: Page(page: 1, perPage: 24) {
      media(type: MANGA, sort: [SCORE_DESC], format_not_in: [NOVEL], isAdult: $isAdult, popularity_greater: 20000) {
        ...card
      }
    }
  }
`
);
function mangaHome(hideAdult, force = false) {
  return instant(`mangaHome:${hideAdult}`, () => mangaHomeFresh(hideAdult, force), force);
}
function mangaHomeFresh(hideAdult, force) {
  return cache.wrap(
    `mangaHome:${hideAdult}`,
    10 * MIN,
    async () => {
      const data = await gql(
        MANGA_HOME_QUERY,
        { isAdult: adultVar(hideAdult) }
      );
      return { trending: data.trending.media, manhwa: data.manhwa.media, top: data.top.media };
    },
    force
  );
}
var BROWSE_QUERY = (
  /* GraphQL */
  `
  query (
    $type: MediaType, $page: Int, $perPage: Int, $search: String, $sort: [MediaSort], $genres: [String],
    $formats: [MediaFormat], $formatsNot: [MediaFormat], $season: MediaSeason, $year: Int, $status: MediaStatus,
    $statusNot: MediaStatus, $isAdult: Boolean, $country: CountryCode
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(
        type: $type, search: $search, sort: $sort, genre_in: $genres, format_in: $formats, format_not_in: $formatsNot,
        season: $season, seasonYear: $year, status: $status, status_not: $statusNot, isAdult: $isAdult,
        countryOfOrigin: $country
      ) {
        ...card
        description(asHtml: false)
      }
    }
  }
`
);
function browse(filters2, hideAdult) {
  const type = filters2.type ?? "ANIME";
  const search4 = filters2.search?.trim() || null;
  const sort = filters2.sort ?? (search4 ? "SEARCH_MATCH" : "TRENDING_DESC");
  const isManga = type === "MANGA";
  const vars = {
    type,
    page: filters2.page ?? 1,
    perPage: Math.min(filters2.perPage ?? 30, 50),
    search: search4,
    sort: sort === "SEARCH_MATCH" ? ["SEARCH_MATCH", "POPULARITY_DESC"] : [sort, "POPULARITY_DESC"],
    genres: filters2.genres?.length ? filters2.genres : null,
    formats: filters2.formats?.length ? filters2.formats : null,
    // Novels have nothing to read in the app; music videos have nothing to watch.
    formatsNot: isManga ? ["NOVEL"] : ["MUSIC"],
    season: isManga ? null : filters2.season ?? null,
    // For manga a "year" filter means the start year.
    year: isManga ? null : filters2.year ?? null,
    status: filters2.status ?? null,
    // Unreleased anime have nothing to play, so they only appear when asked for explicitly or when searching.
    statusNot: filters2.status || search4 || isManga ? null : "NOT_YET_RELEASED",
    isAdult: adultVar(hideAdult),
    country: isManga ? filters2.country ?? null : null
  };
  const key = `browse:${JSON.stringify(vars)}`;
  return cache.wrap(key, (search4 ? 5 : 10) * MIN, async () => {
    const data = await gql(BROWSE_QUERY, vars);
    return { items: data.Page.media, page: vars.page, hasNextPage: data.Page.pageInfo.hasNextPage };
  });
}
var MEDIA_QUERY = (
  /* GraphQL */
  `
  query ($id: Int) {
    Media(id: $id) {
      ...card
      description(asHtml: false)
      synonyms
      source(version: 3)
      endDate { year month day }
      tags { name rank isMediaSpoiler }
      trailer { id site }
      rankings { rank type allTime season year context }
      streamingEpisodes { title thumbnail }
      staff(perPage: 4, sort: [RELEVANCE]) { edges { role node { name { full } } } }
      relations {
        edges {
          relationType(version: 2)
          node { ...card }
        }
      }
      recommendations(perPage: 14, sort: [RATING_DESC]) {
        nodes { mediaRecommendation { ...card } }
      }
    }
  }
`
);
function media(id, force = false) {
  return cache.wrap(`media:${id}`, 30 * MIN, async () => (await gql(MEDIA_QUERY, { id })).Media, force);
}
async function mediaFor(id, hideAdult, force = false) {
  const m = { ...await media(id, force) };
  if (m.relations) {
    m.relations = { edges: m.relations.edges.filter((e) => e.node && e.node.format !== "NOVEL" && !(hideAdult && e.node.isAdult)) };
  }
  if (m.recommendations) {
    m.recommendations = {
      nodes: m.recommendations.nodes.filter((n) => n.mediaRecommendation && !(hideAdult && n.mediaRecommendation.isAdult))
    };
  }
  return m;
}
var SCHEDULE_QUERY = (
  /* GraphQL */
  `
  query ($page: Int, $from: Int, $to: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: [TIME]) {
        id
        episode
        airingAt
        media { ...card }
      }
    }
  }
`
);
function schedule(from, to, hideAdult) {
  return cache.wrap(`schedule:${from}:${to}:${hideAdult}`, 15 * MIN, async () => {
    const items = [];
    for (let page = 1; page <= 8; page++) {
      const data = await gql(
        SCHEDULE_QUERY,
        { page, from, to }
      );
      items.push(...data.Page.airingSchedules);
      if (!data.Page.pageInfo.hasNextPage) break;
    }
    return items.filter((i) => i.media && !(hideAdult && i.media.isAdult));
  });
}

// src/blocklist.ts
import fs4 from "node:fs";
var log2 = logger("blocklist");
var loadedAt = 0;
var mediaIds = /* @__PURE__ */ new Set();
var hosts = [];
function refresh() {
  try {
    const { mtimeMs } = fs4.statSync(config.blocklistFile);
    if (mtimeMs === loadedAt) return;
    const data = JSON.parse(fs4.readFileSync(config.blocklistFile, "utf8"));
    mediaIds = new Set((data.mediaIds ?? []).map(Number).filter(Number.isFinite));
    hosts = (data.hosts ?? []).map((h) => h.toLowerCase().trim()).filter(Boolean);
    loadedAt = mtimeMs;
    log2.info(`loaded: ${mediaIds.size} titles, ${hosts.length} hosts`);
  } catch (err) {
    if (err.code !== "ENOENT") log2.warn("could not read blocklist", String(err));
  }
}
var LegalBlock = class extends Error {
  constructor() {
    super("This title isn\u2019t available on PlayzAnime Web following a copyright notice.");
  }
};
function assertMediaAllowed(mediaId) {
  refresh();
  if (mediaIds.has(mediaId)) throw new LegalBlock();
}
function isHostBlocked(url) {
  refresh();
  if (!hosts.length) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
function assertUrlAllowed(url) {
  if (isHostBlocked(url)) throw new LegalBlock();
}

// node_modules/node-html-parser/dist/index.mjs
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __exportAll = (all, no_symbols) => {
  let target = {};
  for (var name in all) __defProp(target, name, {
    get: all[name],
    enumerable: true
  });
  if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
  return target;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
    key = keys[i];
    if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
      get: ((k) => from[k]).bind(null, key),
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
  value: mod,
  enumerable: true
}) : target, mod));
var decodeMap = /* @__PURE__ */ new Map([
  [0, 65533],
  [128, 8364],
  [130, 8218],
  [131, 402],
  [132, 8222],
  [133, 8230],
  [134, 8224],
  [135, 8225],
  [136, 710],
  [137, 8240],
  [138, 352],
  [139, 8249],
  [140, 338],
  [142, 381],
  [145, 8216],
  [146, 8217],
  [147, 8220],
  [148, 8221],
  [149, 8226],
  [150, 8211],
  [151, 8212],
  [152, 732],
  [153, 8482],
  [154, 353],
  [155, 8250],
  [156, 339],
  [158, 382],
  [159, 376]
]);
function replaceCodePoint(codePoint) {
  var _decodeMap$get;
  if (codePoint >= 55296 && codePoint <= 57343 || codePoint > 1114111) return 65533;
  return (_decodeMap$get = decodeMap.get(codePoint)) !== null && _decodeMap$get !== void 0 ? _decodeMap$get : codePoint;
}
function decodeBase64(input) {
  const binary = atob(input);
  const evenLength = binary.length & -2;
  const out = new Uint16Array(evenLength / 2);
  for (let index = 0, outIndex = 0; index < evenLength; index += 2) {
    const lo = binary.charCodeAt(index);
    const hi = binary.charCodeAt(index + 1);
    out[outIndex++] = lo | hi << 8;
  }
  return out;
}
var htmlDecodeTree = /* @__PURE__ */ decodeBase64("QR08ALkAAgH6AYsDNQR2BO0EPgXZBQEGLAbdBxMISQrvCmQLfQurDKQNLw4fD4YPpA+6D/IPAAAAAAAAAAAAAAAAKhBMEY8TmxUWF2EYLBkxGuAa3RsJHDscWR8YIC8jSCSIJcMl6ie3Ku8rEC0CLjoupS7kLgAIRU1hYmNmZ2xtbm9wcnN0dVQAWgBeAGUAaQBzAHcAfgCBAIQAhwCSAJoAoACsALMAbABpAGcAO4DGAMZAUAA7gCYAJkBjAHUAdABlADuAwQDBQHIiZXZlAAJhAAFpeW0AcgByAGMAO4DCAMJAEGRyAADgNdgE3XIAYQB2AGUAO4DAAMBA8CFoYZFj4SFjcgBhZAAAoFMqAAFncIsAjgBvAG4ABGFmAADgNdg43fAlbHlGdW5jdGlvbgCgYSBpAG4AZwA7gMUAxUAAAWNzpACoAHIAAOA12Jzc6SFnbgCgVCJpAGwAZABlADuAwwDDQG0AbAA7gMQAxEAABGFjZWZvcnN1xQDYANoA7QDxAPYA+QD8AAABY3LJAM8AayNzbGFzaAAAoBYidgHTANUAAKDnKmUAZAAAoAYjeQARZIABY3J0AOAA5QDrAGEidXNlAACgNSLuI291bGxpcwCgLCFhAJJjcgAA4DXYBd1wAGYAAOA12Dnd5SF2ZdhiYwDyAOoAbSJwZXEAAKBOIgAHSE9hY2RlZmhpbG9yc3UXARoBHwE6AVIBVQFiAWQBZgGCAakB6QHtAfIBYwB5ACdkUABZADuAqQCpQIABY3B5ACUBKAE1AfUhdGUGYWmg0iJ0KGFsRGlmZmVyZW50aWFsRAAAoEUhbCJleXMAAKAtIQACYWVpb0EBRAFKAU0B8iFvbgxhZABpAGwAO4DHAMdAcgBjAAhhbiJpbnQAAKAwIm8AdAAKYQABZG5ZAV0BaSJsbGEAuGB0I2VyRG90ALdg8gA5AWkAp2NyImNsZQAAAkRNUFRwAXQBeQF9AW8AdAAAoJkiaSJudXMAAKCWIuwhdXMAoJUiaSJtZXMAAKCXIm8AAAFjc4cBlAFrKndpc2VDb250b3VySW50ZWdyYWwAAKAyImUjQ3VybHkAAAFEUZwBpAFvJXVibGVRdW90ZQAAoB0gdSJvdGUAAKAZIAACbG5wdbABtgHNAdgBbwBuAGWgNyIAoHQqgAFnaXQAvAHBAcUB8iJ1ZW50AKBhIm4AdAAAoC8i7yV1ckludGVncmFsAKAuIgABZnLRAdMBAKACIe8iZHVjdACgECJuLnRlckNsb2Nrd2lzZUNvbnRvdXJJbnRlZ3JhbAAAoDMi7yFzcwCgLypjAHIAAOA12J7ccABDoNMiYQBwAACgTSKABURKU1phY2VmaW9zAAsCEgIVAhgCGwIsAjQCOQI9AnMCfwNvoEUh9CJyYWhkAKARKWMAeQACZGMAeQAFZGMAeQAPZIABZ3JzACECJQIoAuchZXIAoCEgcgAAoKEhaAB2AACg5CoAAWF5MAIzAvIhb24OYRRkbAB0oAciYQCUY3IAAOA12AfdAAFhZkECawIAAWNtRQJnAvIjaXRpY2FsAAJBREdUUAJUAl8CYwJjInV0ZQC0YG8AdAFZAloC2WJiJGxlQWN1dGUA3WJyImF2ZQBgYGkibGRlANxi7yFuZACgxCJmJWVyZW50aWFsRAAAoEYhcAR9AgAAAAAAAIECjgIAABoDZgAA4DXYO91EoagAhQKJAm8AdAAAoNwgcSJ1YWwAAKBQIuIhbGUAA0NETFJVVpkCqAK1Au8C/wIRA28AbgB0AG8AdQByAEkAbgB0AGUAZwByAGEA7ADEAW8AdAKvAgAAAACwAqhgbiNBcnJvdwAAoNMhAAFlb7kC0AJmAHQAgAFBUlQAwQLGAs0CciJyb3cAAKDQIekkZ2h0QXJyb3cAoNQhZQDlACsCbgBnAAABTFLWAugC5SFmdAABQVLcAuECciJyb3cAAKD4J+kkZ2h0QXJyb3cAoPon6SRnaHRBcnJvdwCg+SdpImdodAAAAUFU9gL7AnIicm93AACg0iFlAGUAAKCoInAAQQIGAwAAAAALA3Iicm93AACg0SFvJHduQXJyb3cAAKDVIWUlcnRpY2FsQmFyAACgJSJuAAADQUJMUlRhJAM2AzoDWgNxA3oDciJyb3cAAKGTIUJVLAMwA2EAcgAAoBMpcCNBcnJvdwAAoPUhciJldmUAEWPlIWZ00gJDAwAASwMAAFIDaSVnaHRWZWN0b3IAAKBQKWUkZVZlY3RvcgAAoF4p5SJjdG9yQqC9IWEAcgAAoFYpaSJnaHQA1AFiAwAAaQNlJGVWZWN0b3IAAKBfKeUiY3RvckKgwSFhAHIAAKBXKWUAZQBBoKQiciJyb3cAAKCnIXIAcgBvAPcAtAIAAWN0gwOHA3IA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YwAAoN8i4SFycnCgtiEAoD0pgKIqImJjZG9zACsVMBU6FT4VQRVyImNhcAAAoEgqAAFhdTQVNxVwAACgRipwAACgSipvAHQAAKCNInIAAKBFKgDgKiIA/gACYWxydksVURVuFXMVcgByAG2gtyEAoDwpeQCAAWV2dwBYFWUVaRVxAHACXxUAAAAAYxVyAGUA4wAXFXUA4wAZFWUAZQAAoM4iZSJkZ2UAAKDPImUAbgA7gKQApEBlI2Fycm93AAABbHJ7FX8V5SFmdACgtiFpImdodAAAoLchZQDkAG0VAAFjaYsVkRVvAG4AaQBuAPQAkwFuAHQAAKAxImwiY3R5AACgLSOACUFIYWJjZGVmaGlqbG9yc3R1d3oAuBW7Fb8V1RXgFegV+RUKFhUWHxZUFlcWZRbFFtsW7xb7FgUXChdyAPIAtAJhAHIAAKBlKQACZ2xyc8YVyhXOFdAV5yFlcgCgICDlIXRoAKA4IfIA9QxoAHagECAAoKMiawHZFd4VYSJyb3cAAKAPKWEA4wBfAgABYXnkFecV8iFvbg9hNGQAoUYhYW/tFfQVAAFnciEC8RVyAACgyiF0InNlcQAAoHcqgAFnbG0A/xUCFgUWO4CwALBAdABhALRjcCJ0eXYAAKCxKQABaXIOFhIW8yFodACgfykA4DXYId1hAHIAAAFschsWHRYAoMMhAKDCIYACYWVnc3YAKBauAjYWOhY+Fm0AAKHEIm9zLhY0Fm4AZABzoMQi9SFpdACgZiZhIm1tYQDdY2kAbgAAoPIiAKH3AGlvQxZRFmQAZQAAgfcAO29KFksW90BuI3RpbWVzAACgxyJuAPgAUBZjAHkAUmRjAG8CXhYAAAAAYhZyAG4AAKAeI28AcAAAoA0jgAJscHR1dwBuFnEWdRaSFp4W7CFhciRgZgAA4DXYVd0AotkCZW1wc30WhBaJFo0WcQBkoFAibwB0AACgUSJpIm51cwAAoDgi7CF1cwCgFCLxInVhcmUAoKEiYgBsAGUAYgBhAHIAdwBlAGQAZwDlANcAbgCAAWFkaAClFqoWtBZyAHIAbwD3APUMbwB3AG4AYQByAHIAbwB3APMA8xVhI3Jwb29uAAABbHK8FsAWZQBmAPQAHBZpAGcAaAD0AB4WYgHJFs8WawBhAHIAbwD3AJILbwLUFgAAAADYFnIAbgAAoB8jbwBwAACgDCOAAWNvdADhFukW7BYAAXJ55RboFgDgNdi53FVkbAAAoPYp8iFvaxFhAAFkcvMW9xZvAHQAAKDxImkA5qC/JVsSAAFhaP8WAhdyAPIANQNhAPIA1wvhIm5nbGUAoKYpAAFjaQ4XEBd5AF9k5yJyYXJyAKD/JwAJRGFjZGVmZ2xtbm9wcXJzdHV4MRc4F0YXWxcyBF4XaRd5F40XrBe0F78X2RcVGCEYLRg1GEAYAAFEbzUXgRZvAPQA+BUAAWNzPBdCF3UAdABlADuA6QDpQPQhZXIAoG4qAAJhaW95TRdQF1YXWhfyIW9uG2FyAGOgViI7gOoA6kDsIW9uAKBVIk1kbwB0ABdhAAFEcmIXZhdvAHQAAKBSIgDgNdgi3XKhmipuF3QXYQB2AGUAO4DoAOhAZKCWKm8AdAAAoJgqgKGZKmlscwCAF4UXhxfuInRlcnMAoOcjAKATIWSglSpvAHQAAKCXKoABYXBzAJMXlheiF2MAcgATYXQAeQBzogUinxcAAAAAoRdlAHQAAKAFInAAMaADIDMBqRerFwCgBCAAoAUgAAFnc7AXsRdLYXAAAKACIAABZ3C4F7sXbwBuABlhZgAA4DXYVt2AAWFscwDFF8sXzxdyAHOg1SJsAACg4yl1AHMAAKBxKmkAAKG1A2x21RfYF28AbgC1Y/VjAAJjc3V24BfoF/0XEBgAAWlv5BdWF3IAYwAAoFYiaQLuFwAAAADwF+0ADQThIW50AAFnbPUX+Rd0AHIAAKCWKuUhc3MAoJUqgAFhZWkAAxgGGAoYbABzAD1gcwB0AACgXyJ2AESgYSJEAACgeCrwImFyc2wAoOUpAAFEYRkYHRhvAHQAAKBTInIAcgAAoHEpgAFjZGkAJxgqGO0XcgAAoC8hbwD0AIwCAAFhaDEYMhi3YzuA8ADwQAABbXI5GD0YbAA7gOsA60BvAACgrCCAAWNpcABGGEgYSxhsACFgcwD0ACwEAAFlb08YVxhjAHQAYQB0AGkAbwDuABoEbgBlAG4AdABpAGEAbADlADME4Ql1GAAAgRgAAIMYiBgAAAAAoRilGAAAqhgAALsYvhjRGAAA1xgnGWwAbABpAG4AZwBkAG8AdABzAGUA8QBlF3kARGRtImFsZQAAoEAmgAFpbHIAjRiRGJ0Y7CFpZwCgA/tpApcYAAAAAJoYZwAAoAD7aQBnAACgBPsA4DXYI93sIWlnAKAB++whaWcA4GYAagCAAWFsdACvGLIYthh0AACgbSZpAGcAAKAC+24AcwAAoLElbwBmAJJh8AHCGAAAxhhmAADgNdhX3QABYWvJGMwYbADsAGsEdqDUIgCg2SphI3J0aW50AACgDSoAAWFv2hgiGQABY3PeGB8ZsQPnGP0YBRkSGRUZAAAdGbID7xjyGPQY9xj5GAAA+xg7gL0AvUAAoFMhO4C8ALxAAKBVIQCgWSEAoFshswEBGQAAAxkAoFQhAKBWIbQCCxkOGQAAAAAQGTuAvgC+QACgVyEAoFwhNQAAoFghtgEZGQAAGxkAoFohAKBdITgAAKBeIWwAAKBEIHcAbgAAoCIjYwByAADgNdi73IAIRWFiY2RlZmdpamxub3JzdHYARhlKGVoZXhlmGWkZkhmWGZkZnRmgGa0ZxhnLGc8Z4BkjGmygZyIAoIwqgAFjbXAAUBlTGVgZ9SF0ZfVhbQBhAOSgswM6FgCghipyImV2ZQAfYQABaXliGWUZcgBjAB1hM2RvAHQAIWGAoWUibHFzAMYEcBl6GfGhZSLOBAAAdhlsAGEAbgD0AN8EgKF+KmNkbACBGYQZjBljAACgqSpvAHQAb6CAKmyggioAoIQqZeDbIgD+cwAAoJQqcgAA4DXYJN3noGsirATtIWVsAKA3IWMAeQBTZIChdyJFYWoApxmpGasZAKCSKgCgpSoAoKQqAAJFYWVztBm2Gb0ZwhkAoGkicABwoIoq8iFveACgiipxoIgq8aCIKrUZaQBtAACg5yJwAGYAAOA12FjdYQB2AOUAYwIAAWNp0xnWGXIAAKAKIW0AAKFzImVs3BneGQCgjioAoJAqAIM+ADtjZGxxco0E6xn0GfgZ/BkBGgABY2nvGfEZAKCnKnIAAKB6Km8AdAAAoNci0CFhcgCglSl1ImVzdAAAoHwqgAJhZGVscwAKGvQZFhrVBCAa8AEPGgAAFBpwAHIAbwD4AFkZcgAAoHgpcQAAAWxxxAQbGmwAZQBzAPMASRlpAO0A5AQAAWVuJxouGnIjdG5lcXEAAOBpIgD+xQAsGgAFQWFiY2Vma29zeUAaQxpmGmoabRqDGocalhrCGtMacgDyAMwCAAJpbG1yShpOGlAaVBpyAHMA8ABxD2YAvWBpAGwA9AASBQABZHJYGlsaYwB5AEpkAKGUIWN3YBpkGmkAcgAAoEgpAKCtIWEAcgAAoA8h6SFyYyVhgAFhbHIAcxp7Gn8a8iF0c3WgZSZpAHQAAKBlJuwhaXAAoCYg4yFvbgCguSJyAADgNdgl3XMAAAFld4wakRphInJvdwAAoCUpYSJyb3cAAKAmKYACYW1vcHIAnxqjGqcauhq+GnIAcgAAoP8h9CFodACgOyJrAAABbHKsGrMaZSRmdGFycm93AACgqSHpJGdodGFycm93AKCqIWYAAOA12Fnd4iFhcgCgFSCAAWNsdADIGswa0BpyAADgNdi93GEAcwDoAGka8iFvaydhAAFicNca2xr1IWxsAKBDIOghZW4AoBAg4Qr2GgAA/RoAAAgbExsaGwAAIRs7GwAAAAA+G2IbmRuVG6sbAACyG80b0htjAHUAdABlADuA7QDtQAChYyBpeQEbBhtyAGMAO4DuAO5AOGQAAWN4CxsNG3kANWRjAGwAO4ChAKFAAAFmcssCFhsA4DXYJt1yAGEAdgBlADuA7ADsQIChSCFpbm8AJxsyGzYbAAFpbisbLxtuAHQAAKAMKnQAAKAtIuYhaW4AoNwpdABhAACgKSHsIWlnM2GAAWFvcABDG1sbXhuAAWNndABJG0sbWRtyACthgAFlbHAAcQVRG1UbaQBuAOUAyAVhAHIA9AByBWgAMWFmAACgtyJlAGQAtWEAoggiY2ZvdGkbbRt1G3kb4SFyZQCgBSFpAG4AdKAeImkAZQAAoN0pZABvAPQAWxsAoisiY2VscIEbhRuPG5QbYQBsAACguiIAAWdyiRuNG2UAcgDzACMQ4wCCG2EicmhrAACgFyryIW9kAKA8KgACY2dwdJ8boRukG6gbeQBRZG8AbgAvYWYAAOA12FrdYQC5Y3UAZQBzAHQAO4C/AL9AAAFjabUbuRtyAADgNdi+3G4AAKIIIkVkc3bCG8QbyBvQAwCg+SJvAHQAAKD1Inag9CIAoPMiaaBiIOwhZGUpYesB1hsAANkbYwB5AFZkbAA7gO8A70AAA2NmbW9zdeYb7hvyG/Ub+hsFHAABaXnqG+0bcgBjADVhOWRyAADgNdgn3eEhdGg3YnAAZgAA4DXYW93jAf8bAAADHHIAAOA12L/c8iFjeVhk6yFjeVRkAARhY2ZnaGpvcxUcGhwiHCYcKhwtHDAcNRzwIXBhdqC6A/BjAAFleR4cIRzkIWls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ZmdobG1vcHJzdHV3CiwNLBEsHSwnLDEsQCxLLFIsYix6LIQsjyzLLOgs7Sz/LAotcgDyAAkDYQByAACgYykAAWNyFSwbLHUAdABlADuA+gD6QPIACQ1yAOMBIywAACUseQBeZHYAZQBtYQABaXkrLDAscgBjADuA+wD7QENkgAFhYmgANyw6LD0scgDyANEO7CFhY3FhYQDyAOAOAAFpckQsSCzzIWh0AKB+KQDgNdgy3XIAYQB2AGUAO4D5APlAYQFWLF8scgAAAWxyWixcLACgvyEAoL4hbABrAACggCUAAWN0Zix2LG8CbCwAAAAAcyxyAG4AZaAcI3IAAKAcI28AcAAAoA8jcgBpAACg+CUAAWFsfiyBLGMAcgBrYTuAqACoQAABZ3CILIssbwBuAHNhZgAA4DXYZt0AA2FkaGxzdZksniynLLgsuyzFLHIAcgBvAPcACQ1vAHcAbgBhAHIAcgBvAPcA2A5hI3Jwb29uAAABbHKvLLMsZQBmAPQAWyxpAGcAaAD0AF0sdQDzAKYOaQAAocUDaGzBLMIs0mNvAG4AxWPwI2Fycm93cwCgyCGAAWNpdADRLOEs5CxvAtcsAAAAAN4scgBuAGWgHSNyAACgHSNvAHAAAKAOI24AZwBvYXIAaQAAoPklYwByAADgNdjK3IABZGlyAPMs9yz6LG8AdAAAoPAi7CFkZWlhaQBmoLUlAKC0JQABYW0DLQYtcgDyAMosbAA7gPwA/EDhIm5nbGUAoKcpgAdBQkRhY2RlZmxub3Byc3oAJy0qLTAtNC2bLZ0toS2/LcMtxy3TLdgt3C3gLfwtcgDyABADYQByAHag6CoAoOkqYQBzAOgA/gIAAW5yOC08LechcnQAoJwpgANla25wcnN0AJkpSC1NLVQtXi1iLYItYQBwAHAA4QAaHG8AdABoAGkAbgDnAKEXgAFoaXIAoSmzJFotbwBwAPQAdCVooJUh7wD4JgABaXVmLWotZwBtAOEAuygAAWJwbi14LXMjZXRuZXEAceCKIgD+AODLKgD+cyNldG5lcQBx4IsiAP4A4MwqAP4AAWhyhi2KLWUAdADhABIraSNhbmdsZQAAAWxyki2WLeUhZnQAoLIiaSJnaHQAAKCzInkAMmThIXNoAKCiIoABZWxyAKcttC24LWKiKCKuLQAAAACyLWEAcgAAoLsicQAAoFoi7CFpcACg7iIAAWJ0vC1eD2EA8gBfD3IAAOA12DPddAByAOkAlS1zAHUAAAFicM0t0C0A4IIi0iAA4IMi0iBwAGYAAOA12GfdcgBvAPAAWQt0AHIA6QCaLQABY3XkLegtcgAA4DXYy9wAAWJw7C30LW4AAAFFZXUt8S0A4IoiAP5uAAABRWV/LfktAOCLIgD+6SJnemFnAKCaKYADY2Vmb3BycwANLhAuJS4pLiMuLi40LukhcmN1YQABZGkULiEuAAFiZxguHC5hAHIAAKBfKmUAcaAnIgCgWSLlIXJwAKAYIXIAAOA12DTdcABmAADgNdho3WWgQCJhAHQA6ABqD2MAcgAA4DXYzNzjCuQRUC4AAFQuAABYLmIuAAAAAGMubS5wLnQuAAAAAIguki4AAJouJxIqEnQAcgDpAB0ScgAA4DXYNd0AAUFhWy5eLnIA8gDnAnIA8gCTB75jAAFBYWYuaS5yAPIA4AJyAPIAjAdhAPAAeh5pAHMAAKD7IoABZHB0APgReS6DLgABZmx9LoAuAOA12GnddQDzAP8RaQBtAOUABBIAAUFhiy6OLnIA8gDuAnIA8gCaBwABY3GVLgoScgAA4DXYzdwAAXB0nS6hLmwAdQDzACUScgDpACASAARhY2VmaW9zdbEuvC7ELsguzC7PLtQu2S5jAAABdXm2LrsudABlADuA/QD9QE9kAAFpecAuwy5yAGMAd2FLZG4AO4ClAKVAcgAA4DXYNt1jAHkAV2RwAGYAAOA12GrdYwByAADgNdjO3AABY23dLt8ueQBOZGwAO4D/AP9AAAVhY2RlZmhpb3N38y73Lv8uAi8MLxAvEy8YLx0vIi9jInV0ZQB6YQABYXn7Lv4u8iFvbn5hN2RvAHQAfGEAAWV0Bi8KL3QAcgDmAB8QYQC2Y3IAAOA12DfdYwB5ADZk5yJyYXJyAKDdIXAAZgAA4DXYa91jAHIAAOA12M/cAAFqbiYvKC8AoA0gagAAoAwg");
var BinTrieFlags;
(function(BinTrieFlags2) {
  BinTrieFlags2[BinTrieFlags2["VALUE_LENGTH"] = 49152] = "VALUE_LENGTH";
  BinTrieFlags2[BinTrieFlags2["FLAG13"] = 8192] = "FLAG13";
  BinTrieFlags2[BinTrieFlags2["BRANCH_LENGTH"] = 8064] = "BRANCH_LENGTH";
  BinTrieFlags2[BinTrieFlags2["JUMP_TABLE"] = 127] = "JUMP_TABLE";
})(BinTrieFlags || (BinTrieFlags = {}));
function _typeof(o) {
  "@babel/helpers - typeof";
  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
    return typeof o2;
  } : function(o2) {
    return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
  }, _typeof(o);
}
function toPrimitive(t, r) {
  if ("object" != _typeof(t) || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r || "default");
    if ("object" != _typeof(i)) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return ("string" === r ? String : Number)(t);
}
function toPropertyKey(t) {
  var i = toPrimitive(t, "string");
  return "symbol" == _typeof(i) ? i : i + "";
}
function _defineProperty(e, r, t) {
  return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
    value: t,
    enumerable: true,
    configurable: true,
    writable: true
  }) : e[r] = t, e;
}
var CharCodes;
(function(CharCodes2) {
  CharCodes2[CharCodes2["NUM"] = 35] = "NUM";
  CharCodes2[CharCodes2["SEMI"] = 59] = "SEMI";
  CharCodes2[CharCodes2["EQUALS"] = 61] = "EQUALS";
  CharCodes2[CharCodes2["ZERO"] = 48] = "ZERO";
  CharCodes2[CharCodes2["NINE"] = 57] = "NINE";
  CharCodes2[CharCodes2["LOWER_A"] = 97] = "LOWER_A";
  CharCodes2[CharCodes2["LOWER_F"] = 102] = "LOWER_F";
  CharCodes2[CharCodes2["LOWER_X"] = 120] = "LOWER_X";
  CharCodes2[CharCodes2["LOWER_Z"] = 122] = "LOWER_Z";
  CharCodes2[CharCodes2["UPPER_A"] = 65] = "UPPER_A";
  CharCodes2[CharCodes2["UPPER_F"] = 70] = "UPPER_F";
  CharCodes2[CharCodes2["UPPER_Z"] = 90] = "UPPER_Z";
})(CharCodes || (CharCodes = {}));
var TO_LOWER_BIT = 32;
function isNumber(code) {
  return code >= CharCodes.ZERO && code <= CharCodes.NINE;
}
function isHexadecimalCharacter(code) {
  return code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_F || code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_F;
}
function isAsciiAlphaNumeric(code) {
  return code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_Z || code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_Z || isNumber(code);
}
function isEntityInAttributeInvalidEnd(code) {
  return code === CharCodes.EQUALS || isAsciiAlphaNumeric(code);
}
var EntityDecoderState;
(function(EntityDecoderState2) {
  EntityDecoderState2[EntityDecoderState2["EntityStart"] = 0] = "EntityStart";
  EntityDecoderState2[EntityDecoderState2["NumericStart"] = 1] = "NumericStart";
  EntityDecoderState2[EntityDecoderState2["NumericDecimal"] = 2] = "NumericDecimal";
  EntityDecoderState2[EntityDecoderState2["NumericHex"] = 3] = "NumericHex";
  EntityDecoderState2[EntityDecoderState2["NamedEntity"] = 4] = "NamedEntity";
})(EntityDecoderState || (EntityDecoderState = {}));
var DecodingMode;
(function(DecodingMode2) {
  DecodingMode2[DecodingMode2["Legacy"] = 0] = "Legacy";
  DecodingMode2[DecodingMode2["Strict"] = 1] = "Strict";
  DecodingMode2[DecodingMode2["Attribute"] = 2] = "Attribute";
})(DecodingMode || (DecodingMode = {}));
var EntityDecoder = class {
  constructor(decodeTree, emitCodePoint, errors) {
    _defineProperty(this, "decodeTree", void 0);
    _defineProperty(this, "emitCodePoint", void 0);
    _defineProperty(this, "errors", void 0);
    _defineProperty(
      this,
      /** The current state of the decoder. */
      "state",
      EntityDecoderState.EntityStart
    );
    _defineProperty(
      this,
      /** Characters that were consumed while parsing an entity. */
      "consumed",
      1
    );
    _defineProperty(
      this,
      /**
      * The result of the entity.
      *
      * Either the result index of a numeric entity, or the codepoint of a
      * numeric entity.
      */
      "result",
      0
    );
    _defineProperty(
      this,
      /** The current index in the decode tree. */
      "treeIndex",
      0
    );
    _defineProperty(
      this,
      /** The number of characters that were consumed in excess. */
      "excess",
      1
    );
    _defineProperty(
      this,
      /** The mode in which the decoder is operating. */
      "decodeMode",
      DecodingMode.Strict
    );
    _defineProperty(
      this,
      /** The number of characters that have been consumed in the current run. */
      "runConsumed",
      0
    );
    this.decodeTree = decodeTree;
    this.emitCodePoint = emitCodePoint;
    this.errors = errors;
  }
  /**
  * Resets the instance to make it reusable.
  * @param decodeMode Entity decoding mode to use.
  */
  startEntity(decodeMode) {
    this.decodeMode = decodeMode;
    this.state = EntityDecoderState.EntityStart;
    this.result = 0;
    this.treeIndex = 0;
    this.excess = 1;
    this.consumed = 1;
    this.runConsumed = 0;
  }
  /**
  * Write an entity to the decoder. This can be called multiple times with partial entities.
  * If the entity is incomplete, the decoder will return -1.
  *
  * Mirrors the implementation of `getDecoder`, but with the ability to stop decoding if the
  * entity is incomplete, and resume when the next string is written.
  * @param input The string containing the entity (or a continuation of the entity).
  * @param offset The offset at which the entity begins. Should be 0 if this is not the first call.
  * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
  */
  write(input, offset) {
    switch (this.state) {
      case EntityDecoderState.EntityStart:
        if (input.charCodeAt(offset) === CharCodes.NUM) {
          this.state = EntityDecoderState.NumericStart;
          this.consumed += 1;
          return this.stateNumericStart(input, offset + 1);
        }
        this.state = EntityDecoderState.NamedEntity;
        return this.stateNamedEntity(input, offset);
      case EntityDecoderState.NumericStart:
        return this.stateNumericStart(input, offset);
      case EntityDecoderState.NumericDecimal:
        return this.stateNumericDecimal(input, offset);
      case EntityDecoderState.NumericHex:
        return this.stateNumericHex(input, offset);
      case EntityDecoderState.NamedEntity:
        return this.stateNamedEntity(input, offset);
    }
  }
  /**
  * Switches between the numeric decimal and hexadecimal states.
  *
  * Equivalent to the `Numeric character reference state` in the HTML spec.
  * @param input The string containing the entity (or a continuation of the entity).
  * @param offset The current offset.
  * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
  */
  stateNumericStart(input, offset) {
    if (offset >= input.length) return -1;
    if ((input.charCodeAt(offset) | TO_LOWER_BIT) === CharCodes.LOWER_X) {
      this.state = EntityDecoderState.NumericHex;
      this.consumed += 1;
      return this.stateNumericHex(input, offset + 1);
    }
    this.state = EntityDecoderState.NumericDecimal;
    return this.stateNumericDecimal(input, offset);
  }
  /**
  * Parses a hexadecimal numeric entity.
  *
  * Equivalent to the `Hexademical character reference state` in the HTML spec.
  * @param input The string containing the entity (or a continuation of the entity).
  * @param offset The current offset.
  * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
  */
  stateNumericHex(input, offset) {
    while (offset < input.length) {
      const char = input.charCodeAt(offset);
      if (isNumber(char) || isHexadecimalCharacter(char)) {
        const digit = char <= CharCodes.NINE ? char - CharCodes.ZERO : (char | TO_LOWER_BIT) - CharCodes.LOWER_A + 10;
        this.result = this.result * 16 + digit;
        this.consumed++;
        offset++;
      } else return this.emitNumericEntity(char, 3);
    }
    return -1;
  }
  /**
  * Parses a decimal numeric entity.
  *
  * Equivalent to the `Decimal character reference state` in the HTML spec.
  * @param input The string containing the entity (or a continuation of the entity).
  * @param offset The current offset.
  * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
  */
  stateNumericDecimal(input, offset) {
    while (offset < input.length) {
      const char = input.charCodeAt(offset);
      if (isNumber(char)) {
        this.result = this.result * 10 + (char - CharCodes.ZERO);
        this.consumed++;
        offset++;
      } else return this.emitNumericEntity(char, 2);
    }
    return -1;
  }
  /**
  * Validate and emit a numeric entity.
  *
  * Implements the logic from the `Hexademical character reference start
  * state` and `Numeric character reference end state` in the HTML spec.
  * @param lastCp The last code point of the entity. Used to see if the
  *               entity was terminated with a semicolon.
  * @param expectedLength The minimum number of characters that should be
  *                       consumed. Used to validate that at least one digit
  *                       was consumed.
  * @returns The number of characters that were consumed.
  */
  emitNumericEntity(lastCp, expectedLength) {
    if (this.consumed <= expectedLength) {
      var _this$errors;
      (_this$errors = this.errors) === null || _this$errors === void 0 || _this$errors.absenceOfDigitsInNumericCharacterReference(this.consumed);
      return 0;
    }
    if (lastCp === CharCodes.SEMI) this.consumed += 1;
    else if (this.decodeMode === DecodingMode.Strict) return 0;
    this.emitCodePoint(replaceCodePoint(this.result), this.consumed);
    if (this.errors) {
      if (lastCp !== CharCodes.SEMI) this.errors.missingSemicolonAfterCharacterReference();
      this.errors.validateNumericCharacterReference(this.result);
    }
    return this.consumed;
  }
  /**
  * Parses a named entity.
  *
  * Equivalent to the `Named character reference state` in the HTML spec.
  * @param input The string containing the entity (or a continuation of the entity).
  * @param offset The current offset.
  * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
  */
  stateNamedEntity(input, offset) {
    const { decodeTree } = this;
    let current = decodeTree[this.treeIndex];
    let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
    while (offset < input.length) {
      if (valueLength === 0 && (current & BinTrieFlags.FLAG13) !== 0) {
        const runLength = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
        if (this.runConsumed === 0) {
          const firstChar = current & BinTrieFlags.JUMP_TABLE;
          if (input.charCodeAt(offset) !== firstChar) return this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
          offset++;
          this.excess++;
          this.runConsumed++;
        }
        while (this.runConsumed < runLength) {
          if (offset >= input.length) return -1;
          const charIndexInPacked = this.runConsumed - 1;
          const packedWord = decodeTree[this.treeIndex + 1 + (charIndexInPacked >> 1)];
          const expectedChar = charIndexInPacked % 2 === 0 ? packedWord & 255 : packedWord >> 8 & 255;
          if (input.charCodeAt(offset) !== expectedChar) {
            this.runConsumed = 0;
            return this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
          }
          offset++;
          this.excess++;
          this.runConsumed++;
        }
        this.runConsumed = 0;
        this.treeIndex += 1 + (runLength >> 1);
        current = decodeTree[this.treeIndex];
        valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
      }
      if (offset >= input.length) break;
      const char = input.charCodeAt(offset);
      if (char === CharCodes.SEMI && valueLength !== 0 && (current & BinTrieFlags.FLAG13) !== 0) return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
      this.treeIndex = determineBranch(decodeTree, current, this.treeIndex + Math.max(1, valueLength), char);
      if (this.treeIndex < 0) return this.result === 0 || this.decodeMode === DecodingMode.Attribute && (valueLength === 0 || isEntityInAttributeInvalidEnd(char)) ? 0 : this.emitNotTerminatedNamedEntity();
      current = decodeTree[this.treeIndex];
      valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
      if (valueLength !== 0) {
        if (char === CharCodes.SEMI) return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
        if (this.decodeMode !== DecodingMode.Strict && (current & BinTrieFlags.FLAG13) === 0) {
          this.result = this.treeIndex;
          this.consumed += this.excess;
          this.excess = 0;
        }
      }
      offset++;
      this.excess++;
    }
    return -1;
  }
  /**
  * Emit a named entity that was not terminated with a semicolon.
  * @returns The number of characters consumed.
  */
  emitNotTerminatedNamedEntity() {
    var _this$errors2;
    const { result, decodeTree } = this;
    const valueLength = (decodeTree[result] & BinTrieFlags.VALUE_LENGTH) >> 14;
    this.emitNamedEntityData(result, valueLength, this.consumed);
    (_this$errors2 = this.errors) === null || _this$errors2 === void 0 || _this$errors2.missingSemicolonAfterCharacterReference();
    return this.consumed;
  }
  /**
  * Emit a named entity.
  * @param result The index of the entity in the decode tree.
  * @param valueLength The number of bytes in the entity.
  * @param consumed The number of characters consumed.
  * @returns The number of characters consumed.
  */
  emitNamedEntityData(result, valueLength, consumed) {
    const { decodeTree } = this;
    this.emitCodePoint(valueLength === 1 ? decodeTree[result] & ~(BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13) : decodeTree[result + 1], consumed);
    if (valueLength === 3) this.emitCodePoint(decodeTree[result + 2], consumed);
    return consumed;
  }
  /**
  * Signal to the parser that the end of the input was reached.
  *
  * Remaining data will be emitted and relevant errors will be produced.
  * @returns The number of characters consumed.
  */
  end() {
    switch (this.state) {
      case EntityDecoderState.NamedEntity:
        return this.result !== 0 && (this.decodeMode !== DecodingMode.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
      case EntityDecoderState.NumericDecimal:
        return this.emitNumericEntity(0, 2);
      case EntityDecoderState.NumericHex:
        return this.emitNumericEntity(0, 3);
      case EntityDecoderState.NumericStart:
        var _this$errors3;
        (_this$errors3 = this.errors) === null || _this$errors3 === void 0 || _this$errors3.absenceOfDigitsInNumericCharacterReference(this.consumed);
        return 0;
      case EntityDecoderState.EntityStart:
        return 0;
    }
  }
};
function getDecoder(decodeTree) {
  let returnValue = "";
  const decoder = new EntityDecoder(decodeTree, (data) => returnValue += String.fromCodePoint(data));
  return function decodeWithTrie(input, decodeMode) {
    let lastIndex = 0;
    let offset = 0;
    while ((offset = input.indexOf("&", offset)) >= 0) {
      returnValue += input.slice(lastIndex, offset);
      decoder.startEntity(decodeMode);
      const length = decoder.write(input, offset + 1);
      if (length < 0) {
        lastIndex = offset + decoder.end();
        break;
      }
      lastIndex = offset + length;
      offset = length === 0 ? lastIndex + 1 : lastIndex;
    }
    const result = returnValue + input.slice(lastIndex);
    returnValue = "";
    return result;
  };
}
function determineBranch(decodeTree, current, nodeIndex, char) {
  const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
  const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
  if (branchCount === 0) return jumpOffset !== 0 && char === jumpOffset ? nodeIndex : -1;
  if (jumpOffset) {
    const value = char - jumpOffset;
    return value < 0 || value >= branchCount ? -1 : decodeTree[nodeIndex + value] - 1;
  }
  const packedKeySlots = branchCount + 1 >> 1;
  let lo = 0;
  let hi = branchCount - 1;
  while (lo <= hi) {
    const mid = lo + hi >>> 1;
    const midKey = decodeTree[nodeIndex + (mid >> 1)] >> (mid & 1) * 8 & 255;
    if (midKey < char) lo = mid + 1;
    else if (midKey > char) hi = mid - 1;
    else return decodeTree[nodeIndex + packedKeySlots + mid];
  }
  return -1;
}
var htmlDecoder = /* @__PURE__ */ getDecoder(htmlDecodeTree);
function decodeHTML(htmlString, mode = DecodingMode.Legacy) {
  return htmlDecoder(htmlString, mode);
}
var xmlCodeMap$1 = /* @__PURE__ */ new Map([
  [34, "&quot;"],
  [38, "&amp;"],
  [39, "&apos;"],
  [60, "&lt;"],
  [62, "&gt;"]
]);
var getCodePoint$1 = typeof String.prototype.codePointAt === "function" ? (input, index) => input.codePointAt(index) : (c, index) => (c.charCodeAt(index) & 64512) === 55296 ? (c.charCodeAt(index) - 55296) * 1024 + c.charCodeAt(index + 1) - 56320 + 65536 : c.charCodeAt(index);
var XML_BITSET_VALUE = 1342177476;
function encodeXML$1(input) {
  let out;
  let last = 0;
  const { length } = input;
  for (let index = 0; index < length; index++) {
    const char = input.charCodeAt(index);
    if (char < 128 && ((1342177476 >>> char & 1) === 0 || char >= 64 || char < 32)) continue;
    if (out === void 0) out = input.substring(0, index);
    else if (last !== index) out += input.substring(last, index);
    if (char < 64) {
      out += xmlCodeMap$1.get(char);
      last = index + 1;
      continue;
    }
    const cp = getCodePoint$1(input, index);
    out += `&#x${cp.toString(16)};`;
    if (cp !== char) index++;
    last = index + 1;
  }
  if (out === void 0) return input;
  if (last < length) out += input.substr(last);
  return out;
}
function getEscaper$1(regex, map) {
  return function escape(data) {
    let match5;
    let lastIndex = 0;
    let result = "";
    while (match5 = regex.exec(data)) {
      if (lastIndex !== match5.index) result += data.substring(lastIndex, match5.index);
      result += map.get(match5[0].charCodeAt(0));
      lastIndex = match5.index + 1;
    }
    return result + data.substring(lastIndex);
  };
}
var escapeUTF8$1 = /* @__PURE__ */ getEscaper$1(/["&'<>]/g, xmlCodeMap$1);
var escapeAttribute$1 = /* @__PURE__ */ getEscaper$1(/["&\u00A0]/g, /* @__PURE__ */ new Map([
  [34, "&quot;"],
  [38, "&amp;"],
  [160, "&nbsp;"]
]));
var escapeText$1 = /* @__PURE__ */ getEscaper$1(/[&<>\u00A0]/g, /* @__PURE__ */ new Map([
  [38, "&amp;"],
  [60, "&lt;"],
  [62, "&gt;"],
  [160, "&nbsp;"]
]));
function parseEncodeTrie(serialized) {
  const top = /* @__PURE__ */ new Map();
  const totalLength = serialized.length;
  let cursor = 0;
  let lastTopKey = -1;
  function readDiff() {
    const start = cursor;
    while (cursor < totalLength) {
      const char = serialized.charAt(cursor);
      if ((char < "0" || char > "9") && (char < "a" || char > "z")) break;
      cursor++;
    }
    if (cursor === start) return 0;
    return Number.parseInt(serialized.slice(start, cursor), 36);
  }
  function readEntity() {
    if (serialized[cursor] !== "&") throw new Error(`Child entry missing value near index ${cursor}`);
    const start = cursor;
    const end = serialized.indexOf(";", cursor + 1);
    if (end === -1) throw new Error(`Unterminated entity starting at index ${start}`);
    cursor = end + 1;
    return serialized.slice(start, cursor);
  }
  while (cursor < totalLength) {
    const keyDiff = readDiff();
    const key = lastTopKey === -1 ? keyDiff : lastTopKey + keyDiff + 1;
    let value;
    if (serialized[cursor] === "&") value = readEntity();
    if (serialized[cursor] === "{") {
      cursor++;
      let diff = readDiff();
      let childKey = diff;
      const firstValue = readEntity();
      if (serialized[cursor] === "{") throw new Error("Unexpected nested '{' beyond depth 2");
      if (serialized[cursor] === "}") {
        top.set(key, {
          value,
          next: childKey,
          nextValue: firstValue
        });
        cursor++;
      } else {
        const childMap = /* @__PURE__ */ new Map([[childKey, firstValue]]);
        let lastChildKey = childKey;
        while (cursor < totalLength && serialized[cursor] !== "}") {
          diff = readDiff();
          childKey = lastChildKey + diff + 1;
          const childValue = readEntity();
          if (serialized[cursor] === "{") throw new Error("Unexpected nested '{' beyond depth 2");
          childMap.set(childKey, childValue);
          lastChildKey = childKey;
        }
        if (serialized[cursor] !== "}") throw new Error("Unterminated child block");
        cursor++;
        top.set(key, {
          value,
          next: childMap
        });
      }
    } else if (value === void 0) throw new Error(`Malformed encode trie: missing value at index ${cursor}`);
    else top.set(key, value);
    lastTopKey = key;
  }
  return top;
}
var htmlTrie = /* @__PURE__ */ parseEncodeTrie("9&Tab;&NewLine;m&excl;&quot;&num;&dollar;&percnt;&amp;&apos;&lpar;&rpar;&ast;&plus;&comma;1&period;&sol;a&colon;&semi;&lt;{6he&nvlt;}&equals;{6hx&bne;}&gt;{6he&nvgt;}&quest;&commat;q&lbrack;&bsol;&rbrack;&Hat;&lowbar;&DiacriticalGrave;5{2y&fjlig;}k&lbrace;&verbar;&rbrace;y&nbsp;&iexcl;&cent;&pound;&curren;&yen;&brvbar;&sect;&die;&copy;&ordf;&laquo;&not;&shy;&circledR;&macr;&deg;&PlusMinus;&sup2;&sup3;&acute;&micro;&para;&centerdot;&cedil;&sup1;&ordm;&raquo;&frac14;&frac12;&frac34;&iquest;&Agrave;&Aacute;&Acirc;&Atilde;&Auml;&angst;&AElig;&Ccedil;&Egrave;&Eacute;&Ecirc;&Euml;&Igrave;&Iacute;&Icirc;&Iuml;&ETH;&Ntilde;&Ograve;&Oacute;&Ocirc;&Otilde;&Ouml;&times;&Oslash;&Ugrave;&Uacute;&Ucirc;&Uuml;&Yacute;&THORN;&szlig;&agrave;&aacute;&acirc;&atilde;&auml;&aring;&aelig;&ccedil;&egrave;&eacute;&ecirc;&euml;&igrave;&iacute;&icirc;&iuml;&eth;&ntilde;&ograve;&oacute;&ocirc;&otilde;&ouml;&div;&oslash;&ugrave;&uacute;&ucirc;&uuml;&yacute;&thorn;&yuml;&Amacr;&amacr;&Abreve;&abreve;&Aogon;&aogon;&Cacute;&cacute;&Ccirc;&ccirc;&Cdot;&cdot;&Ccaron;&ccaron;&Dcaron;&dcaron;&Dstrok;&dstrok;&Emacr;&emacr;2&Edot;&edot;&Eogon;&eogon;&Ecaron;&ecaron;&Gcirc;&gcirc;&Gbreve;&gbreve;&Gdot;&gdot;&Gcedil;1&Hcirc;&hcirc;&Hstrok;&hstrok;&Itilde;&itilde;&Imacr;&imacr;2&Iogon;&iogon;&Idot;&imath;&IJlig;&ijlig;&Jcirc;&jcirc;&Kcedil;&kcedil;&kgreen;&Lacute;&lacute;&Lcedil;&lcedil;&Lcaron;&lcaron;&Lmidot;&lmidot;&Lstrok;&lstrok;&Nacute;&nacute;&Ncedil;&ncedil;&Ncaron;&ncaron;&napos;&ENG;&eng;&Omacr;&omacr;2&Odblac;&odblac;&OElig;&oelig;&Racute;&racute;&Rcedil;&rcedil;&Rcaron;&rcaron;&Sacute;&sacute;&Scirc;&scirc;&Scedil;&scedil;&Scaron;&scaron;&Tcedil;&tcedil;&Tcaron;&tcaron;&Tstrok;&tstrok;&Utilde;&utilde;&Umacr;&umacr;&Ubreve;&ubreve;&Uring;&uring;&Udblac;&udblac;&Uogon;&uogon;&Wcirc;&wcirc;&Ycirc;&ycirc;&Yuml;&Zacute;&zacute;&Zdot;&zdot;&Zcaron;&zcaron;j&fnof;y&imped;1r&gacute;1t&jmath;3y&circ;&caron;g&breve;&DiacriticalDot;&ring;&ogon;&DiacriticalTilde;&dblac;1f&DownBreve;3j&Alpha;&Beta;&Gamma;&Delta;&Epsilon;&Zeta;&Eta;&Theta;&Iota;&Kappa;&Lambda;&Mu;&Nu;&Xi;&Omicron;&Pi;&Rho;1&Sigma;&Tau;&Upsilon;&Phi;&Chi;&Psi;&ohm;7&alpha;&beta;&gamma;&delta;&epsi;&zeta;&eta;&theta;&iota;&kappa;&lambda;&mu;&nu;&xi;&omicron;&pi;&rho;&sigmaf;&sigma;&tau;&upsi;&phi;&chi;&psi;&omega;7&thetasym;&Upsi;2&phiv;&piv;5&Gammad;&digamma;i&kappav;&rhov;3&epsiv;&backepsilon;a&IOcy;&DJcy;&GJcy;&Jukcy;&DScy;&Iukcy;&YIcy;&Jsercy;&LJcy;&NJcy;&TSHcy;&KJcy;1&Ubrcy;&DZcy;&Acy;&Bcy;&Vcy;&Gcy;&Dcy;&IEcy;&ZHcy;&Zcy;&Icy;&Jcy;&Kcy;&Lcy;&Mcy;&Ncy;&Ocy;&Pcy;&Rcy;&Scy;&Tcy;&Ucy;&Fcy;&KHcy;&TScy;&CHcy;&SHcy;&SHCHcy;&HARDcy;&Ycy;&SOFTcy;&Ecy;&YUcy;&YAcy;&acy;&bcy;&vcy;&gcy;&dcy;&iecy;&zhcy;&zcy;&icy;&jcy;&kcy;&lcy;&mcy;&ncy;&ocy;&pcy;&rcy;&scy;&tcy;&ucy;&fcy;&khcy;&tscy;&chcy;&shcy;&shchcy;&hardcy;&ycy;&softcy;&ecy;&yucy;&yacy;1&iocy;&djcy;&gjcy;&jukcy;&dscy;&iukcy;&yicy;&jsercy;&ljcy;&njcy;&tshcy;&kjcy;1&ubrcy;&dzcy;5gi&ensp;&emsp;&emsp13;&emsp14;1&numsp;&puncsp;&ThinSpace;&hairsp;&NegativeMediumSpace;&zwnj;&zwj;&lrm;&rlm;&dash;2&ndash;&mdash;&horbar;&Verbar;1&lsquo;&CloseCurlyQuote;&lsquor;1&ldquo;&CloseCurlyDoubleQuote;&bdquo;1&dagger;&Dagger;&bull;2&nldr;&hellip;9&permil;&pertenk;&prime;&Prime;&tprime;&backprime;3&lsaquo;&rsaquo;3&oline;2&caret;1&hybull;&frasl;a&bsemi;7&qprime;7&MediumSpace;{6bu&ThickSpace;}&NoBreak;&af;&InvisibleTimes;&ic;20&euro;1a&tdot;&DotDot;11&complexes;2&incare;4&gscr;&hamilt;&Hfr;&Hopf;&planckh;&hbar;&imagline;&Ifr;&lagran;&ell;1&naturals;&numero;&copysr;&weierp;&Popf;&Qopf;&realine;&real;&reals;&rx;3&trade;1&integers;2&mho;&zeetrf;&iiota;2&bernou;&Cayleys;1&escr;&Escr;&Fouriertrf;1&Mellintrf;&order;&alefsym;&beth;&gimel;&daleth;c&CapitalDifferentialD;&dd;&ee;&ii;a&frac13;&frac23;&frac15;&frac25;&frac35;&frac45;&frac16;&frac56;&frac18;&frac38;&frac58;&frac78;1d&larr;&ShortUpArrow;&rarr;&darr;&harr;&updownarrow;&nwarr;&nearr;&LowerRightArrow;&LowerLeftArrow;&nlarr;&nrarr;1&rarrw;{mw&nrarrw;}&Larr;&Uarr;&Rarr;&Darr;&larrtl;&rarrtl;&LeftTeeArrow;&mapstoup;&map;&DownTeeArrow;1&hookleftarrow;&hookrightarrow;&larrlp;&looparrowright;&harrw;&nharr;1&lsh;&rsh;&ldsh;&rdsh;1&crarr;&cularr;&curarr;2&circlearrowleft;&circlearrowright;&leftharpoonup;&DownLeftVector;&RightUpVector;&LeftUpVector;&rharu;&DownRightVector;&dharr;&dharl;&RightArrowLeftArrow;&udarr;&LeftArrowRightArrow;&leftleftarrows;&upuparrows;&rightrightarrows;&ddarr;&leftrightharpoons;&Equilibrium;&nlArr;&nhArr;&nrArr;&DoubleLeftArrow;&DoubleUpArrow;&DoubleRightArrow;&dArr;&DoubleLeftRightArrow;&DoubleUpDownArrow;&nwArr;&neArr;&seArr;&swArr;&lAarr;&rAarr;1&zigrarr;6&larrb;&rarrb;f&DownArrowUpArrow;7&loarr;&roarr;&hoarr;&forall;&comp;&part;{mw&npart;}&exist;&nexist;&empty;1&Del;&Element;&NotElement;1&ni;&notni;2&prod;&coprod;&sum;&minus;&MinusPlus;&dotplus;1&Backslash;&lowast;&compfn;1&radic;2&prop;&infin;&angrt;&ang;{6he&nang;}&angmsd;&angsph;&mid;&nmid;&DoubleVerticalBar;&NotDoubleVerticalBar;&and;&or;&cap;{1e68&caps;}&cup;{1e68&cups;}&int;&Int;&iiint;&conint;&Conint;&Cconint;&cwint;&ClockwiseContourIntegral;&awconint;&there4;&becaus;&ratio;&Colon;&dotminus;1&mDDot;&homtht;&sim;{6he&nvsim;}&backsim;{mp&race;}&ac;{mr&acE;}&acd;&VerticalTilde;&NotTilde;&eqsim;{mw&nesim;}&sime;&NotTildeEqual;&cong;&simne;&ncong;&ap;&nap;&ape;&apid;{mw&napid;}&backcong;&asympeq;{6he&nvap;}&bump;{mw&nbump;}&bumpe;{mw&nbumpe;}&doteq;{mw&nedot;}&doteqdot;&efDot;&erDot;&Assign;&ecolon;&ecir;&circeq;1&wedgeq;&veeeq;1&triangleq;2&equest;&ne;&Congruent;{6hx&bnequiv;}&nequiv;1&le;{6he&nvle;}&ge;{6he&nvge;}&lE;{mw&nlE;}&gE;{mw&ngE;}&lnE;{1e68&lvertneqq;}&gnE;{1e68&gvertneqq;}&ll;{mw&nLtv;5uh&nLt;}&gg;{mw&nGtv;5uh&nGt;}&between;&NotCupCap;&nless;&ngt;&nle;&nge;&lesssim;&GreaterTilde;&nlsim;&ngsim;&LessGreater;&gl;&NotLessGreater;&NotGreaterLess;&pr;&sc;&prcue;&sccue;&PrecedesTilde;&scsim;{mw&NotSucceedsTilde;}&NotPrecedes;&NotSucceeds;&sub;{6he&NotSubset;}&sup;{6he&NotSuperset;}&nsub;&nsup;&sube;&supe;&NotSubsetEqual;&NotSupersetEqual;&subne;{1e68&varsubsetneq;}&supne;{1e68&varsupsetneq;}1&cupdot;&UnionPlus;&sqsub;{mw&NotSquareSubset;}&sqsup;{mw&NotSquareSuperset;}&sqsube;&sqsupe;&sqcap;{1e68&sqcaps;}&sqcup;{1e68&sqcups;}&CirclePlus;&CircleMinus;&CircleTimes;&osol;&CircleDot;&circledcirc;&circledast;1&circleddash;&boxplus;&boxminus;&boxtimes;&dotsquare;&RightTee;&dashv;&DownTee;&bot;1&models;&DoubleRightTee;&Vdash;&Vvdash;&VDash;&nvdash;&nvDash;&nVdash;&nVDash;&prurel;1&LeftTriangle;&RightTriangle;&LeftTriangleEqual;{6he&nvltrie;}&RightTriangleEqual;{6he&nvrtrie;}&origof;&imof;&multimap;&hercon;&intcal;&veebar;1&barvee;&angrtvb;&lrtri;&bigwedge;&bigvee;&bigcap;&bigcup;&diam;&sdot;&sstarf;&divideontimes;&bowtie;&ltimes;&rtimes;&leftthreetimes;&rightthreetimes;&backsimeq;&curlyvee;&curlywedge;&Sub;&Sup;&Cap;&Cup;&fork;&epar;&lessdot;&gtdot;&Ll;{mw&nLl;}&Gg;{mw&nGg;}&leg;{1e68&lesg;}&gel;{1e68&gesl;}2&cuepr;&cuesc;&NotPrecedesSlantEqual;&NotSucceedsSlantEqual;&NotSquareSubsetEqual;&NotSquareSupersetEqual;2&lnsim;&gnsim;&precnsim;&scnsim;&nltri;&NotRightTriangle;&nltrie;&NotRightTriangleEqual;&vellip;&ctdot;&utdot;&dtdot;&disin;&isinsv;&isins;&isindot;{mw&notindot;}&notinvc;&notinvb;1&isinE;{mw&notinE;}&nisd;&xnis;&nis;&notnivc;&notnivb;6&barwed;&Barwed;1&lceil;&rceil;&LeftFloor;&rfloor;&drcrop;&dlcrop;&urcrop;&ulcrop;&bnot;1&profline;&profsurf;1&telrec;&target;5&ulcorn;&urcorn;&dlcorn;&drcorn;2&frown;&smile;9&cylcty;&profalar;7&topbot;6&ovbar;1&solbar;1o&angzarr;1f&lmoustache;&rmoustache;2&OverBracket;&bbrk;&bbrktbrk;11&OverParenthesis;&UnderParenthesis;&OverBrace;&UnderBrace;2&trpezium;4&elinters;1n&blank;4k&circledS;1j&boxh;1&boxv;9&boxdr;3&boxdl;3&boxur;3&boxul;3&boxvr;7&boxvl;7&boxhd;7&boxhu;7&boxvh;j&boxH;&boxV;&boxdR;&boxDr;&boxDR;&boxdL;&boxDl;&boxDL;&boxuR;&boxUr;&boxUR;&boxuL;&boxUl;&boxUL;&boxvR;&boxVr;&boxVR;&boxvL;&boxVl;&boxVL;&boxHd;&boxhD;&boxHD;&boxHu;&boxhU;&boxHU;&boxvH;&boxVh;&boxVH;j&uhblk;3&lhblk;3&block;8&blk14;&blk12;&blk34;d&square;8&blacksquare;&EmptyVerySmallSquare;1&rect;&marker;2&fltns;1&bigtriangleup;&blacktriangle;&triangle;2&blacktriangleright;&rtri;3&bigtriangledown;&blacktriangledown;&dtri;2&blacktriangleleft;&ltri;6&loz;&cir;w&tridot;2&bigcirc;8&ultri;&urtri;&lltri;&EmptySmallSquare;&FilledSmallSquare;8&bigstar;&star;7&phone;1d&female;1&male;t&spades;2&clubs;1&hearts;&diamondsuit;3&sung;2&flat;&natural;&sharp;4j&check;3&cross;8&malt;l&sext;x&VerticalSeparator;p&lbbrk;&rbbrk;2c&bsolhsub;&suphsol;s&LeftDoubleBracket;&RightDoubleBracket;&lang;&rang;&Lang;&Rang;&loang;&roang;7&longleftarrow;&longrightarrow;&longleftrightarrow;&DoubleLongLeftArrow;&DoubleLongRightArrow;&DoubleLongLeftRightArrow;1&longmapsto;2&dzigrarr;76&nvlArr;&nvrArr;&nvHarr;&Map;6&lbarr;&bkarow;&lBarr;&dbkarow;&drbkarow;&DDotrahd;&UpArrowBar;&DownArrowBar;2&Rarrtl;2&latail;&ratail;&lAtail;&rAtail;&larrfs;&rarrfs;&larrbfs;&rarrbfs;2&nwarhk;&nearhk;&hksearow;&hkswarow;&nwnear;&nesear;&seswar;&swnwar;8&rarrc;{mw&nrarrc;}1&cudarrr;&ldca;&rdca;&cudarrl;&larrpl;2&curarrm;&cularrp;7&rarrpl;2&harrcir;&Uarrocir;&lurdshar;&ldrushar;2&LeftRightVector;&RightUpDownVector;&DownLeftRightVector;&LeftUpDownVector;&LeftVectorBar;&RightVectorBar;&RightUpVectorBar;&RightDownVectorBar;&DownLeftVectorBar;&DownRightVectorBar;&LeftUpVectorBar;&LeftDownVectorBar;&LeftTeeVector;&RightTeeVector;&RightUpTeeVector;&RightDownTeeVector;&DownLeftTeeVector;&DownRightTeeVector;&LeftUpTeeVector;&LeftDownTeeVector;&lHar;&uHar;&rHar;&dHar;&luruhar;&ldrdhar;&ruluhar;&rdldhar;&lharul;&llhard;&rharul;&lrhard;&udhar;&duhar;&RoundImplies;&erarr;&simrarr;&larrsim;&rarrsim;&rarrap;&ltlarr;1&gtrarr;&subrarr;1&suplarr;&lfisht;&rfisht;&ufisht;&dfisht;5&lopar;&ropar;4&lbrke;&rbrke;&lbrkslu;&rbrksld;&lbrksld;&rbrkslu;&langd;&rangd;&lparlt;&rpargt;&gtlPar;&ltrPar;3&vzigzag;1&vangrt;&angrtvbd;6&ange;&range;&dwangle;&uwangle;&angmsdaa;&angmsdab;&angmsdac;&angmsdad;&angmsdae;&angmsdaf;&angmsdag;&angmsdah;&bemptyv;&demptyv;&cemptyv;&raemptyv;&laemptyv;&ohbar;&omid;&opar;1&operp;1&olcross;&odsold;1&olcir;&ofcir;&olt;&ogt;&cirscir;&cirE;&solb;&bsolb;3&boxbox;3&trisb;&rtriltri;&LeftTriangleBar;{mw&NotLeftTriangleBar;}&RightTriangleBar;{mw&NotRightTriangleBar;}b&iinfin;&infintie;&nvinfin;4&eparsl;&smeparsl;&eqvparsl;5&blacklozenge;8&RuleDelayed;1&dsol;9&bigodot;&bigoplus;&bigotimes;1&biguplus;1&bigsqcup;5&iiiint;&fpartint;2&cirfnint;&awint;&rppolint;&scpolint;&npolint;&pointint;&quatint;&intlarhk;a&pluscir;&plusacir;&simplus;&plusdu;&plussim;&plustwo;1&mcomma;&minusdu;2&loplus;&roplus;&Cross;&timesd;&timesbar;1&smashp;&lotimes;&rotimes;&otimesas;&Otimes;&odiv;&triplus;&triminus;&tritime;&intprod;2&amalg;&capdot;1&ncup;&ncap;&capand;&cupor;&cupcap;&capcup;&cupbrcap;&capbrcup;&cupcup;&capcap;&ccups;&ccaps;2&ccupssm;2&And;&Or;&andand;&oror;&orslope;&andslope;1&andv;&orv;&andd;&ord;1&wedbar;6&sdote;3&simdot;2&congdot;{mw&ncongdot;}&easter;&apacir;&apE;{mw&napE;}&eplus;&pluse;&Esim;&Colone;&Equal;1&ddotseq;&equivDD;&ltcir;&gtcir;&ltquest;&gtquest;&leqslant;{mw&nleqslant;}&geqslant;{mw&ngeqslant;}&lesdot;&gesdot;&lesdoto;&gesdoto;&lesdotor;&gesdotol;&lap;&gap;&lne;&gne;&lnap;&gnap;&lEg;&gEl;&lsime;&gsime;&lsimg;&gsiml;&lgE;&glE;&lesges;&gesles;&els;&egs;&elsdot;&egsdot;&el;&eg;2&siml;&simg;&simlE;&simgE;&LessLess;{mw&NotNestedLessLess;}&GreaterGreater;{mw&NotNestedGreaterGreater;}1&glj;&gla;&ltcc;&gtcc;&lescc;&gescc;&smt;&lat;&smte;{1e68&smtes;}&late;{1e68&lates;}&bumpE;&PrecedesEqual;{mw&NotPrecedesEqual;}&sce;{mw&NotSucceedsEqual;}2&prE;&scE;&precneqq;&scnE;&prap;&scap;&precnapprox;&scnap;&Pr;&Sc;&subdot;&supdot;&subplus;&supplus;&submult;&supmult;&subedot;&supedot;&subE;{mw&nsubE;}&supE;{mw&nsupE;}&subsim;&supsim;2&subnE;{1e68&varsubsetneqq;}&supnE;{1e68&varsupsetneqq;}2&csub;&csup;&csube;&csupe;&subsup;&supsub;&subsub;&supsup;&suphsub;&supdsub;&forkv;&topfork;&mlcp;8&Dashv;1&Vdashl;&Barv;&vBar;&vBarv;1&Vbar;&Not;&bNot;&rnmid;&cirmid;&midcir;&topcir;&nhpar;&parsim;9&parsl;{6hx&nparsl;}y7r{17ks&Ascr;1&Cscr;&Dscr;2&Gscr;2&Jscr;&Kscr;2&Nscr;&Oscr;&Pscr;&Qscr;1&Sscr;&Tscr;&Uscr;&Vscr;&Wscr;&Xscr;&Yscr;&Zscr;&ascr;&bscr;&cscr;&dscr;1&fscr;1&hscr;&iscr;&jscr;&kscr;&lscr;&mscr;&nscr;1&pscr;&qscr;&rscr;&sscr;&tscr;&uscr;&vscr;&wscr;&xscr;&yscr;&zscr;1g&Afr;&Bfr;1&Dfr;&Efr;&Ffr;&Gfr;2&Jfr;&Kfr;&Lfr;&Mfr;&Nfr;&Ofr;&Pfr;&Qfr;1&Sfr;&Tfr;&Ufr;&Vfr;&Wfr;&Xfr;&Yfr;1&afr;&bfr;&cfr;&dfr;&efr;&ffr;&gfr;&hfr;&ifr;&jfr;&kfr;&lfr;&mfr;&nfr;&ofr;&pfr;&qfr;&rfr;&sfr;&tfr;&ufr;&vfr;&wfr;&xfr;&yfr;&zfr;&Aopf;&Bopf;1&Dopf;&Eopf;&Fopf;&Gopf;1&Iopf;&Jopf;&Kopf;&Lopf;&Mopf;1&Oopf;3&Sopf;&Topf;&Uopf;&Vopf;&Wopf;&Xopf;&Yopf;1&aopf;&bopf;&copf;&dopf;&eopf;&fopf;&gopf;&hopf;&iopf;&jopf;&kopf;&lopf;&mopf;&nopf;&oopf;&popf;&qopf;&ropf;&sopf;&topf;&uopf;&vopf;&wopf;&xopf;&yopf;&zopf;}6ve&fflig;&filig;&fllig;&ffilig;&ffllig;");
var HTML_BITSET = /* @__PURE__ */ new Uint32Array([
  5632,
  4227923966,
  4160749569,
  939524097
]);
var XML_BITSET = /* @__PURE__ */ new Uint32Array([
  0,
  XML_BITSET_VALUE,
  0,
  0
]);
function encodeHTML(input) {
  return encodeHTMLTrieRe(HTML_BITSET, input);
}
function encodeNonAsciiHTML(input) {
  return encodeHTMLTrieRe(XML_BITSET, input);
}
function encodeHTMLTrieRe(bitset, input) {
  let out;
  let last = 0;
  const { length } = input;
  for (let index = 0; index < length; index++) {
    const char = input.charCodeAt(index);
    if (char < 128 && !(bitset[char >>> 5] >>> char & 1)) continue;
    if (out === void 0) out = input.substring(0, index);
    else if (last !== index) out += input.substring(last, index);
    let node = htmlTrie.get(char);
    if (typeof node === "object") {
      if (index + 1 < length) {
        const nextChar = input.charCodeAt(index + 1);
        const value = typeof node.next === "number" ? node.next === nextChar ? node.nextValue : void 0 : node.next.get(nextChar);
        if (value !== void 0) {
          out += value;
          index++;
          last = index + 1;
          continue;
        }
      }
      node = node.value;
    }
    if (node === void 0) {
      const cp = getCodePoint$1(input, index);
      out += `&#x${cp.toString(16)};`;
      if (cp !== char) index++;
      last = index + 1;
    } else {
      out += node;
      last = index + 1;
    }
  }
  if (out === void 0) return input;
  if (last < length) out += input.substr(last);
  return out;
}
var EntityLevel;
(function(EntityLevel2) {
  EntityLevel2[EntityLevel2["XML"] = 0] = "XML";
  EntityLevel2[EntityLevel2["HTML"] = 1] = "HTML";
})(EntityLevel || (EntityLevel = {}));
var EncodingMode;
(function(EncodingMode2) {
  EncodingMode2[EncodingMode2["UTF8"] = 0] = "UTF8";
  EncodingMode2[EncodingMode2["ASCII"] = 1] = "ASCII";
  EncodingMode2[EncodingMode2["Extensive"] = 2] = "Extensive";
  EncodingMode2[EncodingMode2["Attribute"] = 3] = "Attribute";
  EncodingMode2[EncodingMode2["Text"] = 4] = "Text";
})(EncodingMode || (EncodingMode = {}));
function encode(input, options = EntityLevel.XML) {
  const { mode = EncodingMode.Extensive, level = EntityLevel.XML } = typeof options === "number" ? { level: options } : options;
  switch (mode) {
    case EncodingMode.UTF8:
      return escapeUTF8$1(input);
    case EncodingMode.Attribute:
      return escapeAttribute$1(input);
    case EncodingMode.Text:
      return escapeText$1(input);
    case EncodingMode.ASCII:
      return level === EntityLevel.HTML ? encodeNonAsciiHTML(input) : encodeXML$1(input);
    case EncodingMode.Extensive:
    default:
      return level === EntityLevel.HTML ? encodeHTML(input) : encodeXML$1(input);
  }
}
var Node = class {
  constructor(parentNode = null, range2) {
    this.parentNode = parentNode;
    this.childNodes = [];
    Object.defineProperty(this, "range", {
      enumerable: false,
      writable: true,
      configurable: true,
      value: range2 !== null && range2 !== void 0 ? range2 : [-1, -1]
    });
  }
  /**
  * Remove current node
  */
  remove() {
    if (this.parentNode) {
      const children = this.parentNode.childNodes;
      this.parentNode.childNodes = children.filter((child) => {
        return this !== child;
      });
      this.parentNode = null;
    }
    return this;
  }
  get innerText() {
    return this.rawText;
  }
  get textContent() {
    return decodeHTML(this.rawText);
  }
  set textContent(val) {
    this.rawText = encode(val);
  }
};
var NodeType = /* @__PURE__ */ (function(NodeType2) {
  NodeType2[NodeType2["ELEMENT_NODE"] = 1] = "ELEMENT_NODE";
  NodeType2[NodeType2["TEXT_NODE"] = 3] = "TEXT_NODE";
  NodeType2[NodeType2["COMMENT_NODE"] = 8] = "COMMENT_NODE";
  return NodeType2;
})(NodeType || {});
var CommentNode = class CommentNode2 extends Node {
  clone() {
    return new CommentNode2(this.rawText, null, void 0, this.rawTagName);
  }
  constructor(rawText, parentNode = null, range2, rawTagName = "!--") {
    super(parentNode, range2);
    this.rawText = rawText;
    this.rawTagName = rawTagName;
    this.nodeType = 8;
  }
  /**
  * Get unescaped text value of current node and its children.
  * @return {string} text content
  */
  get text() {
    return this.rawText;
  }
  toString() {
    return `<!--${this.rawText}-->`;
  }
};
var ElementType;
(function(ElementType2) {
  ElementType2["Root"] = "root";
  ElementType2["Text"] = "text";
  ElementType2["Directive"] = "directive";
  ElementType2["Comment"] = "comment";
  ElementType2["Script"] = "script";
  ElementType2["Style"] = "style";
  ElementType2["Tag"] = "tag";
  ElementType2["CDATA"] = "cdata";
  ElementType2["Doctype"] = "doctype";
})(ElementType || (ElementType = {}));
function isTag$2(elem) {
  return elem.type === ElementType.Tag || elem.type === ElementType.Script || elem.type === ElementType.Style;
}
var Root = ElementType.Root;
var Text = ElementType.Text;
var Directive = ElementType.Directive;
var Comment = ElementType.Comment;
var Script = ElementType.Script;
var Style = ElementType.Style;
var Tag = ElementType.Tag;
var CDATA = ElementType.CDATA;
var Doctype = ElementType.Doctype;
function ownKeys(e, r) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o = Object.getOwnPropertySymbols(e);
    r && (o = o.filter(function(r2) {
      return Object.getOwnPropertyDescriptor(e, r2).enumerable;
    })), t.push.apply(t, o);
  }
  return t;
}
function _objectSpread2(e) {
  for (var r = 1; r < arguments.length; r++) {
    var t = null != arguments[r] ? arguments[r] : {};
    r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
      _defineProperty(e, r2, t[r2]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
      Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
    });
  }
  return e;
}
function isTag$1(node) {
  return isTag$2(node);
}
function isCDATA(node) {
  return node.type === ElementType.CDATA;
}
function isText(node) {
  return node.type === ElementType.Text;
}
function isComment(node) {
  return node.type === ElementType.Comment;
}
function isDocument(node) {
  return node.type === ElementType.Root;
}
function hasChildren(node) {
  return Object.prototype.hasOwnProperty.call(node, "children");
}
var xmlReplacer = /["&'<>$\x80-\uFFFF]/g;
var xmlCodeMap = /* @__PURE__ */ new Map([
  [34, "&quot;"],
  [38, "&amp;"],
  [39, "&apos;"],
  [60, "&lt;"],
  [62, "&gt;"]
]);
var getCodePoint = String.prototype.codePointAt != null ? (str, index) => str.codePointAt(index) : (c, index) => (c.charCodeAt(index) & 64512) === 55296 ? (c.charCodeAt(index) - 55296) * 1024 + c.charCodeAt(index + 1) - 56320 + 65536 : c.charCodeAt(index);
function encodeXML(str) {
  let ret = "";
  let lastIdx = 0;
  let match5;
  while ((match5 = xmlReplacer.exec(str)) !== null) {
    const i = match5.index;
    const char = str.charCodeAt(i);
    const next = xmlCodeMap.get(char);
    if (next !== void 0) {
      ret += str.substring(lastIdx, i) + next;
      lastIdx = i + 1;
    } else {
      ret += `${str.substring(lastIdx, i)}&#x${getCodePoint(str, i).toString(16)};`;
      lastIdx = xmlReplacer.lastIndex += Number((char & 64512) === 55296);
    }
  }
  return ret + str.substr(lastIdx);
}
function getEscaper(regex, map) {
  return function escape(data) {
    let match5;
    let lastIdx = 0;
    let result = "";
    while (match5 = regex.exec(data)) {
      if (lastIdx !== match5.index) result += data.substring(lastIdx, match5.index);
      result += map.get(match5[0].charCodeAt(0));
      lastIdx = match5.index + 1;
    }
    return result + data.substring(lastIdx);
  };
}
var escapeAttribute = getEscaper(/["&\u00A0]/g, /* @__PURE__ */ new Map([
  [34, "&quot;"],
  [38, "&amp;"],
  [160, "&nbsp;"]
]));
var escapeText = getEscaper(/[&<>\u00A0]/g, /* @__PURE__ */ new Map([
  [38, "&amp;"],
  [60, "&lt;"],
  [62, "&gt;"],
  [160, "&nbsp;"]
]));
var elementNames = new Map([
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "clipPath",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "glyphRef",
  "linearGradient",
  "radialGradient",
  "textPath"
].map((val) => [val.toLowerCase(), val]));
var attributeNames = new Map([
  "definitionURL",
  "attributeName",
  "attributeType",
  "baseFrequency",
  "baseProfile",
  "calcMode",
  "clipPathUnits",
  "diffuseConstant",
  "edgeMode",
  "filterUnits",
  "glyphRef",
  "gradientTransform",
  "gradientUnits",
  "kernelMatrix",
  "kernelUnitLength",
  "keyPoints",
  "keySplines",
  "keyTimes",
  "lengthAdjust",
  "limitingConeAngle",
  "markerHeight",
  "markerUnits",
  "markerWidth",
  "maskContentUnits",
  "maskUnits",
  "numOctaves",
  "pathLength",
  "patternContentUnits",
  "patternTransform",
  "patternUnits",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "preserveAlpha",
  "preserveAspectRatio",
  "primitiveUnits",
  "refX",
  "refY",
  "repeatCount",
  "repeatDur",
  "requiredExtensions",
  "requiredFeatures",
  "specularConstant",
  "specularExponent",
  "spreadMethod",
  "startOffset",
  "stdDeviation",
  "stitchTiles",
  "surfaceScale",
  "systemLanguage",
  "tableValues",
  "targetX",
  "targetY",
  "textLength",
  "viewBox",
  "viewTarget",
  "xChannelSelector",
  "yChannelSelector",
  "zoomAndPan"
].map((val) => [val.toLowerCase(), val]));
var unencodedElements = /* @__PURE__ */ new Set([
  "style",
  "script",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "noscript"
]);
function replaceQuotes(value) {
  return value.replace(/"/g, "&quot;");
}
function formatAttributes(attributes2, opts) {
  var _a;
  if (!attributes2) return;
  const encode2 = ((_a = opts.encodeEntities) !== null && _a !== void 0 ? _a : opts.decodeEntities) === false ? replaceQuotes : opts.xmlMode || opts.encodeEntities !== "utf8" ? encodeXML : escapeAttribute;
  return Object.keys(attributes2).map((key) => {
    var _a2, _b;
    const value = (_a2 = attributes2[key]) !== null && _a2 !== void 0 ? _a2 : "";
    if (opts.xmlMode === "foreign") key = (_b = attributeNames.get(key)) !== null && _b !== void 0 ? _b : key;
    if (!opts.emptyAttrs && !opts.xmlMode && value === "") return key;
    return `${key}="${encode2(value)}"`;
  }).join(" ");
}
var singleTag = /* @__PURE__ */ new Set([
  "area",
  "base",
  "basefont",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "isindex",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
function render(node, options = {}) {
  const nodes = "length" in node ? node : [node];
  let output = "";
  for (let i = 0; i < nodes.length; i++) output += renderNode(nodes[i], options);
  return output;
}
function renderNode(node, options) {
  switch (node.type) {
    case Root:
      return render(node.children, options);
    case Doctype:
    case Directive:
      return renderDirective(node);
    case Comment:
      return renderComment(node);
    case CDATA:
      return renderCdata(node);
    case Script:
    case Style:
    case Tag:
      return renderTag(node, options);
    case Text:
      return renderText(node, options);
  }
}
var foreignModeIntegrationPoints = /* @__PURE__ */ new Set([
  "mi",
  "mo",
  "mn",
  "ms",
  "mtext",
  "annotation-xml",
  "foreignObject",
  "desc",
  "title"
]);
var foreignElements = /* @__PURE__ */ new Set(["svg", "math"]);
function renderTag(elem, opts) {
  var _a;
  if (opts.xmlMode === "foreign") {
    elem.name = (_a = elementNames.get(elem.name)) !== null && _a !== void 0 ? _a : elem.name;
    if (elem.parent && foreignModeIntegrationPoints.has(elem.parent.name)) opts = _objectSpread2(_objectSpread2({}, opts), {}, { xmlMode: false });
  }
  if (!opts.xmlMode && foreignElements.has(elem.name)) opts = _objectSpread2(_objectSpread2({}, opts), {}, { xmlMode: "foreign" });
  let tag = `<${elem.name}`;
  const attribs = formatAttributes(elem.attribs, opts);
  if (attribs) tag += ` ${attribs}`;
  if (elem.children.length === 0 && (opts.xmlMode ? opts.selfClosingTags !== false : opts.selfClosingTags && singleTag.has(elem.name))) {
    if (!opts.xmlMode) tag += " ";
    tag += "/>";
  } else {
    tag += ">";
    if (elem.children.length > 0) tag += render(elem.children, opts);
    if (opts.xmlMode || !singleTag.has(elem.name)) tag += `</${elem.name}>`;
  }
  return tag;
}
function renderDirective(elem) {
  return `<${elem.data}>`;
}
function renderText(elem, opts) {
  var _a;
  let data = elem.data || "";
  if (((_a = opts.encodeEntities) !== null && _a !== void 0 ? _a : opts.decodeEntities) !== false && !(!opts.xmlMode && elem.parent && unencodedElements.has(elem.parent.name))) data = opts.xmlMode || opts.encodeEntities !== "utf8" ? encodeXML(data) : escapeText(data);
  return data;
}
function renderCdata(elem) {
  return `<![CDATA[${elem.children[0].data}]]>`;
}
function renderComment(elem) {
  return `<!--${elem.data}-->`;
}
function getOuterHTML(node, options) {
  return render(node, options);
}
function getInnerHTML(node, options) {
  return hasChildren(node) ? node.children.map((node2) => getOuterHTML(node2, options)).join("") : "";
}
function getText$1(node) {
  if (Array.isArray(node)) return node.map(getText$1).join("");
  if (isTag$1(node)) return node.name === "br" ? "\n" : getText$1(node.children);
  if (isCDATA(node)) return getText$1(node.children);
  if (isText(node)) return node.data;
  return "";
}
function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (hasChildren(node) && !isComment(node)) return textContent(node.children);
  if (isText(node)) return node.data;
  return "";
}
function innerText(node) {
  if (Array.isArray(node)) return node.map(innerText).join("");
  if (hasChildren(node) && (node.type === ElementType.Tag || isCDATA(node))) return innerText(node.children);
  if (isText(node)) return node.data;
  return "";
}
function getChildren$1(elem) {
  return hasChildren(elem) ? elem.children : [];
}
function getParent$1(elem) {
  return elem.parent || null;
}
function getSiblings$1(elem) {
  const parent = getParent$1(elem);
  if (parent != null) return getChildren$1(parent);
  const siblings = [elem];
  let { prev, next } = elem;
  while (prev != null) {
    siblings.unshift(prev);
    ({ prev } = prev);
  }
  while (next != null) {
    siblings.push(next);
    ({ next } = next);
  }
  return siblings;
}
function getAttributeValue$1(elem, name) {
  var _a;
  return (_a = elem.attribs) === null || _a === void 0 ? void 0 : _a[name];
}
function hasAttrib$1(elem, name) {
  return elem.attribs != null && Object.prototype.hasOwnProperty.call(elem.attribs, name) && elem.attribs[name] != null;
}
function getName$1(elem) {
  return elem.name;
}
function nextElementSibling(elem) {
  let { next } = elem;
  while (next !== null && !isTag$1(next)) ({ next } = next);
  return next;
}
function prevElementSibling(elem) {
  let { prev } = elem;
  while (prev !== null && !isTag$1(prev)) ({ prev } = prev);
  return prev;
}
function removeElement(elem) {
  if (elem.prev) elem.prev.next = elem.next;
  if (elem.next) elem.next.prev = elem.prev;
  if (elem.parent) {
    const childs = elem.parent.children;
    const childsIndex = childs.lastIndexOf(elem);
    if (childsIndex >= 0) childs.splice(childsIndex, 1);
  }
  elem.next = null;
  elem.prev = null;
  elem.parent = null;
}
function replaceElement(elem, replacement) {
  const prev = replacement.prev = elem.prev;
  if (prev) prev.next = replacement;
  const next = replacement.next = elem.next;
  if (next) next.prev = replacement;
  const parent = replacement.parent = elem.parent;
  if (parent) {
    const childs = parent.children;
    childs[childs.lastIndexOf(elem)] = replacement;
    elem.parent = null;
  }
}
function appendChild(parent, child) {
  removeElement(child);
  child.next = null;
  child.parent = parent;
  if (parent.children.push(child) > 1) {
    const sibling = parent.children[parent.children.length - 2];
    sibling.next = child;
    child.prev = sibling;
  } else child.prev = null;
}
function append(elem, next) {
  removeElement(next);
  const { parent } = elem;
  const currNext = elem.next;
  next.next = currNext;
  next.prev = elem;
  elem.next = next;
  next.parent = parent;
  if (currNext) {
    currNext.prev = next;
    if (parent) {
      const childs = parent.children;
      childs.splice(childs.lastIndexOf(currNext), 0, next);
    }
  } else if (parent) parent.children.push(next);
}
function prependChild(parent, child) {
  removeElement(child);
  child.parent = parent;
  child.prev = null;
  if (parent.children.unshift(child) !== 1) {
    const sibling = parent.children[1];
    sibling.prev = child;
    child.next = sibling;
  } else child.next = null;
}
function prepend(elem, prev) {
  removeElement(prev);
  const { parent } = elem;
  if (parent) {
    const childs = parent.children;
    childs.splice(childs.indexOf(elem), 0, prev);
  }
  if (elem.prev) elem.prev.next = prev;
  prev.parent = parent;
  prev.prev = elem.prev;
  prev.next = elem;
  elem.prev = prev;
}
function filter(test, node, recurse = true, limit = Infinity) {
  return find(test, Array.isArray(node) ? node : [node], recurse, limit);
}
function find(test, nodes, recurse, limit) {
  const result = [];
  const nodeStack = [Array.isArray(nodes) ? nodes : [nodes]];
  const indexStack = [0];
  for (; ; ) {
    if (indexStack[0] >= nodeStack[0].length) {
      if (indexStack.length === 1) return result;
      nodeStack.shift();
      indexStack.shift();
      continue;
    }
    const elem = nodeStack[0][indexStack[0]++];
    if (test(elem)) {
      result.push(elem);
      if (--limit <= 0) return result;
    }
    if (recurse && hasChildren(elem) && elem.children.length > 0) {
      indexStack.unshift(0);
      nodeStack.unshift(elem.children);
    }
  }
}
function findOneChild(test, nodes) {
  return nodes.find(test);
}
function findOne$1(test, nodes, recurse = true) {
  const searchedNodes = Array.isArray(nodes) ? nodes : [nodes];
  for (let i = 0; i < searchedNodes.length; i++) {
    const node = searchedNodes[i];
    if (isTag$1(node) && test(node)) return node;
    if (recurse && hasChildren(node) && node.children.length > 0) {
      const found = findOne$1(test, node.children, true);
      if (found) return found;
    }
  }
  return null;
}
function existsOne$1(test, nodes) {
  return (Array.isArray(nodes) ? nodes : [nodes]).some((node) => isTag$1(node) && test(node) || hasChildren(node) && existsOne$1(test, node.children));
}
function findAll$1(test, nodes) {
  const result = [];
  const nodeStack = [Array.isArray(nodes) ? nodes : [nodes]];
  const indexStack = [0];
  for (; ; ) {
    if (indexStack[0] >= nodeStack[0].length) {
      if (nodeStack.length === 1) return result;
      nodeStack.shift();
      indexStack.shift();
      continue;
    }
    const elem = nodeStack[0][indexStack[0]++];
    if (isTag$1(elem) && test(elem)) result.push(elem);
    if (hasChildren(elem) && elem.children.length > 0) {
      indexStack.unshift(0);
      nodeStack.unshift(elem.children);
    }
  }
}
var Checks = {
  tag_name(name) {
    if (typeof name === "function") return (elem) => isTag$1(elem) && name(elem.name);
    else if (name === "*") return isTag$1;
    return (elem) => isTag$1(elem) && elem.name === name;
  },
  tag_type(type) {
    if (typeof type === "function") return (elem) => type(elem.type);
    return (elem) => elem.type === type;
  },
  tag_contains(data) {
    if (typeof data === "function") return (elem) => isText(elem) && data(elem.data);
    return (elem) => isText(elem) && elem.data === data;
  }
};
function getAttribCheck(attrib, value) {
  if (typeof value === "function") return (elem) => isTag$1(elem) && value(elem.attribs[attrib]);
  return (elem) => isTag$1(elem) && elem.attribs[attrib] === value;
}
function combineFuncs(a, b) {
  return (elem) => a(elem) || b(elem);
}
function compileTest(options) {
  const funcs = Object.keys(options).map((key) => {
    const value = options[key];
    return Object.prototype.hasOwnProperty.call(Checks, key) ? Checks[key](value) : getAttribCheck(key, value);
  });
  return funcs.length === 0 ? null : funcs.reduce(combineFuncs);
}
function testElement(options, node) {
  const test = compileTest(options);
  return test ? test(node) : true;
}
function getElements(options, nodes, recurse, limit = Infinity) {
  const test = compileTest(options);
  return test ? filter(test, nodes, recurse, limit) : [];
}
function getElementById(id, nodes, recurse = true) {
  if (!Array.isArray(nodes)) nodes = [nodes];
  return findOne$1(getAttribCheck("id", id), nodes, recurse);
}
function getElementsByTagName(tagName, nodes, recurse = true, limit = Infinity) {
  return filter(Checks["tag_name"](tagName), nodes, recurse, limit);
}
function getElementsByClassName(className, nodes, recurse = true, limit = Infinity) {
  return filter(getAttribCheck("class", className), nodes, recurse, limit);
}
function getElementsByTagType(type, nodes, recurse = true, limit = Infinity) {
  return filter(Checks["tag_type"](type), nodes, recurse, limit);
}
function removeSubsets$1(nodes) {
  let idx = nodes.length;
  while (--idx >= 0) {
    const node = nodes[idx];
    if (idx > 0 && nodes.lastIndexOf(node, idx - 1) >= 0) {
      nodes.splice(idx, 1);
      continue;
    }
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) if (nodes.includes(ancestor)) {
      nodes.splice(idx, 1);
      break;
    }
  }
  return nodes;
}
var DocumentPosition;
(function(DocumentPosition2) {
  DocumentPosition2[DocumentPosition2["DISCONNECTED"] = 1] = "DISCONNECTED";
  DocumentPosition2[DocumentPosition2["PRECEDING"] = 2] = "PRECEDING";
  DocumentPosition2[DocumentPosition2["FOLLOWING"] = 4] = "FOLLOWING";
  DocumentPosition2[DocumentPosition2["CONTAINS"] = 8] = "CONTAINS";
  DocumentPosition2[DocumentPosition2["CONTAINED_BY"] = 16] = "CONTAINED_BY";
})(DocumentPosition || (DocumentPosition = {}));
function compareDocumentPosition(nodeA, nodeB) {
  const aParents = [];
  const bParents = [];
  if (nodeA === nodeB) return 0;
  let current = hasChildren(nodeA) ? nodeA : nodeA.parent;
  while (current) {
    aParents.unshift(current);
    current = current.parent;
  }
  current = hasChildren(nodeB) ? nodeB : nodeB.parent;
  while (current) {
    bParents.unshift(current);
    current = current.parent;
  }
  const maxIdx = Math.min(aParents.length, bParents.length);
  let idx = 0;
  while (idx < maxIdx && aParents[idx] === bParents[idx]) idx++;
  if (idx === 0) return DocumentPosition.DISCONNECTED;
  const sharedParent = aParents[idx - 1];
  const siblings = sharedParent.children;
  const aSibling = aParents[idx];
  const bSibling = bParents[idx];
  if (siblings.indexOf(aSibling) > siblings.indexOf(bSibling)) {
    if (sharedParent === nodeB) return DocumentPosition.FOLLOWING | DocumentPosition.CONTAINED_BY;
    return DocumentPosition.FOLLOWING;
  }
  if (sharedParent === nodeA) return DocumentPosition.PRECEDING | DocumentPosition.CONTAINS;
  return DocumentPosition.PRECEDING;
}
function uniqueSort(nodes) {
  nodes = nodes.filter((node, i, arr) => !arr.includes(node, i + 1));
  nodes.sort((a, b) => {
    const relative = compareDocumentPosition(a, b);
    if (relative & DocumentPosition.PRECEDING) return -1;
    else if (relative & DocumentPosition.FOLLOWING) return 1;
    return 0;
  });
  return nodes;
}
function getFeed(doc) {
  const feedRoot = getOneElement(isValidFeed, doc);
  return !feedRoot ? null : feedRoot.name === "feed" ? getAtomFeed(feedRoot) : getRssFeed(feedRoot);
}
function getAtomFeed(feedRoot) {
  var _a;
  const childs = feedRoot.children;
  const feed = {
    type: "atom",
    items: getElementsByTagName("entry", childs).map((item) => {
      var _a2;
      const { children } = item;
      const entry = { media: getMediaElements(children) };
      addConditionally(entry, "id", "id", children);
      addConditionally(entry, "title", "title", children);
      const href2 = (_a2 = getOneElement("link", children)) === null || _a2 === void 0 ? void 0 : _a2.attribs["href"];
      if (href2) entry.link = href2;
      const description = fetch2("summary", children) || fetch2("content", children);
      if (description) entry.description = description;
      const pubDate = fetch2("updated", children);
      if (pubDate) entry.pubDate = new Date(pubDate);
      return entry;
    })
  };
  addConditionally(feed, "id", "id", childs);
  addConditionally(feed, "title", "title", childs);
  const href = (_a = getOneElement("link", childs)) === null || _a === void 0 ? void 0 : _a.attribs["href"];
  if (href) feed.link = href;
  addConditionally(feed, "description", "subtitle", childs);
  const updated = fetch2("updated", childs);
  if (updated) feed.updated = new Date(updated);
  addConditionally(feed, "author", "email", childs, true);
  return feed;
}
function getRssFeed(feedRoot) {
  var _a, _b;
  const childs = (_b = (_a = getOneElement("channel", feedRoot.children)) === null || _a === void 0 ? void 0 : _a.children) !== null && _b !== void 0 ? _b : [];
  const feed = {
    type: feedRoot.name.substr(0, 3),
    id: "",
    items: getElementsByTagName("item", feedRoot.children).map((item) => {
      const { children } = item;
      const entry = { media: getMediaElements(children) };
      addConditionally(entry, "id", "guid", children);
      addConditionally(entry, "title", "title", children);
      addConditionally(entry, "link", "link", children);
      addConditionally(entry, "description", "description", children);
      const pubDate = fetch2("pubDate", children) || fetch2("dc:date", children);
      if (pubDate) entry.pubDate = new Date(pubDate);
      return entry;
    })
  };
  addConditionally(feed, "title", "title", childs);
  addConditionally(feed, "link", "link", childs);
  addConditionally(feed, "description", "description", childs);
  const updated = fetch2("lastBuildDate", childs);
  if (updated) feed.updated = new Date(updated);
  addConditionally(feed, "author", "managingEditor", childs, true);
  return feed;
}
var MEDIA_KEYS_STRING = [
  "url",
  "type",
  "lang"
];
var MEDIA_KEYS_INT = [
  "fileSize",
  "bitrate",
  "framerate",
  "samplingrate",
  "channels",
  "duration",
  "height",
  "width"
];
function getMediaElements(where) {
  return getElementsByTagName("media:content", where).map((elem) => {
    const { attribs } = elem;
    const media2 = {
      medium: attribs["medium"],
      isDefault: !!attribs["isDefault"]
    };
    for (const attrib of MEDIA_KEYS_STRING) if (attribs[attrib]) media2[attrib] = attribs[attrib];
    for (const attrib of MEDIA_KEYS_INT) if (attribs[attrib]) media2[attrib] = parseInt(attribs[attrib], 10);
    if (attribs["expression"]) media2.expression = attribs["expression"];
    return media2;
  });
}
function getOneElement(tagName, node) {
  return getElementsByTagName(tagName, node, true, 1)[0];
}
function fetch2(tagName, where, recurse = false) {
  return textContent(getElementsByTagName(tagName, where, recurse, 1)).trim();
}
function addConditionally(obj, prop, tagName, where, recurse = false) {
  const val = fetch2(tagName, where, recurse);
  if (val) obj[prop] = val;
}
function isValidFeed(value) {
  return value === "rss" || value === "feed" || value === "rdf:RDF";
}
var esm_exports = /* @__PURE__ */ __exportAll({
  DocumentPosition: () => DocumentPosition,
  append: () => append,
  appendChild: () => appendChild,
  compareDocumentPosition: () => compareDocumentPosition,
  existsOne: () => existsOne$1,
  filter: () => filter,
  find: () => find,
  findAll: () => findAll$1,
  findOne: () => findOne$1,
  findOneChild: () => findOneChild,
  getAttributeValue: () => getAttributeValue$1,
  getChildren: () => getChildren$1,
  getElementById: () => getElementById,
  getElements: () => getElements,
  getElementsByClassName: () => getElementsByClassName,
  getElementsByTagName: () => getElementsByTagName,
  getElementsByTagType: () => getElementsByTagType,
  getFeed: () => getFeed,
  getInnerHTML: () => getInnerHTML,
  getName: () => getName$1,
  getOuterHTML: () => getOuterHTML,
  getParent: () => getParent$1,
  getSiblings: () => getSiblings$1,
  getText: () => getText$1,
  hasAttrib: () => hasAttrib$1,
  hasChildren: () => hasChildren,
  innerText: () => innerText,
  isCDATA: () => isCDATA,
  isComment: () => isComment,
  isDocument: () => isDocument,
  isTag: () => isTag$1,
  isText: () => isText,
  nextElementSibling: () => nextElementSibling,
  prepend: () => prepend,
  prependChild: () => prependChild,
  prevElementSibling: () => prevElementSibling,
  removeElement: () => removeElement,
  removeSubsets: () => removeSubsets$1,
  replaceElement: () => replaceElement,
  testElement: () => testElement,
  textContent: () => textContent,
  uniqueSort: () => uniqueSort
});
var require_boolbase = /* @__PURE__ */ __commonJSMin(((exports, module) => {
  module.exports = {
    trueFunc: function trueFunc() {
      return true;
    },
    falseFunc: function falseFunc() {
      return false;
    }
  };
}));
var require_types = /* @__PURE__ */ __commonJSMin(((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.AttributeAction = exports.IgnoreCaseMode = exports.SelectorType = void 0;
  (function(SelectorType) {
    SelectorType["Attribute"] = "attribute";
    SelectorType["Pseudo"] = "pseudo";
    SelectorType["PseudoElement"] = "pseudo-element";
    SelectorType["Tag"] = "tag";
    SelectorType["Universal"] = "universal";
    SelectorType["Adjacent"] = "adjacent";
    SelectorType["Child"] = "child";
    SelectorType["Descendant"] = "descendant";
    SelectorType["Parent"] = "parent";
    SelectorType["Sibling"] = "sibling";
    SelectorType["ColumnCombinator"] = "column-combinator";
  })(exports.SelectorType || (exports.SelectorType = {}));
  exports.IgnoreCaseMode = {
    Unknown: null,
    QuirksMode: "quirks",
    IgnoreCase: true,
    CaseSensitive: false
  };
  (function(AttributeAction) {
    AttributeAction["Any"] = "any";
    AttributeAction["Element"] = "element";
    AttributeAction["End"] = "end";
    AttributeAction["Equals"] = "equals";
    AttributeAction["Exists"] = "exists";
    AttributeAction["Hyphen"] = "hyphen";
    AttributeAction["Not"] = "not";
    AttributeAction["Start"] = "start";
  })(exports.AttributeAction || (exports.AttributeAction = {}));
}));
var require_parse = /* @__PURE__ */ __commonJSMin(((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.parse = exports.isTraversal = void 0;
  var types_1 = require_types();
  var reName = /^[^\\#]?(?:\\(?:[\da-f]{1,6}\s?|.)|[\w\-\u00b0-\uFFFF])+/;
  var reEscape = /\\([\da-f]{1,6}\s?|(\s)|.)/gi;
  var actionTypes = /* @__PURE__ */ new Map([
    [126, types_1.AttributeAction.Element],
    [94, types_1.AttributeAction.Start],
    [36, types_1.AttributeAction.End],
    [42, types_1.AttributeAction.Any],
    [33, types_1.AttributeAction.Not],
    [124, types_1.AttributeAction.Hyphen]
  ]);
  var unpackPseudos = /* @__PURE__ */ new Set([
    "has",
    "not",
    "matches",
    "is",
    "where",
    "host",
    "host-context"
  ]);
  function isTraversal2(selector) {
    switch (selector.type) {
      case types_1.SelectorType.Adjacent:
      case types_1.SelectorType.Child:
      case types_1.SelectorType.Descendant:
      case types_1.SelectorType.Parent:
      case types_1.SelectorType.Sibling:
      case types_1.SelectorType.ColumnCombinator:
        return true;
      default:
        return false;
    }
  }
  exports.isTraversal = isTraversal2;
  var stripQuotesFromPseudos = /* @__PURE__ */ new Set(["contains", "icontains"]);
  function funescape(_, escaped, escapedWhitespace) {
    var high = parseInt(escaped, 16) - 65536;
    return high !== high || escapedWhitespace ? escaped : high < 0 ? String.fromCharCode(high + 65536) : String.fromCharCode(high >> 10 | 55296, high & 1023 | 56320);
  }
  function unescapeCSS(str) {
    return str.replace(reEscape, funescape);
  }
  function isQuote(c) {
    return c === 39 || c === 34;
  }
  function isWhitespace(c) {
    return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
  }
  function parse2(selector) {
    var subselects2 = [];
    var endIndex = parseSelector(subselects2, "".concat(selector), 0);
    if (endIndex < selector.length) throw new Error("Unmatched selector: ".concat(selector.slice(endIndex)));
    return subselects2;
  }
  exports.parse = parse2;
  function parseSelector(subselects2, selector, selectorIndex) {
    var tokens = [];
    function getName2(offset) {
      var match5 = selector.slice(selectorIndex + offset).match(reName);
      if (!match5) throw new Error("Expected name, found ".concat(selector.slice(selectorIndex)));
      var name = match5[0];
      selectorIndex += offset + name.length;
      return unescapeCSS(name);
    }
    function stripWhitespace(offset) {
      selectorIndex += offset;
      while (selectorIndex < selector.length && isWhitespace(selector.charCodeAt(selectorIndex))) selectorIndex++;
    }
    function readValueWithParenthesis() {
      selectorIndex += 1;
      var start = selectorIndex;
      var counter = 1;
      for (; counter > 0 && selectorIndex < selector.length; selectorIndex++) if (selector.charCodeAt(selectorIndex) === 40 && !isEscaped(selectorIndex)) counter++;
      else if (selector.charCodeAt(selectorIndex) === 41 && !isEscaped(selectorIndex)) counter--;
      if (counter) throw new Error("Parenthesis not matched");
      return unescapeCSS(selector.slice(start, selectorIndex - 1));
    }
    function isEscaped(pos) {
      var slashCount = 0;
      while (selector.charCodeAt(--pos) === 92) slashCount++;
      return (slashCount & 1) === 1;
    }
    function ensureNotTraversal() {
      if (tokens.length > 0 && isTraversal2(tokens[tokens.length - 1])) throw new Error("Did not expect successive traversals.");
    }
    function addTraversal(type) {
      if (tokens.length > 0 && tokens[tokens.length - 1].type === types_1.SelectorType.Descendant) {
        tokens[tokens.length - 1].type = type;
        return;
      }
      ensureNotTraversal();
      tokens.push({ type });
    }
    function addSpecialAttribute(name, action2) {
      tokens.push({
        type: types_1.SelectorType.Attribute,
        name,
        action: action2,
        value: getName2(1),
        namespace: null,
        ignoreCase: "quirks"
      });
    }
    function finalizeSubselector() {
      if (tokens.length && tokens[tokens.length - 1].type === types_1.SelectorType.Descendant) tokens.pop();
      if (tokens.length === 0) throw new Error("Empty sub-selector");
      subselects2.push(tokens);
    }
    stripWhitespace(0);
    if (selector.length === selectorIndex) return selectorIndex;
    loop: while (selectorIndex < selector.length) {
      var firstChar = selector.charCodeAt(selectorIndex);
      switch (firstChar) {
        case 32:
        case 9:
        case 10:
        case 12:
        case 13:
          if (tokens.length === 0 || tokens[0].type !== types_1.SelectorType.Descendant) {
            ensureNotTraversal();
            tokens.push({ type: types_1.SelectorType.Descendant });
          }
          stripWhitespace(1);
          break;
        case 62:
          addTraversal(types_1.SelectorType.Child);
          stripWhitespace(1);
          break;
        case 60:
          addTraversal(types_1.SelectorType.Parent);
          stripWhitespace(1);
          break;
        case 126:
          addTraversal(types_1.SelectorType.Sibling);
          stripWhitespace(1);
          break;
        case 43:
          addTraversal(types_1.SelectorType.Adjacent);
          stripWhitespace(1);
          break;
        case 46:
          addSpecialAttribute("class", types_1.AttributeAction.Element);
          break;
        case 35:
          addSpecialAttribute("id", types_1.AttributeAction.Equals);
          break;
        case 91:
          stripWhitespace(1);
          var name_1 = void 0;
          var namespace = null;
          if (selector.charCodeAt(selectorIndex) === 124) name_1 = getName2(1);
          else if (selector.startsWith("*|", selectorIndex)) {
            namespace = "*";
            name_1 = getName2(2);
          } else {
            name_1 = getName2(0);
            if (selector.charCodeAt(selectorIndex) === 124 && selector.charCodeAt(selectorIndex + 1) !== 61) {
              namespace = name_1;
              name_1 = getName2(1);
            }
          }
          stripWhitespace(0);
          var action = types_1.AttributeAction.Exists;
          var possibleAction = actionTypes.get(selector.charCodeAt(selectorIndex));
          if (possibleAction) {
            action = possibleAction;
            if (selector.charCodeAt(selectorIndex + 1) !== 61) throw new Error("Expected `=`");
            stripWhitespace(2);
          } else if (selector.charCodeAt(selectorIndex) === 61) {
            action = types_1.AttributeAction.Equals;
            stripWhitespace(1);
          }
          var value = "";
          var ignoreCase = null;
          if (action !== "exists") {
            if (isQuote(selector.charCodeAt(selectorIndex))) {
              var quote = selector.charCodeAt(selectorIndex);
              var sectionEnd = selectorIndex + 1;
              while (sectionEnd < selector.length && (selector.charCodeAt(sectionEnd) !== quote || isEscaped(sectionEnd))) sectionEnd += 1;
              if (selector.charCodeAt(sectionEnd) !== quote) throw new Error("Attribute value didn't end");
              value = unescapeCSS(selector.slice(selectorIndex + 1, sectionEnd));
              selectorIndex = sectionEnd + 1;
            } else {
              var valueStart = selectorIndex;
              while (selectorIndex < selector.length && (!isWhitespace(selector.charCodeAt(selectorIndex)) && selector.charCodeAt(selectorIndex) !== 93 || isEscaped(selectorIndex))) selectorIndex += 1;
              value = unescapeCSS(selector.slice(valueStart, selectorIndex));
            }
            stripWhitespace(0);
            var forceIgnore = selector.charCodeAt(selectorIndex) | 32;
            if (forceIgnore === 115) {
              ignoreCase = false;
              stripWhitespace(1);
            } else if (forceIgnore === 105) {
              ignoreCase = true;
              stripWhitespace(1);
            }
          }
          if (selector.charCodeAt(selectorIndex) !== 93) throw new Error("Attribute selector didn't terminate");
          selectorIndex += 1;
          var attributeSelector = {
            type: types_1.SelectorType.Attribute,
            name: name_1,
            action,
            value,
            namespace,
            ignoreCase
          };
          tokens.push(attributeSelector);
          break;
        case 58:
          if (selector.charCodeAt(selectorIndex + 1) === 58) {
            tokens.push({
              type: types_1.SelectorType.PseudoElement,
              name: getName2(2).toLowerCase(),
              data: selector.charCodeAt(selectorIndex) === 40 ? readValueWithParenthesis() : null
            });
            continue;
          }
          var name_2 = getName2(1).toLowerCase();
          var data = null;
          if (selector.charCodeAt(selectorIndex) === 40) {
            if (unpackPseudos.has(name_2)) {
              if (isQuote(selector.charCodeAt(selectorIndex + 1))) throw new Error("Pseudo-selector ".concat(name_2, " cannot be quoted"));
              data = [];
              selectorIndex = parseSelector(data, selector, selectorIndex + 1);
              if (selector.charCodeAt(selectorIndex) !== 41) throw new Error("Missing closing parenthesis in :".concat(name_2, " (").concat(selector, ")"));
              selectorIndex += 1;
            } else {
              data = readValueWithParenthesis();
              if (stripQuotesFromPseudos.has(name_2)) {
                var quot = data.charCodeAt(0);
                if (quot === data.charCodeAt(data.length - 1) && isQuote(quot)) data = data.slice(1, -1);
              }
              data = unescapeCSS(data);
            }
          }
          tokens.push({
            type: types_1.SelectorType.Pseudo,
            name: name_2,
            data
          });
          break;
        case 44:
          finalizeSubselector();
          tokens = [];
          stripWhitespace(1);
          break;
        default:
          if (selector.startsWith("/*", selectorIndex)) {
            var endIndex = selector.indexOf("*/", selectorIndex + 2);
            if (endIndex < 0) throw new Error("Comment was not terminated");
            selectorIndex = endIndex + 2;
            if (tokens.length === 0) stripWhitespace(0);
            break;
          }
          var namespace = null;
          var name_3 = void 0;
          if (firstChar === 42) {
            selectorIndex += 1;
            name_3 = "*";
          } else if (firstChar === 124) {
            name_3 = "";
            if (selector.charCodeAt(selectorIndex + 1) === 124) {
              addTraversal(types_1.SelectorType.ColumnCombinator);
              stripWhitespace(2);
              break;
            }
          } else if (reName.test(selector.slice(selectorIndex))) name_3 = getName2(0);
          else break loop;
          if (selector.charCodeAt(selectorIndex) === 124 && selector.charCodeAt(selectorIndex + 1) !== 124) {
            namespace = name_3;
            if (selector.charCodeAt(selectorIndex + 1) === 42) {
              name_3 = "*";
              selectorIndex += 2;
            } else name_3 = getName2(1);
          }
          tokens.push(name_3 === "*" ? {
            type: types_1.SelectorType.Universal,
            namespace
          } : {
            type: types_1.SelectorType.Tag,
            name: name_3,
            namespace
          });
      }
    }
    finalizeSubselector();
    return selectorIndex;
  }
}));
var require_stringify = /* @__PURE__ */ __commonJSMin(((exports) => {
  var __spreadArray = exports && exports.__spreadArray || function(to, from, pack) {
    if (pack || arguments.length === 2) {
      for (var i = 0, l = from.length, ar; i < l; i++) if (ar || !(i in from)) {
        if (!ar) ar = Array.prototype.slice.call(from, 0, i);
        ar[i] = from[i];
      }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
  };
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.stringify = void 0;
  var types_1 = require_types();
  var attribValChars = ["\\", '"'];
  var pseudoValChars = __spreadArray(__spreadArray([], attribValChars, true), ["(", ")"], false);
  var charsToEscapeInAttributeValue = new Set(attribValChars.map(function(c) {
    return c.charCodeAt(0);
  }));
  var charsToEscapeInPseudoValue = new Set(pseudoValChars.map(function(c) {
    return c.charCodeAt(0);
  }));
  var charsToEscapeInName = new Set(__spreadArray(__spreadArray([], pseudoValChars, true), [
    "~",
    "^",
    "$",
    "*",
    "+",
    "!",
    "|",
    ":",
    "[",
    "]",
    " ",
    "."
  ], false).map(function(c) {
    return c.charCodeAt(0);
  }));
  function stringify(selector) {
    return selector.map(function(token) {
      return token.map(stringifyToken).join("");
    }).join(", ");
  }
  exports.stringify = stringify;
  function stringifyToken(token, index, arr) {
    switch (token.type) {
      case types_1.SelectorType.Child:
        return index === 0 ? "> " : " > ";
      case types_1.SelectorType.Parent:
        return index === 0 ? "< " : " < ";
      case types_1.SelectorType.Sibling:
        return index === 0 ? "~ " : " ~ ";
      case types_1.SelectorType.Adjacent:
        return index === 0 ? "+ " : " + ";
      case types_1.SelectorType.Descendant:
        return " ";
      case types_1.SelectorType.ColumnCombinator:
        return index === 0 ? "|| " : " || ";
      case types_1.SelectorType.Universal:
        return token.namespace === "*" && index + 1 < arr.length && "name" in arr[index + 1] ? "" : "".concat(getNamespace(token.namespace), "*");
      case types_1.SelectorType.Tag:
        return getNamespacedName(token);
      case types_1.SelectorType.PseudoElement:
        return "::".concat(escapeName(token.name, charsToEscapeInName)).concat(token.data === null ? "" : "(".concat(escapeName(token.data, charsToEscapeInPseudoValue), ")"));
      case types_1.SelectorType.Pseudo:
        return ":".concat(escapeName(token.name, charsToEscapeInName)).concat(token.data === null ? "" : "(".concat(typeof token.data === "string" ? escapeName(token.data, charsToEscapeInPseudoValue) : stringify(token.data), ")"));
      case types_1.SelectorType.Attribute:
        if (token.name === "id" && token.action === types_1.AttributeAction.Equals && token.ignoreCase === "quirks" && !token.namespace) return "#".concat(escapeName(token.value, charsToEscapeInName));
        if (token.name === "class" && token.action === types_1.AttributeAction.Element && token.ignoreCase === "quirks" && !token.namespace) return ".".concat(escapeName(token.value, charsToEscapeInName));
        var name_1 = getNamespacedName(token);
        if (token.action === types_1.AttributeAction.Exists) return "[".concat(name_1, "]");
        return "[".concat(name_1).concat(getActionValue(token.action), '="').concat(escapeName(token.value, charsToEscapeInAttributeValue), '"').concat(token.ignoreCase === null ? "" : token.ignoreCase ? " i" : " s", "]");
    }
  }
  function getActionValue(action) {
    switch (action) {
      case types_1.AttributeAction.Equals:
        return "";
      case types_1.AttributeAction.Element:
        return "~";
      case types_1.AttributeAction.Start:
        return "^";
      case types_1.AttributeAction.End:
        return "$";
      case types_1.AttributeAction.Any:
        return "*";
      case types_1.AttributeAction.Not:
        return "!";
      case types_1.AttributeAction.Hyphen:
        return "|";
      case types_1.AttributeAction.Exists:
        throw new Error("Shouldn't be here");
    }
  }
  function getNamespacedName(token) {
    return "".concat(getNamespace(token.namespace)).concat(escapeName(token.name, charsToEscapeInName));
  }
  function getNamespace(namespace) {
    return namespace !== null ? "".concat(namespace === "*" ? "*" : escapeName(namespace, charsToEscapeInName), "|") : "";
  }
  function escapeName(str, charsToEscape) {
    var lastIdx = 0;
    var ret = "";
    for (var i = 0; i < str.length; i++) if (charsToEscape.has(str.charCodeAt(i))) {
      ret += "".concat(str.slice(lastIdx, i), "\\").concat(str.charAt(i));
      lastIdx = i + 1;
    }
    return ret.length > 0 ? ret + str.slice(lastIdx) : str;
  }
}));
var require_commonjs = /* @__PURE__ */ __commonJSMin(((exports) => {
  var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
    if (k2 === void 0) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
      enumerable: true,
      get: function() {
        return m[k];
      }
    };
    Object.defineProperty(o, k2, desc);
  }) : (function(o, m, k, k2) {
    if (k2 === void 0) k2 = k;
    o[k2] = m[k];
  }));
  var __exportStar = exports && exports.__exportStar || function(m, exports$1) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$1, p)) __createBinding(exports$1, m, p);
  };
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.stringify = exports.parse = exports.isTraversal = void 0;
  __exportStar(require_types(), exports);
  var parse_1 = require_parse();
  Object.defineProperty(exports, "isTraversal", {
    enumerable: true,
    get: function() {
      return parse_1.isTraversal;
    }
  });
  Object.defineProperty(exports, "parse", {
    enumerable: true,
    get: function() {
      return parse_1.parse;
    }
  });
  var stringify_1 = require_stringify();
  Object.defineProperty(exports, "stringify", {
    enumerable: true,
    get: function() {
      return stringify_1.stringify;
    }
  });
}));
var import_boolbase = /* @__PURE__ */ __toESM(require_boolbase(), 1);
var import_commonjs = require_commonjs();
var procedure = /* @__PURE__ */ new Map([
  [import_commonjs.SelectorType.Universal, 50],
  [import_commonjs.SelectorType.Tag, 30],
  [import_commonjs.SelectorType.Attribute, 1],
  [import_commonjs.SelectorType.Pseudo, 0]
]);
function isTraversal(token) {
  return !procedure.has(token.type);
}
var attributes = /* @__PURE__ */ new Map([
  [import_commonjs.AttributeAction.Exists, 10],
  [import_commonjs.AttributeAction.Equals, 8],
  [import_commonjs.AttributeAction.Not, 7],
  [import_commonjs.AttributeAction.Start, 6],
  [import_commonjs.AttributeAction.End, 6],
  [import_commonjs.AttributeAction.Any, 5]
]);
function sortByProcedure(arr) {
  const procs = arr.map(getProcedure);
  for (let i = 1; i < arr.length; i++) {
    const procNew = procs[i];
    if (procNew < 0) continue;
    for (let j = i - 1; j >= 0 && procNew < procs[j]; j--) {
      const token = arr[j + 1];
      arr[j + 1] = arr[j];
      arr[j] = token;
      procs[j + 1] = procs[j];
      procs[j] = procNew;
    }
  }
}
function getProcedure(token) {
  var _a, _b;
  let proc = (_a = procedure.get(token.type)) !== null && _a !== void 0 ? _a : -1;
  if (token.type === import_commonjs.SelectorType.Attribute) {
    proc = (_b = attributes.get(token.action)) !== null && _b !== void 0 ? _b : 4;
    if (token.action === import_commonjs.AttributeAction.Equals && token.name === "id") proc = 9;
    if (token.ignoreCase) proc >>= 1;
  } else if (token.type === import_commonjs.SelectorType.Pseudo) {
    if (!token.data) proc = 3;
    else if (token.name === "has" || token.name === "contains") proc = 0;
    else if (Array.isArray(token.data)) {
      proc = Math.min(...token.data.map((d) => Math.min(...d.map(getProcedure))));
      if (proc < 0) proc = 0;
    } else proc = 2;
  }
  return proc;
}
var reChars = /[-[\]{}()*+?.,\\^$|#\s]/g;
function escapeRegex(value) {
  return value.replace(reChars, "\\$&");
}
var caseInsensitiveAttributes = /* @__PURE__ */ new Set([
  "accept",
  "accept-charset",
  "align",
  "alink",
  "axis",
  "bgcolor",
  "charset",
  "checked",
  "clear",
  "codetype",
  "color",
  "compact",
  "declare",
  "defer",
  "dir",
  "direction",
  "disabled",
  "enctype",
  "face",
  "frame",
  "hreflang",
  "http-equiv",
  "lang",
  "language",
  "link",
  "media",
  "method",
  "multiple",
  "nohref",
  "noresize",
  "noshade",
  "nowrap",
  "readonly",
  "rel",
  "rev",
  "rules",
  "scope",
  "scrolling",
  "selected",
  "shape",
  "target",
  "text",
  "type",
  "valign",
  "valuetype",
  "vlink"
]);
function shouldIgnoreCase(selector, options) {
  return typeof selector.ignoreCase === "boolean" ? selector.ignoreCase : selector.ignoreCase === "quirks" ? !!options.quirksMode : !options.xmlMode && caseInsensitiveAttributes.has(selector.name);
}
var attributeRules = {
  equals(next, data, options) {
    const { adapter } = options;
    const { name } = data;
    let { value } = data;
    if (shouldIgnoreCase(data, options)) {
      value = value.toLowerCase();
      return (elem) => {
        const attr = adapter.getAttributeValue(elem, name);
        return attr != null && attr.length === value.length && attr.toLowerCase() === value && next(elem);
      };
    }
    return (elem) => adapter.getAttributeValue(elem, name) === value && next(elem);
  },
  hyphen(next, data, options) {
    const { adapter } = options;
    const { name } = data;
    let { value } = data;
    const len = value.length;
    if (shouldIgnoreCase(data, options)) {
      value = value.toLowerCase();
      return function hyphenIC(elem) {
        const attr = adapter.getAttributeValue(elem, name);
        return attr != null && (attr.length === len || attr.charAt(len) === "-") && attr.substr(0, len).toLowerCase() === value && next(elem);
      };
    }
    return function hyphen(elem) {
      const attr = adapter.getAttributeValue(elem, name);
      return attr != null && (attr.length === len || attr.charAt(len) === "-") && attr.substr(0, len) === value && next(elem);
    };
  },
  element(next, data, options) {
    const { adapter } = options;
    const { name, value } = data;
    if (/\s/.test(value)) return import_boolbase.default.falseFunc;
    const regex = new RegExp(`(?:^|\\s)${escapeRegex(value)}(?:$|\\s)`, shouldIgnoreCase(data, options) ? "i" : "");
    return function element(elem) {
      const attr = adapter.getAttributeValue(elem, name);
      return attr != null && attr.length >= value.length && regex.test(attr) && next(elem);
    };
  },
  exists(next, { name }, { adapter }) {
    return (elem) => adapter.hasAttrib(elem, name) && next(elem);
  },
  start(next, data, options) {
    const { adapter } = options;
    const { name } = data;
    let { value } = data;
    const len = value.length;
    if (len === 0) return import_boolbase.default.falseFunc;
    if (shouldIgnoreCase(data, options)) {
      value = value.toLowerCase();
      return (elem) => {
        const attr = adapter.getAttributeValue(elem, name);
        return attr != null && attr.length >= len && attr.substr(0, len).toLowerCase() === value && next(elem);
      };
    }
    return (elem) => {
      var _a;
      return !!((_a = adapter.getAttributeValue(elem, name)) === null || _a === void 0 ? void 0 : _a.startsWith(value)) && next(elem);
    };
  },
  end(next, data, options) {
    const { adapter } = options;
    const { name } = data;
    let { value } = data;
    const len = -value.length;
    if (len === 0) return import_boolbase.default.falseFunc;
    if (shouldIgnoreCase(data, options)) {
      value = value.toLowerCase();
      return (elem) => {
        var _a;
        return ((_a = adapter.getAttributeValue(elem, name)) === null || _a === void 0 ? void 0 : _a.substr(len).toLowerCase()) === value && next(elem);
      };
    }
    return (elem) => {
      var _a;
      return !!((_a = adapter.getAttributeValue(elem, name)) === null || _a === void 0 ? void 0 : _a.endsWith(value)) && next(elem);
    };
  },
  any(next, data, options) {
    const { adapter } = options;
    const { name, value } = data;
    if (value === "") return import_boolbase.default.falseFunc;
    if (shouldIgnoreCase(data, options)) {
      const regex = new RegExp(escapeRegex(value), "i");
      return function anyIC(elem) {
        const attr = adapter.getAttributeValue(elem, name);
        return attr != null && attr.length >= value.length && regex.test(attr) && next(elem);
      };
    }
    return (elem) => {
      var _a;
      return !!((_a = adapter.getAttributeValue(elem, name)) === null || _a === void 0 ? void 0 : _a.includes(value)) && next(elem);
    };
  },
  not(next, data, options) {
    const { adapter } = options;
    const { name } = data;
    let { value } = data;
    if (value === "") return (elem) => !!adapter.getAttributeValue(elem, name) && next(elem);
    else if (shouldIgnoreCase(data, options)) {
      value = value.toLowerCase();
      return (elem) => {
        const attr = adapter.getAttributeValue(elem, name);
        return (attr == null || attr.length !== value.length || attr.toLowerCase() !== value) && next(elem);
      };
    }
    return (elem) => adapter.getAttributeValue(elem, name) !== value && next(elem);
  }
};
var whitespace = /* @__PURE__ */ new Set([
  9,
  10,
  12,
  13,
  32
]);
var ZERO = "0".charCodeAt(0);
var NINE = "9".charCodeAt(0);
function parse$4(formula) {
  formula = formula.trim().toLowerCase();
  if (formula === "even") return [2, 0];
  else if (formula === "odd") return [2, 1];
  let idx = 0;
  let a = 0;
  let sign = readSign();
  let number = readNumber();
  if (idx < formula.length && formula.charAt(idx) === "n") {
    idx++;
    a = sign * (number !== null && number !== void 0 ? number : 1);
    skipWhitespace();
    if (idx < formula.length) {
      sign = readSign();
      skipWhitespace();
      number = readNumber();
    } else sign = number = 0;
  }
  if (number === null || idx < formula.length) throw new Error(`n-th rule couldn't be parsed ('${formula}')`);
  return [a, sign * number];
  function readSign() {
    if (formula.charAt(idx) === "-") {
      idx++;
      return -1;
    }
    if (formula.charAt(idx) === "+") idx++;
    return 1;
  }
  function readNumber() {
    const start = idx;
    let value = 0;
    while (idx < formula.length && formula.charCodeAt(idx) >= ZERO && formula.charCodeAt(idx) <= NINE) {
      value = value * 10 + (formula.charCodeAt(idx) - ZERO);
      idx++;
    }
    return idx === start ? null : value;
  }
  function skipWhitespace() {
    while (idx < formula.length && whitespace.has(formula.charCodeAt(idx))) idx++;
  }
}
function compile$2(parsed) {
  const a = parsed[0];
  const b = parsed[1] - 1;
  if (b < 0 && a <= 0) return import_boolbase.default.falseFunc;
  if (a === -1) return (index) => index <= b;
  if (a === 0) return (index) => index === b;
  if (a === 1) return b < 0 ? import_boolbase.default.trueFunc : (index) => index >= b;
  const absA = Math.abs(a);
  const bMod = (b % absA + absA) % absA;
  return a > 1 ? (index) => index >= b && index % absA === bMod : (index) => index <= b && index % absA === bMod;
}
function nthCheck(formula) {
  return compile$2(parse$4(formula));
}
function getChildFunc(next, adapter) {
  return (elem) => {
    const parent = adapter.getParent(elem);
    return parent != null && adapter.isTag(parent) && next(elem);
  };
}
var filters = {
  contains(next, text, { adapter }) {
    return function contains(elem) {
      return next(elem) && adapter.getText(elem).includes(text);
    };
  },
  icontains(next, text, { adapter }) {
    const itext = text.toLowerCase();
    return function icontains(elem) {
      return next(elem) && adapter.getText(elem).toLowerCase().includes(itext);
    };
  },
  "nth-child"(next, rule, { adapter, equals }) {
    const func = nthCheck(rule);
    if (func === import_boolbase.default.falseFunc) return import_boolbase.default.falseFunc;
    if (func === import_boolbase.default.trueFunc) return getChildFunc(next, adapter);
    return function nthChild(elem) {
      const siblings = adapter.getSiblings(elem);
      let pos = 0;
      for (let i = 0; i < siblings.length; i++) {
        if (equals(elem, siblings[i])) break;
        if (adapter.isTag(siblings[i])) pos++;
      }
      return func(pos) && next(elem);
    };
  },
  "nth-last-child"(next, rule, { adapter, equals }) {
    const func = nthCheck(rule);
    if (func === import_boolbase.default.falseFunc) return import_boolbase.default.falseFunc;
    if (func === import_boolbase.default.trueFunc) return getChildFunc(next, adapter);
    return function nthLastChild(elem) {
      const siblings = adapter.getSiblings(elem);
      let pos = 0;
      for (let i = siblings.length - 1; i >= 0; i--) {
        if (equals(elem, siblings[i])) break;
        if (adapter.isTag(siblings[i])) pos++;
      }
      return func(pos) && next(elem);
    };
  },
  "nth-of-type"(next, rule, { adapter, equals }) {
    const func = nthCheck(rule);
    if (func === import_boolbase.default.falseFunc) return import_boolbase.default.falseFunc;
    if (func === import_boolbase.default.trueFunc) return getChildFunc(next, adapter);
    return function nthOfType(elem) {
      const siblings = adapter.getSiblings(elem);
      let pos = 0;
      for (let i = 0; i < siblings.length; i++) {
        const currentSibling = siblings[i];
        if (equals(elem, currentSibling)) break;
        if (adapter.isTag(currentSibling) && adapter.getName(currentSibling) === adapter.getName(elem)) pos++;
      }
      return func(pos) && next(elem);
    };
  },
  "nth-last-of-type"(next, rule, { adapter, equals }) {
    const func = nthCheck(rule);
    if (func === import_boolbase.default.falseFunc) return import_boolbase.default.falseFunc;
    if (func === import_boolbase.default.trueFunc) return getChildFunc(next, adapter);
    return function nthLastOfType(elem) {
      const siblings = adapter.getSiblings(elem);
      let pos = 0;
      for (let i = siblings.length - 1; i >= 0; i--) {
        const currentSibling = siblings[i];
        if (equals(elem, currentSibling)) break;
        if (adapter.isTag(currentSibling) && adapter.getName(currentSibling) === adapter.getName(elem)) pos++;
      }
      return func(pos) && next(elem);
    };
  },
  root(next, _rule, { adapter }) {
    return (elem) => {
      const parent = adapter.getParent(elem);
      return (parent == null || !adapter.isTag(parent)) && next(elem);
    };
  },
  scope(next, rule, options, context) {
    const { equals } = options;
    if (!context || context.length === 0) return filters["root"](next, rule, options);
    if (context.length === 1) return (elem) => equals(context[0], elem) && next(elem);
    return (elem) => context.includes(elem) && next(elem);
  },
  hover: dynamicStatePseudo("isHovered"),
  visited: dynamicStatePseudo("isVisited"),
  active: dynamicStatePseudo("isActive")
};
function dynamicStatePseudo(name) {
  return function dynamicPseudo(next, _rule, { adapter }) {
    const func = adapter[name];
    if (typeof func !== "function") return import_boolbase.default.falseFunc;
    return function active(elem) {
      return func(elem) && next(elem);
    };
  };
}
var pseudos = {
  empty(elem, { adapter }) {
    return !adapter.getChildren(elem).some((elem2) => adapter.isTag(elem2) || adapter.getText(elem2) !== "");
  },
  "first-child"(elem, { adapter, equals }) {
    if (adapter.prevElementSibling) return adapter.prevElementSibling(elem) == null;
    const firstChild = adapter.getSiblings(elem).find((elem2) => adapter.isTag(elem2));
    return firstChild != null && equals(elem, firstChild);
  },
  "last-child"(elem, { adapter, equals }) {
    const siblings = adapter.getSiblings(elem);
    for (let i = siblings.length - 1; i >= 0; i--) {
      if (equals(elem, siblings[i])) return true;
      if (adapter.isTag(siblings[i])) break;
    }
    return false;
  },
  "first-of-type"(elem, { adapter, equals }) {
    const siblings = adapter.getSiblings(elem);
    const elemName = adapter.getName(elem);
    for (let i = 0; i < siblings.length; i++) {
      const currentSibling = siblings[i];
      if (equals(elem, currentSibling)) return true;
      if (adapter.isTag(currentSibling) && adapter.getName(currentSibling) === elemName) break;
    }
    return false;
  },
  "last-of-type"(elem, { adapter, equals }) {
    const siblings = adapter.getSiblings(elem);
    const elemName = adapter.getName(elem);
    for (let i = siblings.length - 1; i >= 0; i--) {
      const currentSibling = siblings[i];
      if (equals(elem, currentSibling)) return true;
      if (adapter.isTag(currentSibling) && adapter.getName(currentSibling) === elemName) break;
    }
    return false;
  },
  "only-of-type"(elem, { adapter, equals }) {
    const elemName = adapter.getName(elem);
    return adapter.getSiblings(elem).every((sibling) => equals(elem, sibling) || !adapter.isTag(sibling) || adapter.getName(sibling) !== elemName);
  },
  "only-child"(elem, { adapter, equals }) {
    return adapter.getSiblings(elem).every((sibling) => equals(elem, sibling) || !adapter.isTag(sibling));
  }
};
function verifyPseudoArgs(func, name, subselect, argIndex) {
  if (subselect === null) {
    if (func.length > argIndex) throw new Error(`Pseudo-class :${name} requires an argument`);
  } else if (func.length === argIndex) throw new Error(`Pseudo-class :${name} doesn't have any arguments`);
}
var aliases = {
  "any-link": ":is(a, area, link)[href]",
  link: ":any-link:not(:visited)",
  disabled: `:is(
        :is(button, input, select, textarea, optgroup, option)[disabled],
        optgroup[disabled] > option,
        fieldset[disabled]:not(fieldset[disabled] legend:first-of-type *)
    )`,
  enabled: ":not(:disabled)",
  checked: ":is(:is(input[type=radio], input[type=checkbox])[checked], option:selected)",
  required: ":is(input, select, textarea)[required]",
  optional: ":is(input, select, textarea):not([required])",
  selected: "option:is([selected], select:not([multiple]):not(:has(> option[selected])) > :first-of-type)",
  checkbox: "[type=checkbox]",
  file: "[type=file]",
  password: "[type=password]",
  radio: "[type=radio]",
  reset: "[type=reset]",
  image: "[type=image]",
  submit: "[type=submit]",
  parent: ":not(:empty)",
  header: ":is(h1, h2, h3, h4, h5, h6)",
  button: ":is(button, input[type=button])",
  input: ":is(input, textarea, select, button)",
  text: "input:is(:not([type!='']), [type=text])"
};
var PLACEHOLDER_ELEMENT = {};
function ensureIsTag(next, adapter) {
  if (next === import_boolbase.default.falseFunc) return import_boolbase.default.falseFunc;
  return (elem) => adapter.isTag(elem) && next(elem);
}
function getNextSiblings(elem, adapter) {
  const siblings = adapter.getSiblings(elem);
  if (siblings.length <= 1) return [];
  const elemIndex = siblings.indexOf(elem);
  if (elemIndex < 0 || elemIndex === siblings.length - 1) return [];
  return siblings.slice(elemIndex + 1).filter(adapter.isTag);
}
function copyOptions(options) {
  return {
    xmlMode: !!options.xmlMode,
    lowerCaseAttributeNames: !!options.lowerCaseAttributeNames,
    lowerCaseTags: !!options.lowerCaseTags,
    quirksMode: !!options.quirksMode,
    cacheResults: !!options.cacheResults,
    pseudos: options.pseudos,
    adapter: options.adapter,
    equals: options.equals
  };
}
var is$1 = (next, token, options, context, compileToken2) => {
  const func = compileToken2(token, copyOptions(options), context);
  return func === import_boolbase.default.trueFunc ? next : func === import_boolbase.default.falseFunc ? import_boolbase.default.falseFunc : (elem) => func(elem) && next(elem);
};
var subselects = {
  is: is$1,
  /**
  * `:matches` and `:where` are aliases for `:is`.
  */
  matches: is$1,
  where: is$1,
  not(next, token, options, context, compileToken2) {
    const func = compileToken2(token, copyOptions(options), context);
    return func === import_boolbase.default.falseFunc ? next : func === import_boolbase.default.trueFunc ? import_boolbase.default.falseFunc : (elem) => !func(elem) && next(elem);
  },
  has(next, subselect, options, _context, compileToken2) {
    const { adapter } = options;
    const opts = copyOptions(options);
    opts.relativeSelector = true;
    const context = subselect.some((s) => s.some(isTraversal)) ? [PLACEHOLDER_ELEMENT] : void 0;
    const compiled = compileToken2(subselect, opts, context);
    if (compiled === import_boolbase.default.falseFunc) return import_boolbase.default.falseFunc;
    const hasElement = ensureIsTag(compiled, adapter);
    if (context && compiled !== import_boolbase.default.trueFunc) {
      const { shouldTestNextSiblings = false } = compiled;
      return (elem) => {
        if (!next(elem)) return false;
        context[0] = elem;
        const childs = adapter.getChildren(elem);
        const nextElements = shouldTestNextSiblings ? [...childs, ...getNextSiblings(elem, adapter)] : childs;
        return adapter.existsOne(hasElement, nextElements);
      };
    }
    return (elem) => next(elem) && adapter.existsOne(hasElement, adapter.getChildren(elem));
  }
};
function compilePseudoSelector(next, selector, options, context, compileToken2) {
  var _a;
  const { name, data } = selector;
  if (Array.isArray(data)) {
    if (!(name in subselects)) throw new Error(`Unknown pseudo-class :${name}(${data})`);
    return subselects[name](next, data, options, context, compileToken2);
  }
  const userPseudo = (_a = options.pseudos) === null || _a === void 0 ? void 0 : _a[name];
  const stringPseudo = typeof userPseudo === "string" ? userPseudo : aliases[name];
  if (typeof stringPseudo === "string") {
    if (data != null) throw new Error(`Pseudo ${name} doesn't have any arguments`);
    const alias = (0, import_commonjs.parse)(stringPseudo);
    return subselects["is"](next, alias, options, context, compileToken2);
  }
  if (typeof userPseudo === "function") {
    verifyPseudoArgs(userPseudo, name, data, 1);
    return (elem) => userPseudo(elem, data) && next(elem);
  }
  if (name in filters) return filters[name](next, data, options, context);
  if (name in pseudos) {
    const pseudo = pseudos[name];
    verifyPseudoArgs(pseudo, name, data, 2);
    return (elem) => pseudo(elem, options, data) && next(elem);
  }
  throw new Error(`Unknown pseudo-class :${name}`);
}
function getElementParent(node, adapter) {
  const parent = adapter.getParent(node);
  if (parent && adapter.isTag(parent)) return parent;
  return null;
}
function compileGeneralSelector(next, selector, options, context, compileToken2) {
  const { adapter, equals } = options;
  switch (selector.type) {
    case import_commonjs.SelectorType.PseudoElement:
      throw new Error("Pseudo-elements are not supported by css-select");
    case import_commonjs.SelectorType.ColumnCombinator:
      throw new Error("Column combinators are not yet supported by css-select");
    case import_commonjs.SelectorType.Attribute:
      if (selector.namespace != null) throw new Error("Namespaced attributes are not yet supported by css-select");
      if (!options.xmlMode || options.lowerCaseAttributeNames) selector.name = selector.name.toLowerCase();
      return attributeRules[selector.action](next, selector, options);
    case import_commonjs.SelectorType.Pseudo:
      return compilePseudoSelector(next, selector, options, context, compileToken2);
    case import_commonjs.SelectorType.Tag: {
      if (selector.namespace != null) throw new Error("Namespaced tag names are not yet supported by css-select");
      let { name } = selector;
      if (!options.xmlMode || options.lowerCaseTags) name = name.toLowerCase();
      return function tag(elem) {
        return adapter.getName(elem) === name && next(elem);
      };
    }
    case import_commonjs.SelectorType.Descendant: {
      if (options.cacheResults === false || typeof WeakSet === "undefined") return function descendant(elem) {
        let current = elem;
        while (current = getElementParent(current, adapter)) if (next(current)) return true;
        return false;
      };
      const isFalseCache = /* @__PURE__ */ new WeakSet();
      return function cachedDescendant(elem) {
        let current = elem;
        while (current = getElementParent(current, adapter)) if (!isFalseCache.has(current)) {
          if (adapter.isTag(current) && next(current)) return true;
          isFalseCache.add(current);
        }
        return false;
      };
    }
    case "_flexibleDescendant":
      return function flexibleDescendant(elem) {
        let current = elem;
        do
          if (next(current)) return true;
        while (current = getElementParent(current, adapter));
        return false;
      };
    case import_commonjs.SelectorType.Parent:
      return function parent(elem) {
        return adapter.getChildren(elem).some((elem2) => adapter.isTag(elem2) && next(elem2));
      };
    case import_commonjs.SelectorType.Child:
      return function child(elem) {
        const parent = adapter.getParent(elem);
        return parent != null && adapter.isTag(parent) && next(parent);
      };
    case import_commonjs.SelectorType.Sibling:
      return function sibling(elem) {
        const siblings = adapter.getSiblings(elem);
        for (let i = 0; i < siblings.length; i++) {
          const currentSibling = siblings[i];
          if (equals(elem, currentSibling)) break;
          if (adapter.isTag(currentSibling) && next(currentSibling)) return true;
        }
        return false;
      };
    case import_commonjs.SelectorType.Adjacent:
      if (adapter.prevElementSibling) return function adjacent(elem) {
        const previous = adapter.prevElementSibling(elem);
        return previous != null && next(previous);
      };
      return function adjacent(elem) {
        const siblings = adapter.getSiblings(elem);
        let lastElement;
        for (let i = 0; i < siblings.length; i++) {
          const currentSibling = siblings[i];
          if (equals(elem, currentSibling)) break;
          if (adapter.isTag(currentSibling)) lastElement = currentSibling;
        }
        return !!lastElement && next(lastElement);
      };
    case import_commonjs.SelectorType.Universal:
      if (selector.namespace != null && selector.namespace !== "*") throw new Error("Namespaced universal selectors are not yet supported by css-select");
      return next;
  }
}
function compile$1(selector, options, context) {
  return ensureIsTag(compileUnsafe(selector, options, context), options.adapter);
}
function compileUnsafe(selector, options, context) {
  return compileToken(typeof selector === "string" ? (0, import_commonjs.parse)(selector) : selector, options, context);
}
function includesScopePseudo(t) {
  return t.type === import_commonjs.SelectorType.Pseudo && (t.name === "scope" || Array.isArray(t.data) && t.data.some((data) => data.some(includesScopePseudo)));
}
var DESCENDANT_TOKEN = { type: import_commonjs.SelectorType.Descendant };
var FLEXIBLE_DESCENDANT_TOKEN = { type: "_flexibleDescendant" };
var SCOPE_TOKEN = {
  type: import_commonjs.SelectorType.Pseudo,
  name: "scope",
  data: null
};
function absolutize(token, { adapter }, context) {
  const hasContext = !!(context === null || context === void 0 ? void 0 : context.every((e) => {
    const parent = adapter.isTag(e) && adapter.getParent(e);
    return e === PLACEHOLDER_ELEMENT || parent && adapter.isTag(parent);
  }));
  for (const t of token) {
    if (t.length > 0 && isTraversal(t[0]) && t[0].type !== import_commonjs.SelectorType.Descendant) {
    } else if (hasContext && !t.some(includesScopePseudo)) t.unshift(DESCENDANT_TOKEN);
    else continue;
    t.unshift(SCOPE_TOKEN);
  }
}
function compileToken(token, options, context) {
  var _a;
  token.forEach(sortByProcedure);
  context = (_a = options.context) !== null && _a !== void 0 ? _a : context;
  const isArrayContext = Array.isArray(context);
  const finalContext = context && (Array.isArray(context) ? context : [context]);
  if (options.relativeSelector !== false) absolutize(token, options, finalContext);
  else if (token.some((t) => t.length > 0 && isTraversal(t[0]))) throw new Error("Relative selectors are not allowed when the `relativeSelector` option is disabled");
  let shouldTestNextSiblings = false;
  const query = token.map((rules) => {
    if (rules.length >= 2) {
      const [first, second] = rules;
      if (first.type !== import_commonjs.SelectorType.Pseudo || first.name !== "scope") {
      } else if (isArrayContext && second.type === import_commonjs.SelectorType.Descendant) rules[1] = FLEXIBLE_DESCENDANT_TOKEN;
      else if (second.type === import_commonjs.SelectorType.Adjacent || second.type === import_commonjs.SelectorType.Sibling) shouldTestNextSiblings = true;
    }
    return compileRules(rules, options, finalContext);
  }).reduce(reduceRules, import_boolbase.default.falseFunc);
  query.shouldTestNextSiblings = shouldTestNextSiblings;
  return query;
}
function compileRules(rules, options, context) {
  var _a;
  return rules.reduce((previous, rule) => previous === import_boolbase.default.falseFunc ? import_boolbase.default.falseFunc : compileGeneralSelector(previous, rule, options, context, compileToken), (_a = options.rootFunc) !== null && _a !== void 0 ? _a : import_boolbase.default.trueFunc);
}
function reduceRules(a, b) {
  if (b === import_boolbase.default.falseFunc || a === import_boolbase.default.trueFunc) return a;
  if (a === import_boolbase.default.falseFunc || b === import_boolbase.default.trueFunc) return b;
  return function combine(elem) {
    return a(elem) || b(elem);
  };
}
var defaultEquals = (a, b) => a === b;
var defaultOptions = {
  adapter: esm_exports,
  equals: defaultEquals
};
function convertOptionFormats(options) {
  var _a, _b, _c, _d;
  const opts = options !== null && options !== void 0 ? options : defaultOptions;
  (_a = opts.adapter) !== null && _a !== void 0 || (opts.adapter = esm_exports);
  (_b = opts.equals) !== null && _b !== void 0 || (opts.equals = (_d = (_c = opts.adapter) === null || _c === void 0 ? void 0 : _c.equals) !== null && _d !== void 0 ? _d : defaultEquals);
  return opts;
}
function getSelectorFunc(searchFunc) {
  return function select(query, elements, options) {
    const opts = convertOptionFormats(options);
    if (typeof query !== "function") query = compileUnsafe(query, opts, elements);
    const filteredElements = prepareContext(elements, opts.adapter, query.shouldTestNextSiblings);
    return searchFunc(query, filteredElements, opts);
  };
}
function prepareContext(elems, adapter, shouldTestNextSiblings = false) {
  if (shouldTestNextSiblings) elems = appendNextSiblings(elems, adapter);
  return Array.isArray(elems) ? adapter.removeSubsets(elems) : adapter.getChildren(elems);
}
function appendNextSiblings(elem, adapter) {
  const elems = Array.isArray(elem) ? elem.slice(0) : [elem];
  const elemsLength = elems.length;
  for (let i = 0; i < elemsLength; i++) {
    const nextSiblings = getNextSiblings(elems[i], adapter);
    elems.push(...nextSiblings);
  }
  return elems;
}
var selectAll = getSelectorFunc((query, elems, options) => query === import_boolbase.default.falseFunc || !elems || elems.length === 0 ? [] : options.adapter.findAll(query, elems));
var selectOne = getSelectorFunc((query, elems, options) => query === import_boolbase.default.falseFunc || !elems || elems.length === 0 ? null : options.adapter.findOne(query, elems));
function is(elem, query, options) {
  const opts = convertOptionFormats(options);
  return (typeof query === "function" ? query : compile$1(query, opts))(elem);
}
function arr_back(arr) {
  return arr[arr.length - 1];
}
function isTag(node) {
  return node && node.nodeType === 1;
}
function getAttributeValue(elem, name) {
  return isTag(elem) ? elem.getAttribute(name) : void 0;
}
function getName(elem) {
  return (elem && elem.rawTagName || "").toLowerCase();
}
function getChildren(node) {
  return node && node.childNodes;
}
function getParent(node) {
  return node ? node.parentNode : null;
}
function getText2(node) {
  return node.text;
}
function removeSubsets(nodes) {
  let idx = nodes.length;
  let node;
  let ancestor;
  let replace;
  while (--idx > -1) {
    node = ancestor = nodes[idx];
    nodes[idx] = null;
    replace = true;
    while (ancestor) {
      if (nodes.indexOf(ancestor) > -1) {
        replace = false;
        nodes.splice(idx, 1);
        break;
      }
      ancestor = getParent(ancestor);
    }
    if (replace) nodes[idx] = node;
  }
  return nodes;
}
function existsOne(test, elems) {
  return elems.some((elem) => {
    return isTag(elem) ? test(elem) || existsOne(test, getChildren(elem)) : false;
  });
}
function getSiblings(node) {
  const parent = getParent(node);
  return parent ? getChildren(parent) : [];
}
function hasAttrib(elem, name) {
  return getAttributeValue(elem, name) !== void 0;
}
function findOne(test, elems) {
  let elem = null;
  for (let i = 0, l = elems === null || elems === void 0 ? void 0 : elems.length; i < l && !elem; i++) {
    const el = elems[i];
    if (test(el)) elem = el;
    else {
      const childs = getChildren(el);
      if (childs && childs.length > 0) elem = findOne(test, childs);
    }
  }
  return elem;
}
function findAll(test, nodes) {
  let result = [];
  for (let i = 0, j = nodes.length; i < j; i++) {
    const node = nodes[i];
    if (!isTag(node)) continue;
    if (test(node)) result.push(node);
    const childs = getChildren(node);
    if (childs) result = result.concat(findAll(test, childs));
  }
  return result;
}
var matcher = {
  isTag,
  getAttributeValue,
  getName,
  getChildren,
  getParent,
  getText: getText2,
  removeSubsets,
  existsOne,
  getSiblings,
  hasAttrib,
  findOne,
  findAll
};
var VoidTag = class {
  constructor(addClosingSlash = false, tags) {
    this.addClosingSlash = addClosingSlash;
    if (Array.isArray(tags)) this.voidTags = tags.reduce((set, tag) => {
      return set.add(tag.toLowerCase()).add(tag.toUpperCase()).add(tag);
    }, /* @__PURE__ */ new Set());
    else this.voidTags = [
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr"
    ].reduce((set, tag) => {
      return set.add(tag.toLowerCase()).add(tag.toUpperCase()).add(tag);
    }, /* @__PURE__ */ new Set());
  }
  formatNode(tag, attrs, innerHTML) {
    const addClosingSlash = this.addClosingSlash;
    const closingSpace = addClosingSlash && attrs && !attrs.endsWith(" ") ? " " : "";
    const closingSlash = addClosingSlash ? `${closingSpace}/` : "";
    return this.isVoidElement(tag.toLowerCase()) ? `<${tag}${attrs}${closingSlash}>` : `<${tag}${attrs}>${innerHTML}</${tag}>`;
  }
  isVoidElement(tag) {
    return this.voidTags.has(tag);
  }
};
var TextNode = class TextNode2 extends Node {
  clone() {
    return new TextNode2(this._rawText, null);
  }
  constructor(rawText, parentNode = null, range2) {
    super(parentNode, range2);
    this.nodeType = 3;
    this.rawTagName = "";
    this._rawText = rawText;
  }
  get rawText() {
    return this._rawText;
  }
  /**
  * Set rawText and invalidate trimmed caches
  */
  set rawText(text) {
    this._rawText = text;
    this._trimmedRawText = void 0;
    this._trimmedText = void 0;
  }
  /**
  * Returns raw text with all whitespace trimmed except single leading/trailing non-breaking space
  */
  get trimmedRawText() {
    if (this._trimmedRawText !== void 0) return this._trimmedRawText;
    this._trimmedRawText = trimText(this.rawText);
    return this._trimmedRawText;
  }
  /**
  * Returns text with all whitespace trimmed except single leading/trailing non-breaking space
  */
  get trimmedText() {
    if (this._trimmedText !== void 0) return this._trimmedText;
    this._trimmedText = trimText(this.text);
    return this._trimmedText;
  }
  /**
  * Get unescaped text value of current node and its children.
  * @return {string} text content
  */
  get text() {
    return decodeHTML(this.rawText);
  }
  /**
  * Detect if the node contains only white space.
  * @return {boolean}
  */
  get isWhitespace() {
    return /^(\s|&nbsp;)*$/.test(this.rawText);
  }
  toString() {
    return this.rawText;
  }
};
function trimText(text) {
  let i = 0;
  let startPos;
  let endPos;
  while (i >= 0 && i < text.length) {
    if (/\S/.test(text[i])) {
      if (startPos === void 0) {
        startPos = i;
        i = text.length;
      } else {
        endPos = i;
        i = void 0;
      }
    }
    if (startPos === void 0) i++;
    else i--;
  }
  if (startPos === void 0) startPos = 0;
  if (endPos === void 0) endPos = text.length - 1;
  const hasLeadingSpace = startPos > 0 && /[^\S\r\n]/.test(text[startPos - 1]);
  const hasTrailingSpace = endPos < text.length - 1 && /[^\S\r\n]/.test(text[endPos + 1]);
  return (hasLeadingSpace ? " " : "") + text.slice(startPos, endPos + 1) + (hasTrailingSpace ? " " : "");
}
function decode(val) {
  return decodeHTML(val);
}
var Htags = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup"
];
var Dtags = [
  "details",
  "dialog",
  "dd",
  "div",
  "dt"
];
var Ftags = [
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form"
];
var tableTags = [
  "table",
  "td",
  "tr"
];
var htmlTags = [
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "ul"
];
var kBlockElements = /* @__PURE__ */ new Set();
function addToKBlockElement(...args) {
  const addToSet = (array) => {
    for (let index = 0; index < array.length; index++) {
      const element = array[index];
      kBlockElements.add(element);
      kBlockElements.add(element.toUpperCase());
    }
  };
  for (const arg of args) addToSet(arg);
}
addToKBlockElement(Htags, Dtags, Ftags, tableTags, htmlTags);
var DOMTokenList = class {
  _validate(c) {
    if (/\s/.test(c)) throw new Error(`DOMException in DOMTokenList.add: The token '${c}' contains HTML space characters, which are not valid in tokens.`);
  }
  constructor(valuesInit = [], afterUpdate = () => null) {
    this._set = new Set(valuesInit);
    this._afterUpdate = afterUpdate;
  }
  add(c) {
    this._validate(c);
    this._set.add(c);
    this._afterUpdate(this);
  }
  replace(c1, c2) {
    this._validate(c2);
    this._set.delete(c1);
    this._set.add(c2);
    this._afterUpdate(this);
  }
  remove(c) {
    this._set.delete(c) && this._afterUpdate(this);
  }
  toggle(c) {
    this._validate(c);
    if (this._set.has(c)) this._set.delete(c);
    else this._set.add(c);
    this._afterUpdate(this);
  }
  contains(c) {
    return this._set.has(c);
  }
  get length() {
    return this._set.size;
  }
  values() {
    return this._set.values();
  }
  get value() {
    return Array.from(this._set.values());
  }
  toString() {
    return Array.from(this._set.values()).join(" ");
  }
};
var HTMLElement = class HTMLElement2 extends Node {
  /**
  * Quote attribute values
  * @param attr attribute value
  * @returns {string} quoted value
  */
  quoteAttribute(attr) {
    if (attr == null) return "null";
    return `"${attr.replace(/"/g, "&quot;")}"`;
  }
  /**
  * Creates an instance of HTMLElement.
  * @param keyAttrs	id and class attribute
  * @param [rawAttrs]	attributes in string
  *
  * @memberof HTMLElement
  */
  constructor(tagName, keyAttrs, rawAttrs = "", parentNode = null, range2, voidTag = new VoidTag(), _parseOptions = {}) {
    super(parentNode, range2);
    this.rawAttrs = rawAttrs;
    this.voidTag = voidTag;
    this.nodeType = 1;
    this.rawTagName = tagName;
    this.rawAttrs = rawAttrs || "";
    this._id = keyAttrs.id || "";
    this.childNodes = [];
    this._parseOptions = _parseOptions;
    this.classList = new DOMTokenList(keyAttrs.class ? keyAttrs.class.split(/\s+/) : [], (classList) => this.setAttribute("class", classList.toString()));
    if (keyAttrs.id) {
      if (!rawAttrs) this.rawAttrs = `id="${keyAttrs.id}"`;
    }
    if (keyAttrs.class) {
      if (!rawAttrs) {
        const cls = `class="${this.classList.toString()}"`;
        if (this.rawAttrs) this.rawAttrs += ` ${cls}`;
        else this.rawAttrs = cls;
      }
    }
  }
  /**
  * Remove Child element from childNodes array
  * @param {HTMLElement} node     node to remove
  */
  removeChild(node) {
    this.childNodes = this.childNodes.filter((child) => {
      return child !== node;
    });
    return this;
  }
  /**
  * Exchanges given child with new child
  * @param {HTMLElement} oldNode     node to exchange
  * @param {HTMLElement} newNode     new node
  */
  exchangeChild(oldNode, newNode) {
    const children = this.childNodes;
    this.childNodes = children.map((child) => {
      if (child === oldNode) return newNode;
      return child;
    });
    return this;
  }
  get tagName() {
    return this.rawTagName ? this.rawTagName.toUpperCase() : this.rawTagName;
  }
  set tagName(newname) {
    this.rawTagName = newname.toLowerCase();
  }
  get localName() {
    return this.rawTagName.toLowerCase();
  }
  get isVoidElement() {
    return this.voidTag.isVoidElement(this.localName);
  }
  get id() {
    return this._id;
  }
  set id(newid) {
    this.setAttribute("id", newid);
  }
  /**
  * Get escpaed (as-it) text value of current node and its children.
  * @return {string} text content
  */
  get rawText() {
    if (/^br$/i.test(this.rawTagName)) return "\n";
    return this.childNodes.reduce((pre, cur) => {
      return pre += cur.rawText;
    }, "");
  }
  get textContent() {
    return decode(this.rawText);
  }
  set textContent(val) {
    const content = [new TextNode(encode(val), this)];
    this.childNodes = content;
  }
  /**
  * Get unescaped text value of current node and its children.
  * @return {string} text content
  */
  get text() {
    return decode(this.rawText);
  }
  /**
  * Get structured Text (with '\n' etc.)
  * @return {string} structured text
  */
  get structuredText() {
    let currentBlock = [];
    const blocks = [currentBlock];
    function dfs(node) {
      if (node.nodeType === 1) {
        if (kBlockElements.has(node.rawTagName)) {
          if (currentBlock.length > 0) blocks.push(currentBlock = []);
          node.childNodes.forEach(dfs);
          if (currentBlock.length > 0) blocks.push(currentBlock = []);
        } else node.childNodes.forEach(dfs);
      } else if (node.nodeType === 3) {
        if (node.isWhitespace) currentBlock.prependWhitespace = true;
        else {
          let text = node.trimmedText;
          if (currentBlock.prependWhitespace) {
            text = ` ${text}`;
            currentBlock.prependWhitespace = false;
          }
          currentBlock.push(text);
        }
      }
    }
    dfs(this);
    return blocks.map((block) => {
      return block.join("").replace(/\s{2,}/g, " ");
    }).join("\n").replace(/\s+$/, "");
  }
  toString() {
    const tag = this.rawTagName;
    if (tag) {
      const attrs = this.rawAttrs ? ` ${this.rawAttrs}` : "";
      return this.voidTag.formatNode(tag, attrs, this.innerHTML);
    }
    return this.innerHTML;
  }
  get innerHTML() {
    return this.childNodes.map((child) => {
      return child.toString();
    }).join("");
  }
  set innerHTML(content) {
    const r = parse$1(content, this._parseOptions);
    const nodes = r.childNodes.length ? r.childNodes : [new TextNode(content, this)];
    resetParent(nodes, this);
    resetParent(this.childNodes, null);
    this.childNodes = nodes;
  }
  set_content(content, options = {}) {
    if (content instanceof Node) content = [content];
    else if (typeof content == "string") {
      options = _objectSpread2(_objectSpread2({}, this._parseOptions), options);
      const r = parse$1(content, options);
      content = r.childNodes.length ? r.childNodes : [new TextNode(r.innerHTML, this)];
    }
    resetParent(this.childNodes, null);
    resetParent(content, this);
    this.childNodes = content;
    return this;
  }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    const content = nodes.map((node) => {
      if (node instanceof Node) return [node];
      else if (typeof node == "string") {
        const r = parse$1(node, this._parseOptions);
        return r.childNodes.length ? r.childNodes : [new TextNode(node, this)];
      }
      return [];
    }).flat();
    const idx = parent.childNodes.findIndex((child) => {
      return child === this;
    });
    resetParent([this], null);
    parent.childNodes = [
      ...parent.childNodes.slice(0, idx),
      ...resetParent(content, parent),
      ...parent.childNodes.slice(idx + 1)
    ];
    return this;
  }
  get outerHTML() {
    return this.toString();
  }
  /**
  * Trim element from right (in block) after seeing pattern in a TextNode.
  * @param  {RegExp} pattern pattern to find
  * @return {HTMLElement}    reference to current node
  */
  trimRight(pattern) {
    for (let i = 0; i < this.childNodes.length; i++) {
      const childNode = this.childNodes[i];
      if (childNode.nodeType === 1) childNode.trimRight(pattern);
      else {
        const index = childNode.rawText.search(pattern);
        if (index > -1) {
          childNode.rawText = childNode.rawText.substr(0, index);
          this.childNodes.length = i + 1;
        }
      }
    }
    return this;
  }
  /**
  * Get DOM structure
  * @return {string} structure
  */
  get structure() {
    const res = [];
    let indention = 0;
    function write2(str) {
      res.push("  ".repeat(indention) + str);
    }
    function dfs(node) {
      const idStr = node._id ? `#${node._id}` : "";
      const classStr = node.classList.length ? `.${node.classList.value.join(".")}` : "";
      write2(`${node.rawTagName}${idStr}${classStr}`);
      indention++;
      node.childNodes.forEach((childNode) => {
        if (childNode.nodeType === 1) dfs(childNode);
        else if (childNode.nodeType === 3) {
          if (!childNode.isWhitespace) write2("#text");
        }
      });
      indention--;
    }
    dfs(this);
    return res.join("\n");
  }
  /**
  * Remove whitespaces in this sub tree.
  * @return {HTMLElement} pointer to this
  */
  removeWhitespace() {
    let o = 0;
    this.childNodes.forEach((node) => {
      if (node.nodeType === 3) {
        if (node.isWhitespace) return;
        node.rawText = node.trimmedRawText;
      } else if (node.nodeType === 1) node.removeWhitespace();
      this.childNodes[o++] = node;
    });
    this.childNodes.length = o;
    const attrs = Object.keys(this.rawAttributes).map((key) => {
      const val = this.quoteAttribute(this.rawAttributes[key]);
      if (val === "null" || val === '""') return key;
      return `${key}=${val}`;
    }).join(" ");
    this.rawAttrs = attrs;
    delete this._rawAttrs;
    return this;
  }
  /**
  * Query CSS selector to find matching nodes.
  * @param  {string}         selector Simplified CSS selector
  * @return {HTMLElement[]}  matching elements
  */
  querySelectorAll(selector) {
    return selectAll(selector, this, {
      xmlMode: true,
      adapter: matcher
    });
  }
  /**
  * Query CSS Selector to find matching node.
  * @param  {string}         selector Simplified CSS selector
  * @return {(HTMLElement|null)}    matching node
  */
  querySelector(selector) {
    return selectOne(selector, this, {
      xmlMode: true,
      adapter: matcher
    });
  }
  /**
  * Tests whether the node matches a given CSS selector.
  * @param  {string}   selector Simplified CSS selector
  * @return {boolean}
  */
  matches(selector) {
    return is(this, selector, {
      xmlMode: true,
      adapter: matcher
    });
  }
  /**
  * find elements by their tagName
  * @param {string} tagName the tagName of the elements to select
  */
  getElementsByTagName(tagName) {
    const upperCasedTagName = tagName.toUpperCase();
    const re = [];
    const stack = [];
    let currentNodeReference = this;
    let index = 0;
    while (index !== void 0) {
      let child;
      do
        child = currentNodeReference.childNodes[index++];
      while (index < currentNodeReference.childNodes.length && child === void 0);
      if (child === void 0) {
        currentNodeReference = currentNodeReference.parentNode;
        index = stack.pop();
        continue;
      }
      if (child.nodeType === 1) {
        if (tagName === "*" || child.tagName === upperCasedTagName) re.push(child);
        if (child.childNodes.length > 0) {
          stack.push(index);
          currentNodeReference = child;
          index = 0;
        }
      }
    }
    return re;
  }
  /**
  * find element by it's id
  * @param {string} id the id of the element to select
  * @returns {HTMLElement | null} the element with the given id or null if not found
  */
  getElementById(id) {
    const stack = [];
    let currentNodeReference = this;
    let index = 0;
    while (index !== void 0) {
      let child;
      do
        child = currentNodeReference.childNodes[index++];
      while (index < currentNodeReference.childNodes.length && child === void 0);
      if (child === void 0) {
        currentNodeReference = currentNodeReference.parentNode;
        index = stack.pop();
        continue;
      }
      if (child.nodeType === 1) {
        if (child._id === id) return child;
        if (child.childNodes.length > 0) {
          stack.push(index);
          currentNodeReference = child;
          index = 0;
        }
      }
    }
    return null;
  }
  /**
  * traverses the Element and its parents (heading toward the document root) until it finds a node that matches the provided selector string. Will return itself or the matching ancestor. If no such element exists, it returns null.
  * @param selector a DOMString containing a selector list
  * @returns {HTMLElement | null} the element with the given id or null if not found
  */
  closest(selector) {
    const mapChild = /* @__PURE__ */ new Map();
    let el = this;
    let old = null;
    function findOne2(test, elems) {
      let elem = null;
      for (let i = 0, l = elems.length; i < l && !elem; i++) {
        const el2 = elems[i];
        if (test(el2)) elem = el2;
        else {
          const child = mapChild.get(el2);
          if (child) elem = findOne2(test, [child]);
        }
      }
      return elem;
    }
    while (el) {
      mapChild.set(el, old);
      old = el;
      el = el.parentNode;
    }
    el = this;
    while (el) {
      const e = selectOne(selector, el, {
        xmlMode: true,
        adapter: _objectSpread2(_objectSpread2({}, matcher), {}, {
          getChildren(node) {
            const child = mapChild.get(node);
            return child && [child];
          },
          getSiblings(node) {
            return [node];
          },
          findOne: findOne2,
          findAll() {
            return [];
          }
        })
      });
      if (e) return e;
      el = el.parentNode;
    }
    return null;
  }
  /**
  * Append a child node to childNodes
  * @param  {Node} node node to append
  * @return {Node}      node appended
  */
  appendChild(node) {
    this.append(node);
    return node;
  }
  /**
  * Get attributes
  * @access private
  * @return {Object} parsed and unescaped attributes
  */
  get attrs() {
    if (this._attrs) return this._attrs;
    this._attrs = {};
    const attrs = this.rawAttributes;
    for (const key in attrs) {
      const val = attrs[key] || "";
      this._attrs[key.toLowerCase()] = decode(val);
    }
    return this._attrs;
  }
  get attributes() {
    const ret_attrs = {};
    const attrs = this.rawAttributes;
    for (const key in attrs) ret_attrs[key] = decode(attrs[key] || "");
    return ret_attrs;
  }
  /**
  * Get escaped (as-is) attributes
  * @return {Object} parsed attributes
  */
  get rawAttributes() {
    if (this._rawAttrs) return this._rawAttrs;
    const attrs = {};
    if (this.rawAttrs) {
      const re = /([_a-zA-Z()[\]#@$.?:][a-zA-Z0-9-._:()[\]#]*)(?:\s*=\s*((?:'[^']*')|(?:"[^"]*")|\S+))?/g;
      let match5;
      while (match5 = re.exec(this.rawAttrs)) {
        const key = match5[1];
        if (key === "__proto__") continue;
        let val = match5[2] || null;
        if (val && (val[0] === `'` || val[0] === `"`)) val = val.slice(1, val.length - 1);
        attrs[key] = attrs[key] || val;
      }
    }
    this._rawAttrs = attrs;
    return attrs;
  }
  removeAttribute(key) {
    const attrs = this.rawAttributes;
    delete attrs[key];
    if (this._attrs) delete this._attrs[key];
    this.rawAttrs = Object.keys(attrs).map((name) => {
      const val = this.quoteAttribute(attrs[name]);
      if (val === "null" || val === '""') return name;
      return `${name}=${val}`;
    }).join(" ");
    if (key === "id") this._id = "";
    return this;
  }
  hasAttribute(key) {
    return key.toLowerCase() in this.attrs;
  }
  /**
  * Get an attribute
  * @return {string | undefined} value of the attribute; or undefined if not exist
  */
  getAttribute(key) {
    return this.attrs[key.toLowerCase()];
  }
  /**
  * Set an attribute value to the HTMLElement
  * @param {string} key The attribute name
  * @param {string} value The value to set, or null / undefined to remove an attribute
  */
  setAttribute(key, value) {
    if (arguments.length < 2) throw new Error("Failed to execute 'setAttribute' on 'Element'");
    const k2 = key.toLowerCase();
    const attrs = this.rawAttributes;
    for (const k in attrs) if (k.toLowerCase() === k2) {
      key = k;
      break;
    }
    attrs[key] = String(value);
    if (this._attrs) this._attrs[k2] = decode(attrs[key]);
    this.rawAttrs = Object.keys(attrs).map((name) => {
      const val = this.quoteAttribute(attrs[name]);
      if (val === "null" || val === '""') return name;
      return `${name}=${val}`;
    }).join(" ");
    if (key === "id") this._id = value;
    return this;
  }
  /**
  * Replace all the attributes of the HTMLElement by the provided attributes
  * @param {Attributes} attributes the new attribute set
  */
  setAttributes(attributes2) {
    if (this._attrs) delete this._attrs;
    if (this._rawAttrs) delete this._rawAttrs;
    this.rawAttrs = Object.keys(attributes2).map((name) => {
      const val = attributes2[name];
      if (val === "null" || val === '""') return name;
      return `${name}=${this.quoteAttribute(String(val))}`;
    }).join(" ");
    if ("id" in attributes2) this._id = attributes2["id"];
    return this;
  }
  insertAdjacentHTML(where, html) {
    if (arguments.length < 2) throw new Error("2 arguments required");
    const p = parse$1(html, this._parseOptions);
    if (where === "afterend") this.after(...p.childNodes);
    else if (where === "afterbegin") this.prepend(...p.childNodes);
    else if (where === "beforeend") this.append(...p.childNodes);
    else if (where === "beforebegin") this.before(...p.childNodes);
    else throw new Error(`The value provided ('${where}') is not one of 'beforebegin', 'afterbegin', 'beforeend', or 'afterend'`);
    return this;
  }
  /** Prepend nodes or strings to this node's children. */
  prepend(...insertable) {
    const nodes = resolveInsertable(insertable);
    resetParent(nodes, this);
    this.childNodes.unshift(...nodes);
  }
  /** Append nodes or strings to this node's children. */
  append(...insertable) {
    const nodes = resolveInsertable(insertable);
    resetParent(nodes, this);
    this.childNodes.push(...nodes);
  }
  /** Insert nodes or strings before this node. */
  before(...insertable) {
    const nodes = resolveInsertable(insertable);
    const siblings = this.parentNode.childNodes;
    resetParent(nodes, this.parentNode);
    siblings.splice(siblings.indexOf(this), 0, ...nodes);
  }
  /** Insert nodes or strings after this node. */
  after(...insertable) {
    const nodes = resolveInsertable(insertable);
    const siblings = this.parentNode.childNodes;
    resetParent(nodes, this.parentNode);
    siblings.splice(siblings.indexOf(this) + 1, 0, ...nodes);
  }
  get nextSibling() {
    if (this.parentNode) {
      const children = this.parentNode.childNodes;
      let i = 0;
      while (i < children.length) {
        const child = children[i++];
        if (this === child) return children[i] || null;
      }
      return null;
    }
  }
  get nextElementSibling() {
    if (this.parentNode) {
      const children = this.parentNode.childNodes;
      let i = 0;
      let find3 = false;
      while (i < children.length) {
        const child = children[i++];
        if (find3) {
          if (child instanceof HTMLElement2) return child || null;
        } else if (this === child) find3 = true;
      }
      return null;
    }
  }
  get previousSibling() {
    if (this.parentNode) {
      const children = this.parentNode.childNodes;
      let i = children.length;
      while (i > 0) {
        const child = children[--i];
        if (this === child) return children[i - 1] || null;
      }
      return null;
    }
  }
  get previousElementSibling() {
    if (this.parentNode) {
      const children = this.parentNode.childNodes;
      let i = children.length;
      let find3 = false;
      while (i > 0) {
        const child = children[--i];
        if (find3) {
          if (child instanceof HTMLElement2) return child || null;
        } else if (this === child) find3 = true;
      }
      return null;
    }
  }
  /** Get all childNodes of type {@link HTMLElement}. */
  get children() {
    const children = [];
    for (const childNode of this.childNodes) if (childNode instanceof HTMLElement2) children.push(childNode);
    return children;
  }
  /**
  * Get the first child node.
  * @return The first child or undefined if none exists.
  */
  get firstChild() {
    return this.childNodes[0];
  }
  /**
  * Get the first child node of type {@link HTMLElement}.
  * @return The first child element or undefined if none exists.
  */
  get firstElementChild() {
    return this.children[0];
  }
  /**
  * Get the last child node.
  * @return The last child or undefined if none exists.
  */
  get lastChild() {
    return arr_back(this.childNodes);
  }
  /**
  * Get the last child node of type {@link HTMLElement}.
  * @return The last child element or undefined if none exists.
  */
  get lastElementChild() {
    return this.children[this.children.length - 1];
  }
  get childElementCount() {
    return this.children.length;
  }
  get classNames() {
    return this.classList.toString();
  }
  /** Clone this Node */
  clone() {
    return parse$1(this.toString(), this._parseOptions).firstChild;
  }
};
var kMarkupPattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][-.:0-9_a-zA-Z@\xB7\xC0-\xD6\xD8-\xF6\u00F8-\u03A1\u03A3-\u03D9\u03DB-\u03EF\u03F7-\u03FF\u0400-\u04FF\u0500-\u052F\u1D00-\u1D2B\u1D6B-\u1D77\u1D79-\u1D9A\u1E00-\u1E9B\u1F00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2126\u212A-\u212B\u2132\u214E\u2160-\u2188\u2C60-\u2C7F\uA722-\uA787\uA78B-\uA78E\uA790-\uA7AD\uA7B0-\uA7B7\uA7F7-\uA7FF\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64-\uAB65\uFB00-\uFB06\uFB13-\uFB17\uFF21-\uFF3A\uFF41-\uFF5A\x37F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]*)((?:\s+[^>]*?(?:(?:'[^']*')|(?:"[^"]*"))?)*)\s*(\/?)>/gu;
var kMarkupPatternWithCDATA = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([a-zA-Z][-.:0-9_a-zA-Z@\xB7\xC0-\xD6\xD8-\xF6\u00F8-\u03A1\u03A3-\u03D9\u03DB-\u03EF\u03F7-\u03FF\u0400-\u04FF\u0500-\u052F\u1D00-\u1D2B\u1D6B-\u1D77\u1D79-\u1D9A\u1E00-\u1E9B\u1F00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2126\u212A-\u212B\u2132\u214E\u2160-\u2188\u2C60-\u2C7F\uA722-\uA787\uA78B-\uA78E\uA790-\uA7AD\uA7B0-\uA7B7\uA7F7-\uA7FF\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64-\uAB65\uFB00-\uFB06\uFB13-\uFB17\uFF21-\uFF3A\uFF41-\uFF5A\x37F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]*)((?:\s+[^>]*?(?:(?:'[^']*')|(?:"[^"]*"))?)*)\s*(\/?)>/gu;
var kAttributePattern = /(?:^|\s)(id|class)\s*=\s*((?:'[^']*')|(?:"[^"]*")|\S+)/gi;
var kElementsClosedByOpening = {
  li: {
    li: true,
    LI: true
  },
  LI: {
    li: true,
    LI: true
  },
  p: {
    p: true,
    div: true,
    P: true,
    DIV: true
  },
  P: {
    p: true,
    div: true,
    P: true,
    DIV: true
  },
  b: {
    div: true,
    DIV: true
  },
  B: {
    div: true,
    DIV: true
  },
  td: {
    td: true,
    th: true,
    TD: true,
    TH: true
  },
  TD: {
    td: true,
    th: true,
    TD: true,
    TH: true
  },
  th: {
    td: true,
    th: true,
    TD: true,
    TH: true
  },
  TH: {
    td: true,
    th: true,
    TD: true,
    TH: true
  },
  h1: {
    h1: true,
    H1: true
  },
  H1: {
    h1: true,
    H1: true
  },
  h2: {
    h2: true,
    H2: true
  },
  H2: {
    h2: true,
    H2: true
  },
  h3: {
    h3: true,
    H3: true
  },
  H3: {
    h3: true,
    H3: true
  },
  h4: {
    h4: true,
    H4: true
  },
  H4: {
    h4: true,
    H4: true
  },
  h5: {
    h5: true,
    H5: true
  },
  H5: {
    h5: true,
    H5: true
  },
  h6: {
    h6: true,
    H6: true
  },
  H6: {
    h6: true,
    H6: true
  },
  dt: {
    dt: true,
    dd: true,
    DT: true,
    DD: true
  },
  DT: {
    dt: true,
    dd: true,
    DT: true,
    DD: true
  },
  dd: {
    dt: true,
    dd: true,
    DT: true,
    DD: true
  },
  DD: {
    dt: true,
    dd: true,
    DT: true,
    DD: true
  }
};
var kElementsClosedByClosing = {
  li: {
    ul: true,
    ol: true,
    UL: true,
    OL: true
  },
  LI: {
    ul: true,
    ol: true,
    UL: true,
    OL: true
  },
  a: {
    div: true,
    DIV: true
  },
  A: {
    div: true,
    DIV: true
  },
  b: {
    div: true,
    DIV: true
  },
  B: {
    div: true,
    DIV: true
  },
  i: {
    div: true,
    DIV: true
  },
  I: {
    div: true,
    DIV: true
  },
  p: {
    div: true,
    DIV: true
  },
  P: {
    div: true,
    DIV: true
  },
  td: {
    tr: true,
    table: true,
    TR: true,
    TABLE: true
  },
  TD: {
    tr: true,
    table: true,
    TR: true,
    TABLE: true
  },
  th: {
    tr: true,
    table: true,
    TR: true,
    TABLE: true
  },
  TH: {
    tr: true,
    table: true,
    TR: true,
    TABLE: true
  },
  dt: {
    dl: true,
    body: true,
    html: true,
    DL: true,
    BODY: true,
    HTML: true
  },
  DT: {
    dl: true,
    body: true,
    html: true,
    DL: true,
    BODY: true,
    HTML: true
  },
  dd: {
    dl: true,
    body: true,
    html: true,
    DL: true,
    BODY: true,
    HTML: true
  },
  DD: {
    dl: true,
    body: true,
    html: true,
    DL: true,
    BODY: true,
    HTML: true
  }
};
var kElementsClosedByClosingExcept = { p: {
  a: true,
  audio: true,
  del: true,
  ins: true,
  map: true,
  noscript: true,
  video: true
} };
var frameflag = "documentfragmentcontainer";
function base_parse(data, options = {}) {
  var _options$voidTag, _options$voidTag2;
  const voidTag = new VoidTag(options === null || options === void 0 || (_options$voidTag = options.voidTag) === null || _options$voidTag === void 0 ? void 0 : _options$voidTag.closingSlash, options === null || options === void 0 || (_options$voidTag2 = options.voidTag) === null || _options$voidTag2 === void 0 ? void 0 : _options$voidTag2.tags);
  const hasCDATA = data.includes("<![CDATA[");
  const markupPattern = hasCDATA ? kMarkupPatternWithCDATA : kMarkupPattern;
  const elements = options.blockTextElements || {
    script: true,
    noscript: true,
    style: true,
    pre: true
  };
  const element_names = Object.keys(elements);
  const kBlockTextElements = element_names.map((it) => new RegExp(`^${it}$`, "i"));
  const kIgnoreElements = element_names.filter((it) => Boolean(elements[it])).map((it) => new RegExp(`^${it}$`, "i"));
  function element_should_be_ignore(tag) {
    return kIgnoreElements.some((it) => it.test(tag));
  }
  function is_block_text_element(tag) {
    return kBlockTextElements.some((it) => it.test(tag));
  }
  const createRange = (startPos, endPos) => [startPos - frameFlagOffset, endPos - frameFlagOffset];
  const root = new HTMLElement(null, {}, "", null, [0, data.length], voidTag, options);
  let currentParent = root;
  const stack = [root];
  let lastTextPos = -1;
  let noNestedTagIndex = void 0;
  let match5;
  data = `<${frameflag}>${data}</${frameflag}>`;
  const { lowerCaseTagName, fixNestedATags } = options;
  const dataEndPos = data.length - 28;
  const frameFlagOffset = 27;
  markupPattern.lastIndex = 0;
  while (match5 = markupPattern.exec(data)) {
    let { 0: matchText, 1: leadingSlash, 2: tagName, 3: attributes2, 4: closingSlash } = match5;
    const matchLength = matchText.length;
    const tagStartPos = markupPattern.lastIndex - matchLength;
    const tagEndPos = markupPattern.lastIndex;
    if (lastTextPos > -1) {
      if (lastTextPos + matchLength < tagEndPos) {
        const text = data.substring(lastTextPos, tagStartPos);
        currentParent.appendChild(new TextNode(text, null, createRange(lastTextPos, tagStartPos)));
      }
    }
    lastTextPos = markupPattern.lastIndex;
    if (hasCDATA && matchText.startsWith("<![CDATA[")) {
      currentParent.appendChild(new TextNode(matchText, null, createRange(tagStartPos, tagEndPos)));
      continue;
    }
    if (tagName === frameflag) continue;
    if (matchText[1] === "!") {
      if (options.comment) {
        const text = data.substring(tagStartPos + 4, tagEndPos - 3);
        currentParent.appendChild(new CommentNode(text, null, createRange(tagStartPos, tagEndPos)));
      }
      continue;
    }
    if (lowerCaseTagName) tagName = tagName.toLowerCase();
    if (!leadingSlash) {
      const attrs = {};
      for (let attMatch; attMatch = kAttributePattern.exec(attributes2); ) {
        const { 1: key, 2: val } = attMatch;
        const isQuoted = val[0] === `'` || val[0] === `"`;
        attrs[key.toLowerCase()] = isQuoted ? val.slice(1, val.length - 1) : val;
      }
      const parentTagName = currentParent.rawTagName;
      if (!closingSlash && !options.preserveTagNesting && kElementsClosedByOpening[parentTagName]) {
        if (kElementsClosedByOpening[parentTagName][tagName]) {
          stack.pop();
          currentParent = arr_back(stack);
        }
      }
      if (fixNestedATags && (tagName === "a" || tagName === "A")) {
        if (noNestedTagIndex !== void 0) {
          stack.splice(noNestedTagIndex);
          currentParent = arr_back(stack);
        }
        noNestedTagIndex = stack.length;
      }
      const tagEndPos2 = markupPattern.lastIndex;
      const tagStartPos2 = tagEndPos2 - matchLength;
      currentParent = currentParent.appendChild(new HTMLElement(tagName, attrs, attributes2.slice(1), null, createRange(tagStartPos2, tagEndPos2), voidTag, options));
      stack.push(currentParent);
      if (is_block_text_element(tagName)) {
        const closeMarkup = `</${tagName}>`;
        const closeIndex = lowerCaseTagName ? data.toLocaleLowerCase().indexOf(closeMarkup, markupPattern.lastIndex) : data.indexOf(closeMarkup, markupPattern.lastIndex);
        const textEndPos = closeIndex === -1 ? dataEndPos : closeIndex;
        if (element_should_be_ignore(tagName)) {
          const text = data.substring(tagEndPos2, textEndPos);
          if (text.length > 0 && /\S/.test(text)) currentParent.appendChild(new TextNode(text, null, createRange(tagEndPos2, textEndPos)));
        }
        if (closeIndex === -1) lastTextPos = markupPattern.lastIndex = data.length + 1;
        else {
          lastTextPos = markupPattern.lastIndex = closeIndex + closeMarkup.length;
          leadingSlash = "/";
        }
      }
    }
    if (leadingSlash || closingSlash || voidTag.isVoidElement(tagName)) while (true) {
      if (noNestedTagIndex != null && (tagName === "a" || tagName === "A")) noNestedTagIndex = void 0;
      if (currentParent.rawTagName === tagName) {
        currentParent.range[1] = createRange(-1, Math.max(lastTextPos, tagEndPos))[1];
        stack.pop();
        currentParent = arr_back(stack);
        break;
      } else {
        const parentTagName = currentParent.tagName;
        if (kElementsClosedByClosing[parentTagName]) {
          if (kElementsClosedByClosing[parentTagName][tagName]) {
            stack.pop();
            currentParent = arr_back(stack);
            continue;
          }
        }
        const openTag = currentParent.rawTagName ? currentParent.rawTagName.toLowerCase() : "";
        if (kElementsClosedByClosingExcept[openTag]) {
          const closingTag = tagName.toLowerCase();
          if (stack.length > 1) {
            const possibleContainer = stack[stack.length - 2];
            if (possibleContainer && possibleContainer.rawTagName && possibleContainer.rawTagName.toLowerCase() === closingTag && !kElementsClosedByClosingExcept[openTag][closingTag]) {
              currentParent.range[1] = createRange(-1, Math.max(lastTextPos, tagEndPos))[1];
              stack.pop();
              currentParent = arr_back(stack);
              continue;
            }
          }
        }
        if (options.closeAllByClosing === true) {
          let i;
          for (i = stack.length - 2; i >= 0; i--) if (stack[i].rawTagName === tagName) break;
          if (i >= 0) {
            while (stack.length > i) {
              currentParent.range[1] = createRange(-1, Math.max(lastTextPos, tagEndPos))[1];
              stack.pop();
              currentParent = arr_back(stack);
            }
            continue;
          }
        }
        break;
      }
    }
  }
  return stack;
}
function parse$1(data, options = {}) {
  const stack = base_parse(data, options);
  const [root] = stack;
  while (stack.length > 1) {
    const last = stack.pop();
    const oneBefore = arr_back(stack);
    if (last.parentNode && last.parentNode.parentNode) {
      if (last.parentNode === oneBefore && last.tagName === oneBefore.tagName) {
        if (options.parseNoneClosedTags !== true) {
          oneBefore.removeChild(last);
          last.childNodes.forEach((child) => {
            oneBefore.parentNode.appendChild(child);
          });
          stack.pop();
        }
      } else if (options.parseNoneClosedTags !== true) {
        oneBefore.removeChild(last);
        last.childNodes.forEach((child) => {
          oneBefore.appendChild(child);
        });
      }
    }
  }
  return root;
}
function resolveInsertable(insertable) {
  return insertable.map((val) => {
    if (typeof val === "string") return new TextNode(val);
    val.remove();
    return val;
  });
}
function resetParent(nodes, parent) {
  return nodes.map((node) => {
    node.parentNode = parent;
    return node;
  });
}
function valid(data, options = {}) {
  const stack = base_parse(data, options);
  return Boolean(stack.length === 1);
}
function parse(data, options = {}) {
  return parse$1(data, options);
}
parse.parse = parse$1;
parse.HTMLElement = HTMLElement;
parse.CommentNode = CommentNode;
parse.valid = valid;
parse.Node = Node;
parse.TextNode = TextNode;
parse.NodeType = NodeType;

// src/sources/anikoto.ts
var log3 = logger("anikoto");
var API = "https://anikotoapi.site";
var SEARCH_DOMAINS = ["https://anikoto.cz", "https://anikototv.to"];
var MEGAPLAY = "https://megaplay.buzz";
var norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}
async function search(keyword) {
  for (const domain of SEARCH_DOMAINS) {
    try {
      const html = await getText(`${domain}/search?keyword=${encodeURIComponent(keyword)}`, { timeoutMs: 12e3 });
      const root = parse(html);
      const hits = [];
      for (const item of root.querySelectorAll("#list-items .item, .items .item")) {
        const tip = item.querySelector("[data-tip]");
        const id = Number(tip?.getAttribute("data-tip"));
        if (!Number.isInteger(id) || id <= 0) continue;
        const nameEl = item.querySelector(".info .name") ?? item.querySelector(".name") ?? item.querySelector("a");
        const type = item.querySelector(".meta .right")?.text.trim() ?? "";
        const eps = Number((item.querySelector(".ep-status.sub")?.text ?? "").replace(/\D/g, "")) || 0;
        hits.push({ id, title: decodeEntities(nameEl?.text.trim() ?? ""), type, subEpisodes: eps });
      }
      if (hits.length) return dedupe(hits);
    } catch (err) {
      log3.warn(`search failed on ${domain}:`, String(err));
    }
  }
  return [];
}
function dedupe(hits) {
  const seen = /* @__PURE__ */ new Set();
  return hits.filter((h) => seen.has(h.id) ? false : (seen.add(h.id), true));
}
function score(targetTitle, targetFormat, targetEps, hit) {
  let s = 0;
  const t = norm(targetTitle);
  const h = norm(hit.title);
  if (h === t) s += 120;
  else if (h.startsWith(t)) s += 35;
  else if (h.includes(t)) s += 15;
  else s -= 20;
  const fmt = (targetFormat || "TV").toUpperCase();
  const type = hit.type.toUpperCase();
  if (type && (fmt.includes(type) || type.includes(fmt))) s += 60;
  else if (fmt === "TV" && ["MOVIE", "SPECIAL", "OVA"].includes(type)) s -= 60;
  const eps = hit.subEpisodes;
  if (targetEps && targetEps > 1) {
    if (eps === targetEps) s += 100;
    else if (eps > 1) s += 40;
    else if (eps === 1 && fmt === "TV") s -= 50;
  } else if (targetEps === 1 || fmt === "MOVIE") {
    if (eps === 1) s += 50;
    else if (eps > 1) s -= 30;
  } else if (fmt === "TV" && eps > 1) {
    s += 45;
  }
  return s;
}
async function series(id) {
  try {
    const json = await retry(() => getJson(`${API}/series/${id}`, { timeoutMs: 12e3 }), 3);
    const data = json.data;
    if (!data?.anime) return null;
    const malRaw = Number(data.anime.mal_id);
    return {
      id,
      malId: Number.isFinite(malRaw) && malRaw > 0 ? malRaw : null,
      aniId: data.anime.ani_id ? String(data.anime.ani_id) : null,
      title: data.anime.title ?? "",
      episodes: (data.episodes ?? []).map((e) => ({
        number: Number(e.number),
        title: e.title ? decodeEntities(e.title) : null,
        embedId: e.episode_embed_id != null ? String(e.episode_embed_id) : null,
        sub: e.embed_url?.sub ?? null,
        dub: e.embed_url?.dub ?? null
      }))
    };
  } catch (err) {
    log3.warn(`series ${id} failed:`, String(err));
    return null;
  }
}
async function match(target) {
  const scored = /* @__PURE__ */ new Map();
  const loaded = /* @__PURE__ */ new Map();
  const top = () => [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 6);
  for (const title of target.titles) {
    for (const hit of await search(title)) {
      const s = score(title, target.format, target.episodes, hit);
      const prev = scored.get(hit.id);
      if (!prev || prev.score < s) scored.set(hit.id, { hit, score: s });
    }
    if (target.malId) {
      const pending = top().filter((r) => !loaded.has(r.hit.id));
      for (let i = 0; i < pending.length; i += 2) {
        const pair = pending.slice(i, i + 2);
        const results = await Promise.all(pair.map((r) => series(r.hit.id)));
        pair.forEach((r, j) => loaded.set(r.hit.id, results[j]));
        const exact = results.find((s) => s && s.malId === target.malId);
        if (exact) return exact;
      }
    } else if ((top()[0]?.score ?? 0) >= 200) {
      break;
    }
  }
  for (const r of top()) {
    if (r.score < 40) break;
    const s = loaded.has(r.hit.id) ? loaded.get(r.hit.id) : await series(r.hit.id);
    if (!s || !s.episodes.length) continue;
    if (target.malId && s.malId && s.malId !== target.malId) continue;
    const onlyFull = s.episodes.length === 1 && (s.episodes[0].title ?? "").trim().toLowerCase() === "full";
    if (target.format === "TV" && (target.episodes ?? 0) > 1 && onlyFull) continue;
    return s;
  }
  return null;
}

// src/stream/embeds.ts
var known = /* @__PURE__ */ new Set([new URL(MEGAPLAY).host]);
function allowEmbedHosts(urls) {
  for (const u of urls) {
    if (!u) continue;
    try {
      const url = new URL(u);
      if (url.protocol === "https:" || url.protocol === "http:") known.add(url.host);
    } catch {
    }
  }
}
function isKnownEmbed(u) {
  try {
    const url = new URL(u);
    return (url.protocol === "https:" || url.protocol === "http:") && known.has(url.host);
  } catch {
    return false;
  }
}

// src/episodes.ts
var log4 = logger("episodes");
var cache2 = new TtlCache(200);
var GENERIC_TITLE = /^(episode\s*\d+|ep\.?\s*\d+|full|\d+)$/i;
function streamingIndex(media2) {
  const byNumber = /* @__PURE__ */ new Map();
  for (const se of media2.streamingEpisodes ?? []) {
    const m = /^episode\s+(\d+)(?:\s*[-–:]\s*(.+))?$/i.exec((se.title ?? "").trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (!byNumber.has(n)) byNumber.set(n, { title: m[2]?.trim() || null, thumbnail: se.thumbnail ?? null });
  }
  return byNumber;
}
function expectedEpisodeCount(media2) {
  if (media2.format === "MOVIE") return 1;
  if (media2.episodes) return media2.episodes;
  if (media2.nextAiringEpisode) return Math.max(1, media2.nextAiringEpisode.episode - 1);
  return 12;
}
var KITSU = "https://kitsu.app/api/edge";
var KITSU_HEADERS = { Accept: "application/vnd.api+json" };
function kitsuStills(malId, need) {
  return cache2.wrap(`stills:${malId}:${need[0]}`, 24 * 36e5, async () => {
    const stills = /* @__PURE__ */ new Map();
    const mapping = await getJson(`${KITSU}/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${malId}&include=item`, { headers: KITSU_HEADERS, timeoutMs: 8e3 });
    const kitsuId = mapping.included?.find((i) => i.type === "anime")?.id;
    if (!kitsuId) return stills;
    const pages5 = [...new Set(need.map((n) => Math.floor((n - 1) / 20)))].slice(0, 10);
    await Promise.all(
      pages5.map(async (p) => {
        const res = await getJson(
          `${KITSU}/anime/${kitsuId}/episodes?page[limit]=20&page[offset]=${p * 20}&sort=number`,
          { headers: KITSU_HEADERS, timeoutMs: 8e3 }
        ).catch(() => null);
        for (const e of res?.data ?? []) {
          const n = e.attributes?.number;
          const url = e.attributes?.thumbnail?.original;
          if (n && url) stills.set(n, url);
        }
      })
    );
    return stills;
  });
}
async function listEpisodes(mediaId, force = false) {
  const list3 = await cache2.wrap(`eps:${mediaId}`, 20 * 6e4, async () => {
    const media2 = await media(mediaId);
    const isMovie = media2.format === "MOVIE";
    const titles = [media2.title.romaji, media2.title.english].filter((t) => Boolean(t));
    const streaming = streamingIndex(media2);
    const source = await match({
      titles,
      format: media2.format ?? "TV",
      episodes: expectedEpisodeCount(media2),
      malId: media2.idMal ?? null
    }).catch((err) => {
      log4.warn(`match failed for ${mediaId}:`, String(err));
      return null;
    });
    let episodes = [];
    if (source) {
      const sorted = [...source.episodes].sort((a, b) => a.number - b.number);
      for (const e of isMovie ? sorted.slice(0, 1) : sorted) {
        const n = isMovie ? 1 : e.number;
        const meta = streaming.get(n);
        const own = (e.title ?? "").trim();
        const title = isMovie ? "Full movie" : own && !GENERIC_TITLE.test(own) ? own : meta?.title ?? `Episode ${n}`;
        episodes.push({
          number: n,
          title,
          subUrl: e.sub ?? (source.aniId ? `${MEGAPLAY}/stream/ani/${source.aniId}/${n}/sub` : null),
          dubUrl: e.dub ?? null,
          thumbnail: meta?.thumbnail ?? null
        });
      }
      log4.info(`matched ${mediaId} \u2192 source ${source.id} (${episodes.length} episodes)`);
    }
    const need = episodes.filter((e) => !e.thumbnail).map((e) => e.number);
    if (need.length && media2.idMal && !isMovie) {
      const stills = await Promise.race([kitsuStills(media2.idMal, need).catch(() => null), new Promise((r) => setTimeout(() => r(null), 6e3))]);
      if (stills) for (const e of episodes) e.thumbnail ??= stills.get(e.number) ?? null;
    }
    const fallback = episodes.length === 0;
    if (fallback) {
      const total = expectedEpisodeCount(media2);
      episodes = Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const meta = streaming.get(n);
        return {
          number: n,
          title: isMovie ? "Full movie" : meta?.title ?? `Episode ${n}`,
          subUrl: `${MEGAPLAY}/stream/ani/${mediaId}/${n}/sub`,
          dubUrl: null,
          thumbnail: meta?.thumbnail ?? null
        };
      });
      log4.warn(`no provider match for ${mediaId}; using AniList-id embeds`);
    }
    return {
      mediaId,
      sourceId: source?.id ?? null,
      fallback,
      hasDub: episodes.some((e) => e.dubUrl),
      episodes
    };
  }, force);
  allowEmbedHosts(list3.episodes.flatMap((e) => [e.subUrl, e.dubUrl]));
  return list3;
}

// ../src/shared/types.ts
var MANGA_PROVIDERS = [
  { id: "mangadex", name: "MangaDex", note: "Community scanlations with chapter titles and groups" },
  { id: "weebcentral", name: "WeebCentral", note: "Large catalogue, strong on manhwa and manhua" },
  { id: "flame", name: "Flame Comics", note: "New Korean manhwa, often the only English source" },
  { id: "mangapill", name: "MangaPill", note: "Fast, popular manga; a good fallback" }
];

// src/sources/flame.ts
var BASE = "https://flamecomics.xyz";
var FLAME_REFERER = `${BASE}/`;
var norm2 = (s) => s.toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]/g, "");
var catalogue = null;
async function list2() {
  if (catalogue && Date.now() - catalogue.at < 6 * 36e5) return catalogue.list;
  const data = await retry(() => getJson(`${BASE}/api/series`, { timeoutMs: 15e3, headers: { Referer: FLAME_REFERER } }));
  catalogue = { at: Date.now(), list: Array.isArray(data) ? data : [] };
  return catalogue.list;
}
async function match2(titles) {
  const wanted = new Set(titles.map(norm2).filter(Boolean));
  const hit = (await list2()).find((s) => wanted.has(norm2(decodeEntities(s.label))));
  return hit ? { id: String(hit.id), title: decodeEntities(hit.label) } : null;
}
async function chapters(seriesId) {
  const html = await retry(() => getText(`${BASE}/series/${seriesId}`, { timeoutMs: 2e4, headers: { Referer: FLAME_REFERER } }));
  const seen = /* @__PURE__ */ new Set();
  const list3 = [];
  for (const chunk of html.split('"chapter_id":').slice(1)) {
    const head = chunk.slice(0, 600);
    const token = /"token":"([a-f0-9]+)"/.exec(head)?.[1];
    const raw = /"chapter":"([^"]+)"/.exec(head)?.[1];
    if (!token || seen.has(token) || !head.includes(`"series_id":${seriesId},`)) continue;
    seen.add(token);
    const title = /"title":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
    const released = Number(/"release_date":(\d+)/.exec(head)?.[1]);
    const n = Number(raw);
    list3.push({
      id: `flame:${seriesId}/${token}`,
      provider: "flame",
      number: raw ? Number.isFinite(n) ? String(n) : raw : null,
      title: title ? decodeEntities(JSON.parse(`"${title}"`)) : null,
      volume: null,
      group: "Flame Comics",
      pages: null,
      publishedAt: released ? released * 1e3 : null,
      externalUrl: null
    });
  }
  return list3.sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0));
}
async function pages(sourceId) {
  const [seriesId, token] = sourceId.split("/");
  const html = await retry(() => getText(`${BASE}/series/${seriesId}/${token}`, { timeoutMs: 15e3, headers: { Referer: FLAME_REFERER } }));
  const re = new RegExp(`https://cdn\\.flamecomics\\.xyz/uploads/images/series/${seriesId}/${token}/[^"\\\\\\s?]+(?:\\?\\d+)?`, "g");
  const urls = [...new Set(html.match(re) ?? [])];
  return urls.map((url) => ({ url }));
}
async function ping() {
  catalogue = null;
  await list2();
}

// src/sources/mangadex.ts
var log5 = logger("mangadex");
var API2 = "https://api.mangadex.org";
var HEADERS = { "User-Agent": "PlayzAnime/0.1 (web reader)" };
async function ping2() {
  const res = await fetch(`${API2}/ping`, { headers: HEADERS, signal: AbortSignal.timeout(1e4) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
function ratingParams(adultAllowed) {
  const ratings = adultAllowed ? ["safe", "suggestive", "erotica", "pornographic"] : ["safe", "suggestive", "erotica"];
  return ratings.map((r) => `contentRating[]=${r}`).join("&");
}
var norm3 = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function titlesOf(m) {
  return [...Object.values(m.attributes.title), ...m.attributes.altTitles.flatMap((t) => Object.values(t))];
}
async function findByAnilist(anilistId, titles, adultAllowed) {
  let fallback = null;
  for (const title of titles.slice(0, 3)) {
    const url = `${API2}/manga?title=${encodeURIComponent(title)}&limit=10&${ratingParams(adultAllowed)}&order[relevance]=desc`;
    const res = await retry(() => getJson(url, { headers: HEADERS, timeoutMs: 12e3 }));
    for (const m of res.data) {
      const name = m.attributes.title.en ?? Object.values(m.attributes.title)[0] ?? title;
      if (m.attributes.links?.al === String(anilistId)) return { id: m.id, title: name };
      if (!fallback && titlesOf(m).some((t) => norm3(t) === norm3(title))) fallback = { id: m.id, title: name };
    }
  }
  return fallback;
}
async function chapters2(mangaId, adultAllowed, language = "en") {
  const all = [];
  for (let offset = 0, page = 0; page < 12; page++, offset += 500) {
    const url = `${API2}/manga/${mangaId}/feed?translatedLanguage[]=${language}&limit=500&offset=${offset}&order[volume]=asc&order[chapter]=asc&includes[]=scanlation_group&${ratingParams(adultAllowed)}`;
    const res = await retry(() => getJson(url, { headers: HEADERS, timeoutMs: 15e3 }));
    all.push(...res.data);
    if (offset + 500 >= res.total) break;
  }
  const byNumber = /* @__PURE__ */ new Map();
  for (const c of all) {
    const key = c.attributes.chapter ?? `oneshot:${c.id}`;
    const prev = byNumber.get(key);
    const hosted = !c.attributes.externalUrl && c.attributes.pages > 0;
    const prevHosted = prev && !prev.attributes.externalUrl && prev.attributes.pages > 0;
    if (!prev || hosted && !prevHosted) byNumber.set(key, c);
  }
  return [...byNumber.values()].map((c) => ({
    id: `mangadex:${c.id}`,
    provider: "mangadex",
    number: c.attributes.chapter,
    title: c.attributes.title || null,
    volume: c.attributes.volume,
    group: c.relationships.find((r) => r.type === "scanlation_group")?.attributes?.name ?? null,
    pages: c.attributes.pages || null,
    publishedAt: Date.parse(c.attributes.readableAt ?? c.attributes.publishAt ?? "") || null,
    externalUrl: c.attributes.externalUrl
  }));
}
async function pages2(chapterUuid, dataSaver = false) {
  const res = await retry(
    () => getJson(`${API2}/at-home/server/${chapterUuid}`, {
      headers: HEADERS,
      timeoutMs: 12e3
    })
  );
  if (!res.chapter?.data?.length) {
    log5.warn(`chapter ${chapterUuid} has no pages`);
    return [];
  }
  if (dataSaver && res.chapter.dataSaver?.length) {
    return res.chapter.dataSaver.map((file2) => ({ url: `${res.baseUrl}/data-saver/${res.chapter.hash}/${file2}` }));
  }
  return res.chapter.data.map((file2) => ({ url: `${res.baseUrl}/data/${res.chapter.hash}/${file2}` }));
}

// src/sources/weebcentral.ts
var BASE2 = "https://weebcentral.com";
var WEEBCENTRAL_REFERER = `${BASE2}/`;
var norm4 = (s) => s.toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]/g, "");
var READABLE_KINDS = ["manga", "manhwa", "manhua", "oel"];
function plainQuery(title) {
  return title.replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑‒–—―]/g, "-").replace(/\s+/g, " ").trim();
}
async function search2(query) {
  const url = `${BASE2}/search/data?text=${encodeURIComponent(plainQuery(query))}&sort=Best%20Match&order=Descending&official=Any&display_mode=Minimal%20Display&limit=16&offset=0`;
  const html = await retry(() => getText(url, { timeoutMs: 15e3, headers: { "HX-Request": "true", Referer: WEEBCENTRAL_REFERER } }));
  const hits = [];
  for (const article of html.split("<article").slice(1)) {
    const link = /href="https:\/\/weebcentral\.com\/series\/([A-Z0-9]+)\/[^"]*"[^>]*data-tip="([^"]*)"/.exec(article);
    if (!link) continue;
    const meta = [...article.matchAll(/<div>([^<]+)<\/div>/g)].map((m) => m[1].trim());
    hits.push({
      id: link[1],
      title: decodeEntities(link[2]),
      kind: meta[0] ?? null,
      year: meta.map(Number).find((n) => n > 1900 && n < 2100) ?? null
    });
  }
  return hits;
}
var STOP_WORDS = /* @__PURE__ */ new Set(["the", "and", "for", "with", "from", "into", "wa", "no", "ga", "wo", "ni", "de", "to"]);
function keywords(title) {
  return title.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase())).slice(0, 6).join(" ");
}
async function match3(titles, year) {
  for (const title of titles.slice(0, 3)) {
    const t = norm4(title);
    for (const query of [.../* @__PURE__ */ new Set([plainQuery(title), keywords(title)])].filter(Boolean)) {
      const hits = (await search2(query)).filter((h) => !h.kind || READABLE_KINDS.includes(h.kind.toLowerCase()));
      const exact = hits.filter((h) => norm4(h.title) === t);
      const pick = exact.find((h) => !year || !h.year || Math.abs(h.year - year) <= 1) ?? (exact.length === 1 ? exact[0] : void 0);
      if (pick) return pick;
    }
  }
  return null;
}
async function chapters3(seriesId) {
  const html = await retry(() => getText(`${BASE2}/series/${seriesId}/full-chapter-list`, { timeoutMs: 2e4, headers: { "HX-Request": "true", Referer: WEEBCENTRAL_REFERER } }));
  const list3 = [];
  const seen = /* @__PURE__ */ new Set();
  const re = /<a href="(?:https:\/\/weebcentral\.com)?\/chapters\/([A-Z0-9]+)"[\s\S]*?<span class="">([^<]+)<\/span>[\s\S]*?<time[^>]*datetime="([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const label = decodeEntities(m[2].trim());
    const num2 = /(\d+(?:\.\d+)?)/.exec(label)?.[1] ?? null;
    const plain = /^(chapter|episode|ch\.?)\s*[\d.]+$/i.test(label);
    list3.push({
      id: `weebcentral:${m[1]}`,
      provider: "weebcentral",
      number: num2,
      // "Side Story 3" or "Season 2 Episode 1" keep their wording; plain "Chapter 12" needs none.
      title: plain ? null : label,
      volume: null,
      group: null,
      pages: null,
      publishedAt: Date.parse(m[3]) || null,
      externalUrl: null
    });
  }
  return list3.reverse();
}
async function pages3(chapterId) {
  const html = await retry(
    () => getText(`${BASE2}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`, {
      timeoutMs: 15e3,
      headers: { "HX-Request": "true", Referer: WEEBCENTRAL_REFERER }
    })
  );
  const urls = [...html.matchAll(/<img[^>]+src="(https:\/\/[^"]+)"[^>]*alt="Page \d+"/g)].map((m) => decodeEntities(m[1]));
  return urls.map((url) => ({ url }));
}
async function ping3() {
  await search2("one piece");
}

// src/sources/mangapill.ts
var BASE3 = "https://mangapill.com";
var MANGAPILL_REFERER = `${BASE3}/`;
var norm5 = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
async function search3(query) {
  const html = await retry(() => getText(`${BASE3}/search?q=${encodeURIComponent(plainQuery(query))}`, { timeoutMs: 15e3 }));
  const root = parse(html);
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  for (const card of root.querySelectorAll('a[href^="/manga/"]')) {
    const path5 = card.getAttribute("href") ?? "";
    const titleEl = card.querySelector(".font-black");
    if (!titleEl || seen.has(path5)) continue;
    seen.add(path5);
    const alt = card.querySelector(".text-xs")?.text.trim() || null;
    const tags = card.parentNode?.querySelectorAll(".rounded") ?? [];
    const yearTag = tags.map((t) => t.text.trim()).find((t) => /^\d{4}$/.test(t));
    hits.push({
      path: path5,
      title: decodeEntities(titleEl.text.trim()),
      altTitle: alt ? decodeEntities(alt) : null,
      year: yearTag ? Number(yearTag) : null
    });
  }
  return hits;
}
var isNovel = (h) => /\bnovel\b/i.test(`${h.title} ${h.altTitle ?? ""}`);
var yearFits = (h, year) => !year || !h.year || Math.abs(h.year - year) <= 1;
async function match4(titles, year) {
  let loose = null;
  for (const title of titles.slice(0, 3)) {
    const hits = (await search3(title)).filter((h) => !isNovel(h));
    const t = norm5(title);
    const names = (h) => [norm5(h.title), h.altTitle ? norm5(h.altTitle) : ""].filter(Boolean);
    const exact = hits.filter((h) => names(h).includes(t));
    const pick = exact.find((h) => yearFits(h, year)) ?? exact[0];
    if (pick) return pick;
    loose ??= hits.find(
      (h) => year !== null && h.year !== null && yearFits(h, year) && names(h).some((n) => Math.min(n.length, t.length) >= 8 && (n.startsWith(t) || t.startsWith(n)))
    ) ?? null;
  }
  return loose;
}
async function chapters4(path5) {
  const html = await retry(() => getText(`${BASE3}${path5}`, { timeoutMs: 15e3 }));
  const root = parse(html);
  const seen = /* @__PURE__ */ new Set();
  const list3 = [];
  for (const a of root.querySelectorAll('a[href^="/chapters/"]')) {
    const href = a.getAttribute("href") ?? "";
    if (seen.has(href)) continue;
    seen.add(href);
    const text = a.text.trim();
    const num2 = /chapter\s+([\d.]+)/i.exec(text)?.[1] ?? null;
    list3.push({
      id: `mangapill:${href}`,
      provider: "mangapill",
      number: num2,
      title: null,
      volume: null,
      group: null,
      pages: null,
      publishedAt: null,
      externalUrl: null
    });
  }
  return list3.reverse();
}
async function pages4(chapterPath) {
  const html = await retry(() => getText(`${BASE3}${chapterPath}`, { timeoutMs: 15e3 }));
  const root = parse(html);
  const result = root.querySelectorAll("img.js-page").map((img) => ({
    url: img.getAttribute("data-src") ?? img.getAttribute("src") ?? "",
    width: Number(img.getAttribute("width")) || null,
    height: Number(img.getAttribute("height")) || null
  }));
  return result.filter((p) => /^https?:\/\//.test(p.url));
}

// src/manga.ts
var log6 = logger("manga");
var cache3 = new TtlCache(200);
var MIN2 = 6e4;
function titlesFor(media2) {
  const t = media2.title;
  return [...new Set([t.romaji, t.english, ...(media2.synonyms ?? []).slice(0, 2)].filter((s) => Boolean(s)))];
}
var SOURCES = {
  mangadex: {
    find: async (media2, adult) => {
      const hit = await findByAnilist(media2.id, titlesFor(media2), adult);
      return hit ? { sourceId: hit.id, title: hit.title } : null;
    },
    chapters: (id, adult) => chapters2(id, adult),
    pages: (id, saver) => pages2(id, saver),
    ping: () => ping2(),
    idPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    adultAware: true
  },
  weebcentral: {
    find: async (media2) => {
      const hit = await match3(titlesFor(media2), media2.startDate?.year ?? null);
      return hit ? { sourceId: hit.id, title: hit.title } : null;
    },
    chapters: (id) => chapters3(id),
    pages: (id) => pages3(id),
    ping: () => ping3(),
    referer: WEEBCENTRAL_REFERER,
    idPattern: /^[A-Z0-9]{10,40}$/
  },
  flame: {
    find: async (media2) => {
      const hit = await match2(titlesFor(media2));
      return hit ? { sourceId: hit.id, title: hit.title } : null;
    },
    chapters: (id) => chapters(id),
    pages: (id) => pages(id),
    ping: () => ping(),
    referer: FLAME_REFERER,
    idPattern: /^\d+\/[a-f0-9]+$/
  },
  mangapill: {
    find: async (media2) => {
      const hit = await match4(titlesFor(media2), media2.startDate?.year ?? null);
      return hit ? { sourceId: hit.path, title: hit.title } : null;
    },
    chapters: (path5) => chapters4(path5),
    pages: (path5) => pages4(path5),
    ping: () => search3("one piece"),
    referer: MANGAPILL_REFERER,
    // A path on mangapill.com; no "@", "//" or ".." that could point the request elsewhere.
    idPattern: /^\/chapters\/[\w-]+(?:\/[\w.-]+)*$/
  }
};
function refererFor(provider) {
  return SOURCES[provider]?.referer;
}
var health = /* @__PURE__ */ new Map();
var HEALTH_TTL = 10 * MIN2;
async function check(provider) {
  const started = Date.now();
  try {
    await Promise.race([SOURCES[provider].ping(), new Promise((_, reject) => setTimeout(() => reject(new Error("No answer in 10 seconds")), 1e4))]);
    return { provider, ok: true, ms: Date.now() - started, checkedAt: Date.now(), error: null };
  } catch (err) {
    return { provider, ok: false, ms: Date.now() - started, checkedAt: Date.now(), error: err instanceof Error ? err.message : String(err) };
  }
}
async function providerHealth(force = false) {
  return Promise.all(
    MANGA_PROVIDERS.map(async ({ id }) => {
      const known2 = health.get(id);
      if (!force && known2 && Date.now() - known2.checkedAt < HEALTH_TTL) return known2;
      const result = await check(id);
      health.set(id, result);
      if (!result.ok) log6.warn(`${id} is down: ${result.error}`);
      return result;
    })
  );
}
function latestReadable(chapters5) {
  let best = null;
  for (const c of chapters5) {
    if (c.externalUrl) continue;
    const n = Number(c.number);
    if (Number.isFinite(n) && (best === null || n > best)) best = n;
  }
  return best === null ? null : String(best);
}
async function loadProvider(provider, media2, adultAllowed, force) {
  const down = health.get(provider);
  if (!force && down && !down.ok && Date.now() - down.checkedAt < HEALTH_TTL) {
    return { summary: { provider, sourceId: null, title: null, chapterCount: 0, latest: null, error: `Unreachable right now (${down.error})` }, chapters: [] };
  }
  const source = SOURCES[provider];
  const variant = source.adultAware && adultAllowed ? ":adult" : "";
  return cache3.wrap(
    `chapters:${provider}:${media2.id}${variant}`,
    20 * MIN2,
    async () => {
      try {
        const hit = await source.find(media2, adultAllowed);
        const chapters5 = hit ? await source.chapters(hit.sourceId, adultAllowed) : [];
        return {
          summary: { provider, sourceId: hit?.sourceId ?? null, title: hit?.title ?? null, chapterCount: chapters5.length, latest: latestReadable(chapters5) },
          chapters: chapters5
        };
      } catch (err) {
        log6.warn(`${provider} failed for ${media2.id}:`, String(err));
        return {
          summary: { provider, sourceId: null, title: null, chapterCount: 0, latest: null, error: err instanceof Error ? err.message : String(err) },
          chapters: []
        };
      }
    },
    force
  );
}
var readable = (r) => r.chapters.filter((c) => !c.externalUrl).length;
var RICHNESS = { mangadex: 3, flame: 2, weebcentral: 1, mangapill: 0 };
async function chapterList(mediaId, prefs, provider, force = false) {
  const media2 = await media(mediaId);
  void providerHealth().catch(() => {
  });
  const results = await Promise.all(MANGA_PROVIDERS.map(({ id }) => loadProvider(id, media2, !prefs.hideAdult, force)));
  const preferred = provider ?? (prefs.mangaProvider !== "auto" ? prefs.mangaProvider : null);
  let chosen = preferred ? results.find((r) => r.summary.provider === preferred && readable(r)) : void 0;
  if (!chosen) {
    chosen = [...results].sort((a, b) => {
      const diff = Number(b.summary.latest ?? -1) - Number(a.summary.latest ?? -1);
      return Math.abs(diff) >= 1 ? diff : readable(b) - readable(a) || RICHNESS[b.summary.provider] - RICHNESS[a.summary.provider];
    })[0];
  }
  return {
    mediaId,
    provider: chosen && chosen.chapters.length ? chosen.summary.provider : null,
    chapters: chosen?.chapters ?? [],
    providers: results.map((r) => r.summary)
  };
}
var UnknownChapterError = class extends Error {
};
function parseChapterId(id) {
  const [provider, ...rest] = id.split(":");
  const sourceId = rest.join(":");
  const source = SOURCES[provider];
  if (!source) throw new UnknownChapterError("That chapter comes from a source PlayzAnime no longer uses.");
  if (!source.idPattern.test(sourceId)) throw new UnknownChapterError("That chapter link is not one PlayzAnime recognises.");
  return { provider, sourceId };
}
function chapterPages(chapter, prefs) {
  const { provider, sourceId } = parseChapterId(chapter.id);
  const saver = prefs.dataSaver;
  return cache3.wrap(`pages:${chapter.id}:${saver}`, 5 * MIN2, () => SOURCES[provider].pages(sourceId, saver));
}

// src/prefs.ts
var DEFAULT_PREFS = { hideAdult: true, dataSaver: false, mangaProvider: "auto", titleLanguage: "english" };
var PROVIDER_IDS = new Set(MANGA_PROVIDERS.map((p) => p.id));
function readPrefs(req) {
  const raw = req.headers["x-pz-prefs"];
  if (typeof raw !== "string" || !raw) return { ...DEFAULT_PREFS };
  let parsed;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return { ...DEFAULT_PREFS };
    parsed = value;
  } catch {
    return { ...DEFAULT_PREFS };
  }
  const provider = parsed.mangaProvider;
  return {
    hideAdult: typeof parsed.hideAdult === "boolean" ? parsed.hideAdult : DEFAULT_PREFS.hideAdult,
    dataSaver: typeof parsed.dataSaver === "boolean" ? parsed.dataSaver : DEFAULT_PREFS.dataSaver,
    mangaProvider: provider === "auto" || typeof provider === "string" && PROVIDER_IDS.has(provider) ? provider : "auto",
    titleLanguage: parsed.titleLanguage === "romaji" ? "romaji" : "english"
  };
}

// src/proxy/routes.ts
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// src/proxy/guard.ts
import { lookup } from "node:dns/promises";
import net from "node:net";
var blocked = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8],
  // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  // multicast
  ["240.0.0.0", 4]
  // reserved, broadcast
]) {
  blocked.addSubnet(prefix, bits, "ipv4");
}
for (const [prefix, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  // unique local
  ["fe80::", 10],
  // link-local
  ["ff00::", 8],
  // multicast
  ["2001:db8::", 32]
  // documentation
]) {
  blocked.addSubnet(prefix, bits, "ipv6");
}
var BlockedHostError = class extends Error {
};
function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family !== 6) return true;
  const lower = address.toLowerCase();
  const embedded = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (embedded) return blocked.check(embedded, "ipv4");
  return blocked.check(lower, "ipv6");
}
async function assertPublicUrl(raw) {
  const url = typeof raw === "string" ? new URL(raw) : raw;
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BlockedHostError(`Only web addresses can be fetched (${url.protocol}).`);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || /\.(localhost|local|internal|home\.arpa)$/.test(host)) {
    throw new BlockedHostError(`Refusing to fetch from a local address (${host}).`);
  }
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new BlockedHostError(`Refusing to fetch from a private or local address (${host}).`);
  }
  return url;
}
async function guardedFetch(raw, init, maxRedirects = 5) {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel().catch(() => {
    });
    if (hop >= maxRedirects) throw new Error("The source redirected too many times.");
    url = await assertPublicUrl(new URL(location, url));
  }
}

// src/proxy/sign.ts
import { createHmac, timingSafeEqual } from "node:crypto";
function signature(u, r) {
  return createHmac("sha256", config.proxySecret).update(`${u}|${r}`).digest("base64url");
}
function verify(u, r, s) {
  const expected = Buffer.from(signature(u, r));
  const given = Buffer.from(s);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
function build(route, u, r) {
  return `${config.publicUrl}${config.proxyBase}/${route}?u=${encodeURIComponent(u)}&r=${encodeURIComponent(r)}&s=${signature(u, r)}`;
}
var hlsUrl = (u, referer) => build("hls", u, referer);
var fileUrl = (u, referer) => build("file", u, referer);

// src/proxy/playlist.ts
var PLAYLIST_TAG = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT)\b/;
var M3U8 = /\.m3u8(\?|#|$)/i;
function absolute(uri, base) {
  try {
    const url = new URL(uri, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
function rewritePlaylist(text, base, referer) {
  let nextIsPlaylist = false;
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) {
      if (t.startsWith("#EXT-X-STREAM-INF")) nextIsPlaylist = true;
      const tagIsPlaylist = PLAYLIST_TAG.test(t);
      return t.replace(/URI="([^"]*)"/g, (whole, uri) => {
        const abs2 = absolute(uri, base);
        if (!abs2) return whole;
        return `URI="${tagIsPlaylist || M3U8.test(abs2) ? hlsUrl(abs2, referer) : fileUrl(abs2, referer)}"`;
      });
    }
    const abs = absolute(t, base);
    const playlist = nextIsPlaylist || abs !== null && M3U8.test(abs);
    nextIsPlaylist = false;
    if (!abs) return line;
    return playlist ? hlsUrl(abs, referer) : fileUrl(abs, referer);
  }).join("\n");
}

// src/proxy/routes.ts
var log7 = logger("proxy");
var MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
var HEADERS_TIMEOUT = 2e4;
var MONTH = 2592e3;
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  "Cross-Origin-Resource-Policy": "cross-origin"
};
var PASS_REQUEST = ["range", "if-range", "if-none-match", "if-modified-since"];
var PASS_RESPONSE = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
function isWebUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}
function fail(res, status, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { ...CORS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(message);
}
function signedTarget(url, res) {
  const u = url.searchParams.get("u") ?? "";
  const r = url.searchParams.get("r") ?? "";
  const s = url.searchParams.get("s") ?? "";
  if (!isWebUrl(u) || r && !isWebUrl(r)) {
    fail(res, 400, "Proxy links need a web address.");
    return null;
  }
  if (!s || !verify(u, r, s)) {
    fail(res, 403, "This link was not issued by this server, or it expired when the server restarted.");
    return null;
  }
  return { u, r };
}
function sourceHeaders(r, image) {
  const headers = { "User-Agent": CHROME_UA, Accept: "*/*" };
  if (r) {
    headers.Referer = r;
    if (!image) headers.Origin = new URL(r).origin;
  }
  return headers;
}
function upstreamError(res, err, target) {
  if (err instanceof BlockedHostError) return fail(res, 403, err.message);
  const host = (() => {
    try {
      return new URL(target).host;
    } catch {
      return "the source";
    }
  })();
  const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
  log7.warn(`${timedOut ? "timeout" : "failed"} ${target}:`, err instanceof Error ? err.message : String(err));
  fail(res, timedOut ? 504 : 502, timedOut ? `${host} took too long to answer.` : `Couldn't reach ${host}.`);
}
function proxyPreflight(res) {
  res.writeHead(204, {
    ...CORS,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, If-Range, If-None-Match, If-Modified-Since",
    "Access-Control-Max-Age": "86400"
  });
  res.end();
}
async function proxyHls(req, res, url) {
  const target = signedTarget(url, res);
  if (!target) return;
  let upstream;
  try {
    upstream = await guardedFetch(target.u, { headers: sourceHeaders(target.r, false), signal: AbortSignal.timeout(15e3) });
  } catch (err) {
    return upstreamError(res, err, target.u);
  }
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => {
    });
    return fail(res, upstream.status === 404 ? 404 : 502, `The stream host answered with HTTP ${upstream.status}.`);
  }
  if (Number(upstream.headers.get("content-length")) > MAX_PLAYLIST_BYTES) {
    await upstream.body?.cancel().catch(() => {
    });
    return fail(res, 502, "The stream host sent a playlist that is far too large.");
  }
  let text;
  try {
    text = await upstream.text();
  } catch (err) {
    return upstreamError(res, err, target.u);
  }
  if (!text.trimStart().startsWith("#EXTM3U")) return fail(res, 502, "The stream host did not send a playlist.");
  const body = rewritePlaylist(text, upstream.url || target.u, target.r);
  res.writeHead(200, {
    ...CORS,
    "Content-Type": "application/vnd.apple.mpegurl",
    "Content-Length": Buffer.byteLength(body),
    // Live playlists change between reloads; VOD ones are tiny. Neither is worth caching.
    "Cache-Control": "no-cache"
  });
  res.end(req.method === "HEAD" ? void 0 : body);
}
async function proxyFile(req, res, url) {
  const target = signedTarget(url, res);
  if (!target) return;
  const dest = String(req.headers["sec-fetch-dest"] ?? "");
  const headers = sourceHeaders(target.r, dest === "image");
  headers["Accept-Encoding"] = "identity";
  for (const name of PASS_REQUEST) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const headerTimer = setTimeout(() => abort.abort(new DOMException("No answer in time", "TimeoutError")), HEADERS_TIMEOUT);
  let upstream;
  try {
    upstream = await guardedFetch(target.u, { method: req.method === "HEAD" ? "HEAD" : "GET", headers, signal: abort.signal });
  } catch (err) {
    clearTimeout(headerTimer);
    if (abort.signal.aborted && res.destroyed) return;
    return upstreamError(res, err, target.u);
  } finally {
    clearTimeout(headerTimer);
  }
  const out = { ...CORS };
  for (const name of PASS_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out[name] = value;
  }
  const type = upstream.headers.get("content-type") ?? "";
  const image = dest === "image" || dest !== "empty" && type.startsWith("image/");
  if (upstream.ok && image) out["cache-control"] = `public, max-age=${MONTH}, immutable`;
  else if (upstream.ok) out["cache-control"] = upstream.headers.get("cache-control") ?? "public, max-age=3600";
  else out["cache-control"] = "no-store";
  res.writeHead(upstream.status, out);
  if (!upstream.body || req.method === "HEAD" || upstream.status === 304) {
    await upstream.body?.cancel().catch(() => {
    });
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (!res.destroyed || !abort.signal.aborted) log7.debug(`stream ended early for ${target.u}:`, String(err));
    res.destroy();
  }
}

// src/stream/browser.ts
var log8 = logger("browser");
var RESOLVE_TIMEOUT = 25e3;
var GRACE_AFTER_PLAYLIST = 900;
var MAX_PARALLEL = 2;
var IDLE_CLOSE = 2 * 6e4;
var BLOCKED_HOSTS = /(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|statlytic\.net|plausible\.io|cloudflareinsights\.com|tiktokcdn\.com|rtmark\.net|nekostream\.site|jwpltx\.com|llvpn\.com|gstatic\.com)$/i;
var browser = null;
var idleTimer = null;
async function launch() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("This episode needs a browser to start, and Playwright is not installed next to the server.");
  }
  const failures = [];
  for (const channel of ["msedge", "chrome", void 0]) {
    try {
      const b = await chromium.launch({ channel, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
      log8.info(`started headless ${channel ?? "chromium"}`);
      b.on("disconnected", () => browser = null);
      return b;
    } catch (err) {
      failures.push(`${channel ?? "chromium"}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  log8.warn("no browser could start:", failures.join(" | "));
  throw new Error("This episode needs a browser to start, and neither Microsoft Edge nor Google Chrome could be opened on the server.");
}
function getBrowser() {
  if (idleTimer) clearTimeout(idleTimer);
  browser ??= launch().catch((err) => {
    browser = null;
    throw err;
  });
  return browser;
}
function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_CLOSE);
  idleTimer.unref();
}
async function closeBrowser() {
  const b = browser;
  browser = null;
  if (b) await (await b.catch(() => null))?.close().catch(() => {
  });
}
var running = 0;
var waiting = [];
async function gate(fn) {
  if (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
    if (running === 0) scheduleIdleClose();
  }
}
function captureFromEmbed(embedUrl) {
  return gate(async () => {
    const origin = new URL(embedUrl).origin;
    const context = await (await getBrowser()).newContext({
      userAgent: CHROME_UA,
      viewport: { width: 960, height: 540 },
      serviceWorkers: "block"
    });
    const found = { playlists: [], subtitles: [], getSources: null };
    try {
      const page = await context.newPage();
      context.on("page", (p) => {
        if (p !== page) void p.close().catch(() => {
        });
      });
      await page.route("**/*", (route) => {
        const req = route.request();
        const type = req.resourceType();
        let host = "";
        try {
          host = new URL(req.url()).hostname;
        } catch {
        }
        if (type === "image" || type === "font" || type === "media" || BLOCKED_HOSTS.test(host)) return route.abort();
        return route.continue();
      });
      let sawPlaylist = () => {
      };
      const firstPlaylist = new Promise((resolve) => sawPlaylist = resolve);
      page.on("request", (req) => {
        const u = req.url();
        if (u.includes("ping.gif")) return;
        if (/\.m3u8(\?|$)/i.test(u) && !found.playlists.includes(u)) {
          found.playlists.push(u);
          sawPlaylist();
        } else if (/getSources/i.test(u) && !found.getSources) {
          found.getSources = u;
        } else if (/\.(vtt|srt)(\?|$)/i.test(u) && !found.subtitles.includes(u)) {
          found.subtitles.push(u);
        }
      });
      const deadline = Date.now() + RESOLVE_TIMEOUT;
      try {
        await page.goto(embedUrl, { referer: `${origin}/`, waitUntil: "commit", timeout: RESOLVE_TIMEOUT });
      } catch (err) {
        throw new Error(`The player page failed to load (${err instanceof Error ? err.message.split("\n")[0] : String(err)}).`);
      }
      const timedOut = await Promise.race([
        firstPlaylist.then(() => false),
        new Promise((r) => setTimeout(() => r(true), Math.max(0, deadline - Date.now())))
      ]);
      if (!timedOut) await new Promise((r) => setTimeout(r, GRACE_AFTER_PLAYLIST));
      if (!found.playlists.length) throw new Error("The player did not start a stream in time.");
      return found;
    } finally {
      await context.close().catch(() => {
      });
    }
  });
}

// src/stream/megaplay.ts
var log9 = logger("megaplay");
var PLAYLIST = /\.m3u8(\?|$)/i;
function playerId(html) {
  const root = parse(html);
  const fromDiv = root.querySelector("#megaplay-player")?.getAttribute("data-id") ?? root.querySelector("[data-id]")?.getAttribute("data-id");
  if (fromDiv && /^\d+$/.test(fromDiv)) return fromDiv;
  return /<title>\s*File\s+(\d+)/i.exec(html)?.[1] ?? null;
}
function sourcesUrl(embedUrl, id) {
  const embed = new URL(embedUrl);
  const url = new URL("/stream/getSources", embed.origin);
  url.searchParams.set("id", id);
  const s = (embed.searchParams.get("s") ?? "").replace(/[^a-z0-9_-]/gi, "");
  if (s) url.searchParams.set("s", s);
  return url.toString();
}
var mirror = null;
async function fallbackMirror(origin) {
  if (mirror && Date.now() - mirror.at < 10 * 6e4) return mirror.host;
  const data = await getJson(`${origin}/lib/check_domain.json?cache_burst=${Date.now()}`, {
    headers: { Referer: `${origin}/` },
    timeoutMs: 6e3
  }).catch(() => null);
  const host = typeof data?.fallback === "string" && /^[a-z0-9.-]+$/i.test(data.fallback) ? data.fallback : null;
  mirror = { at: Date.now(), host };
  return host;
}
async function masterCandidates(sources, origin) {
  const out = [];
  const clear = typeof sources.sources === "string" ? sources.sources : Array.isArray(sources.sources) ? sources.sources[0]?.file : sources.file;
  if (clear && PLAYLIST.test(clear)) out.push(clear);
  const folders = /* @__PURE__ */ new Set();
  for (const t of sources.tracks ?? []) {
    const m = t.file ? /^(https?:\/\/[^/]+\/.+?)\/(?:subtitles|thumbnails?|sprites?)\//i.exec(t.file) : null;
    if (m) folders.add(m[1]);
  }
  const alt = folders.size ? await fallbackMirror(origin) : null;
  for (const folder of folders) {
    out.push(`${folder}/master.m3u8`);
    if (alt) {
      const u = new URL(`${folder}/master.m3u8`);
      u.host = alt;
      out.push(u.toString());
    }
  }
  return [...new Set(out)].slice(0, 4);
}
async function fetchPlaylist(url, referer) {
  try {
    await assertPublicUrl(url);
    const text = await getText(url, { headers: { Referer: referer, Origin: new URL(referer).origin }, timeoutMs: 1e4 });
    return text.trimStart().startsWith("#EXTM3U") ? text : null;
  } catch (err) {
    log9.debug(`playlist candidate failed: ${url}`, String(err));
    return null;
  }
}
async function resolveDirect(embedUrl) {
  const origin = new URL(embedUrl).origin;
  const referer = `${origin}/`;
  const html = await getText(embedUrl, { headers: { Referer: referer }, timeoutMs: 12e3 });
  const id = playerId(html);
  if (!id) {
    log9.warn(`no player id in ${embedUrl}`);
    return { sources: null, master: null, masterText: null };
  }
  const sources = await getJson(sourcesUrl(embedUrl, id), {
    headers: { Referer: embedUrl, "X-Requested-With": "XMLHttpRequest" },
    timeoutMs: 1e4
  }).catch((err) => {
    log9.warn(`getSources failed for file ${id}:`, String(err));
    return null;
  });
  if (!sources) return { sources: null, master: null, masterText: null };
  for (const candidate of await masterCandidates(sources, origin)) {
    const text = await fetchPlaylist(candidate, referer);
    if (text) return { sources, master: candidate, masterText: text };
  }
  return { sources, master: null, masterText: null };
}

// src/stream/resolve.ts
var log10 = logger("stream");
var cache4 = new TtlCache(100);
var STREAM_TTL = 5 * 6e4;
function withToken(url, master) {
  const token = /[?&]token=([^&]+)/.exec(master)?.[1];
  if (!token || url.includes("?")) return url;
  return `${url}?token=${token}`;
}
function qualityLabel(height, bandwidth) {
  let h = height;
  if (!h) {
    const kbps = bandwidth / 1e3;
    h = kbps >= 3500 ? 1080 : kbps >= 1500 ? 720 : kbps >= 800 ? 480 : 360;
  }
  const tiers = [2160, 1440, 1080, 720, 480, 360, 240];
  const tier = tiers.find((t) => h >= t * 0.9) ?? h;
  return { label: `${tier}p`, height: tier };
}
function parseMasterText(text, master) {
  if (!text.includes("#EXT-X-STREAM-INF")) {
    return [{ label: "Auto", height: 0, bandwidth: 0, url: master }];
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const uri = lines[i + 1];
    if (!uri || uri.startsWith("#")) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
    const bw = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? 0);
    const q = qualityLabel(res ? Number(res[2]) : 0, bw);
    variants.push({ label: q.label, height: q.height, bandwidth: bw, url: withToken(new URL(uri, master).toString(), master) });
  }
  variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  return variants.filter((v, i) => i === 0 || v.label !== variants[i - 1].label);
}
var LANGS = {
  eng: "English",
  en: "English",
  spa: "Spanish",
  es: "Spanish",
  ger: "German",
  deu: "German",
  de: "German",
  ita: "Italian",
  it: "Italian",
  por: "Portuguese",
  pt: "Portuguese",
  rus: "Russian",
  ru: "Russian",
  ara: "Arabic",
  ar: "Arabic",
  fra: "French",
  fre: "French",
  fr: "French",
  jpn: "Japanese",
  ja: "Japanese",
  ind: "Indonesian",
  id: "Indonesian",
  tha: "Thai",
  vie: "Vietnamese",
  may: "Malay",
  msa: "Malay"
};
function labelFromUrl(url) {
  const m = /\/([a-z]{2,3})(?:-\d+)?\.(?:vtt|srt)/i.exec(url.toLowerCase());
  return m && LANGS[m[1]] || "English";
}
function tidyLabel(label) {
  return label.replace(/\(\s*-\s*[^()]*\(([^)]+)\)\s*\)/, "($1)").replace(/\s+-\s+\w+\s*\(([^)]+)\)$/, " ($1)").replace(/\s{2,}/g, " ").trim();
}
function uniqueLabels(tracks) {
  const counts = /* @__PURE__ */ new Map();
  return tracks.map((raw) => {
    const t = { ...raw, label: tidyLabel(raw.label) };
    const n = (counts.get(t.label) ?? 0) + 1;
    counts.set(t.label, n);
    return n === 1 ? t : { ...t, label: `${t.label} ${n}` };
  });
}
function range(r) {
  if (!r || typeof r.start !== "number" || typeof r.end !== "number" || r.end <= r.start) return null;
  return { start: r.start, end: r.end };
}
async function readSources(url, embedUrl) {
  try {
    await assertPublicUrl(url);
    return await getJson(url, {
      headers: { Referer: embedUrl, "X-Requested-With": "XMLHttpRequest" },
      timeoutMs: 8e3
    });
  } catch (err) {
    log10.debug("getSources failed", String(err));
    return null;
  }
}
async function find2(embedUrl, referer) {
  const direct = await resolveDirect(embedUrl).catch((err) => {
    log10.warn(`direct resolve failed for ${embedUrl}:`, String(err));
    return null;
  });
  if (direct?.master) {
    return { master: direct.master, masterText: direct.masterText, sources: direct.sources, capturedSubs: [], via: "direct" };
  }
  log10.info(`falling back to the browser for ${embedUrl}`);
  const captured = await captureFromEmbed(embedUrl);
  let master = captured.playlists.find((u) => /master|playlist|index/i.test(u)) ?? captured.playlists[0];
  let masterText = null;
  if (/[?&]token=/.test(master)) {
    const bare = master.split("?")[0];
    const text = await assertPublicUrl(bare).then(() => getText(bare, { headers: { Referer: referer }, timeoutMs: 1e4 })).catch(() => null);
    if (text?.trimStart().startsWith("#EXTM3U")) {
      master = bare;
      masterText = text;
    }
  }
  const sources = direct?.sources ?? (captured.getSources ? await readSources(captured.getSources, embedUrl) : null);
  return { master, masterText, sources, capturedSubs: captured.subtitles, via: "browser" };
}
function resolveStream(embedUrl, force = false) {
  return cache4.wrap(
    `stream:${embedUrl}`,
    STREAM_TTL,
    async () => {
      const started = Date.now();
      const referer = `${new URL(embedUrl).origin}/`;
      const found = await find2(embedUrl, referer);
      const { master, sources } = found;
      await assertPublicUrl(master);
      let variants;
      try {
        const text = found.masterText ?? await getText(master, { headers: { Referer: referer }, timeoutMs: 12e3 });
        variants = parseMasterText(text, master);
      } catch (err) {
        log10.warn("master parse failed", String(err));
        variants = [{ label: "Auto", height: 0, bandwidth: 0, url: master }];
      }
      const subtitles = [];
      for (const t of sources?.tracks ?? []) {
        if (!t.file || t.kind && t.kind !== "captions" && t.kind !== "subtitles") continue;
        const generic = !t.label || ["subtitles", "default", "cc", "caption"].includes(t.label.toLowerCase());
        subtitles.push({ label: generic ? labelFromUrl(t.file) : t.label.trim(), url: t.file, isDefault: !!t.default });
      }
      for (const u of found.capturedSubs) {
        if (!subtitles.some((s) => s.url === u)) subtitles.push({ label: labelFromUrl(u), url: u });
      }
      log10.info(`resolved ${embedUrl} via ${found.via} in ${Date.now() - started}ms (${variants.length} variants, ${subtitles.length} subs)`);
      return {
        via: found.via,
        referer,
        stream: {
          embedUrl,
          master,
          host: new URL(master).host,
          variants,
          subtitles: uniqueLabels(subtitles),
          intro: range(sources?.intro),
          outro: range(sources?.outro),
          resolvedAt: Date.now()
        }
      };
    },
    force
  );
}

// src/app.ts
var log11 = logger("server");
var MAX_BODY = 256 * 1024;
var BadRequest = class extends Error {
};
var RelayOff = class extends Error {
  constructor() {
    super("This server plays episodes in the source\u2019s own player. Switch the player to Embed.");
  }
};
var num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequest(`${name} must be a number.`);
  return n;
};
function proxiedStream(stream2, referer) {
  return {
    ...stream2,
    master: hlsUrl(stream2.master, referer),
    variants: stream2.variants.map((v) => ({ ...v, url: hlsUrl(v.url, referer) })),
    subtitles: stream2.subtitles.map((s) => ({ ...s, url: fileUrl(s.url, referer) }))
  };
}
function proxiedPages(pages5, provider) {
  const allowed = pages5.filter((p) => !isHostBlocked(p.url));
  const referer = refererFor(provider);
  return referer ? allowed.map((p) => ({ ...p, url: fileUrl(p.url, referer) })) : allowed;
}
function embedMediaId(embedUrl) {
  const m = /\/ani\/(\d+)\//.exec(embedUrl);
  return m ? Number(m[1]) : null;
}
var HANDLERS = {
  "anilist:home": ([refresh2], p) => home(p.hideAdult, Boolean(refresh2)),
  "anilist:mangaHome": ([refresh2], p) => mangaHome(p.hideAdult, Boolean(refresh2)),
  "anilist:browse": ([filters2], p) => browse(filters2 ?? {}, p.hideAdult),
  "anilist:media": ([id], p) => mediaFor(num(id, "id"), p.hideAdult),
  "anilist:schedule": ([from, to], p) => schedule(num(from, "from"), num(to, "to"), p.hideAdult),
  "episodes:list": ([id, refresh2]) => {
    const mediaId = num(id, "mediaId");
    assertMediaAllowed(mediaId);
    return listEpisodes(mediaId, Boolean(refresh2));
  },
  "stream:resolve": async ([embedUrl, refresh2]) => {
    if (!config.relay) throw new RelayOff();
    if (typeof embedUrl !== "string" || !isKnownEmbed(embedUrl)) throw new BadRequest("Unknown player address.");
    const mediaId = embedMediaId(embedUrl);
    if (mediaId !== null) assertMediaAllowed(mediaId);
    assertUrlAllowed(embedUrl);
    const { stream: stream2, referer } = await resolveStream(embedUrl, Boolean(refresh2));
    assertUrlAllowed(stream2.master);
    return proxiedStream(stream2, referer);
  },
  "manga:chapters": ([id, provider, refresh2], p) => {
    const mediaId = num(id, "mediaId");
    assertMediaAllowed(mediaId);
    return chapterList(mediaId, p, provider ?? null, Boolean(refresh2));
  },
  "manga:pages": async ([chapter], p) => {
    const c = chapter;
    if (!c || typeof c.id !== "string") throw new BadRequest("Unknown chapter.");
    return proxiedPages(await chapterPages(c, p), c.provider);
  },
  "manga:health": ([force]) => providerHealth(Boolean(force)),
  // streamRelay tells the page whether to use its own player or the source's embed.
  "app:info": () => ({ version: config.version, platform: "web", electron: "", chrome: "", userData: "", packaged: true, streamRelay: config.relay })
};
function readBody(req) {
  const pre = req.body;
  if (pre !== void 0) return Promise.resolve(typeof pre === "string" ? pre : Buffer.isBuffer(pre) ? pre.toString("utf8") : JSON.stringify(pre));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new BadRequest("Request too large."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function statusFor(err) {
  if (err instanceof LegalBlock) return 451;
  if (err instanceof RelayOff) return 403;
  if (err instanceof BadRequest || err instanceof SyntaxError || err instanceof UnknownChapterError) return 400;
  return 502;
}
async function rpc(req, res, channel) {
  const handler = HANDLERS[channel];
  if (!handler) return sendJson(res, 404, { error: `Unknown channel ${channel}.` });
  if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST." });
  const started = Date.now();
  try {
    const text = await readBody(req);
    const body = text ? JSON.parse(text) : {};
    const args = Array.isArray(body.args) ? body.args : [];
    const result = await handler(args, readPrefs(req));
    sendJson(res, 200, result ?? null);
    log11.debug(`${channel} ${Date.now() - started}ms`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = statusFor(err);
    log11.warn(`${channel} failed (${status}): ${message}`);
    sendJson(res, status, { error: message });
  }
}
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};
function serveStatic(req, res, pathname) {
  if (!fs5.existsSync(config.distDir)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("The site isn\u2019t built yet. Run the web build, or use the dev server on port 5311.");
    return;
  }
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  let file2 = path4.normalize(path4.join(config.distDir, rel));
  if (!file2.startsWith(config.distDir)) file2 = path4.join(config.distDir, "index.html");
  if (!fs5.existsSync(file2) || !fs5.statSync(file2).isFile()) file2 = path4.join(config.distDir, "index.html");
  const ext = path4.extname(file2).toLowerCase();
  const cache5 = rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": cache5 });
  if (req.method === "HEAD") return res.end();
  fs5.createReadStream(file2).pipe(res);
}
function allowOrigin(req, res) {
  const origin = req.headers.origin?.replace(/\/+$/, "");
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-pz-prefs");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
}
function proxyRoute(pathname) {
  const m = /^(?:\/api)?\/proxy\/(hls|file)$/.exec(pathname);
  return m ? m[1] : null;
}
function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  return (async () => {
    const route = proxyRoute(pathname);
    if (route) {
      if (req.method === "OPTIONS") return proxyPreflight(res);
      if (route === "hls" && !config.relay) return sendJson(res, 403, { error: new RelayOff().message });
      const target = url.searchParams.get("u") ?? "";
      if (isHostBlocked(target)) return sendJson(res, 451, { error: new LegalBlock().message });
      return route === "hls" ? proxyHls(req, res, url) : proxyFile(req, res, url);
    }
    if (pathname.startsWith("/api/")) {
      allowOrigin(req, res);
      if (req.method === "OPTIONS") return res.writeHead(204).end();
      const m = /^\/api\/rpc\/([a-zA-Z]+:[a-zA-Z]+)$/.exec(pathname);
      return m ? rpc(req, res, m[1]) : sendJson(res, 404, { error: "Not found." });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
    serveStatic(req, res, pathname);
  })().catch((err) => {
    log11.error("request failed", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong." });
    else res.destroy();
  });
}
export {
  handle
};
