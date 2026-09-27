import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { before, after, describe } from 'node:test';
import * as anilist from '../src/anilist';
import { handle } from '../src/app';
import { listEpisodes } from '../src/episodes';
import { chapterList, chapterPages, providerHealth } from '../src/manga';
import { fileUrl, hlsUrl, verify } from '../src/proxy/sign';
import * as asura from '../src/sources/asura';
import * as mangadex from '../src/sources/mangadex';
import * as mangapill from '../src/sources/mangapill';
import { allowEmbedHosts, isKnownEmbed } from '../src/stream/embeds';

describe('PlayzAnime APIs Unit Test Suite', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    server = http.createServer(handle);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── 1. AniList API ──────────────────────────────────────────────────────────
  describe('AniList API', () => {
    test('anilist.home returns trending and curated anime sections', async () => {
      const data = await anilist.home(true, true);
      assert.ok(data, 'home response should not be null');
      assert.ok(Array.isArray(data.trending), 'trending should be an array');
      assert.ok(data.trending.length > 0, 'trending should contain items');
      assert.ok(Array.isArray(data.season), 'season should be an array');
      assert.ok(Array.isArray(data.top), 'top should be an array');

      const first = data.trending[0];
      assert.ok(typeof first.id === 'number', 'media ID must be a number');
      assert.ok(first.title && typeof first.title === 'object', 'title must be an object');
      assert.ok(first.coverImage && typeof first.coverImage === 'object', 'coverImage must be an object');
    });

    test('anilist.mangaHome returns manga and manhwa sections', async () => {
      const data = await anilist.mangaHome(true, true);
      assert.ok(data, 'mangaHome response should not be null');
      assert.ok(Array.isArray(data.trending), 'trending should be an array');
      assert.ok(Array.isArray(data.manhwa), 'manhwa should be an array');
      assert.ok(data.manhwa.length > 0, 'manhwa should contain items');

      const manhwa = data.manhwa[0];
      assert.ok(typeof manhwa.id === 'number', 'manhwa media ID must be a number');
      assert.ok(manhwa.title.romaji || manhwa.title.english, 'manhwa should have title');
    });

    test('anilist.mediaFor returns metadata for anime and manga', async () => {
      // 105398 = Solo Leveling (Manga/Manhwa)
      const media = await anilist.mediaFor(105398, true);
      assert.ok(media, 'media should be resolved');
      assert.equal(media.id, 105398);
      assert.equal(media.type, 'MANGA');
      assert.ok(media.title.romaji?.toLowerCase().includes('solo') || media.title.english?.toLowerCase().includes('solo'));

      // 154587 = Sousou no Frieren (Anime)
      const anime = await anilist.mediaFor(154587, true);
      assert.ok(anime, 'anime media should be resolved');
      assert.equal(anime.id, 154587);
      assert.equal(anime.type, 'ANIME');
    });

    test('anilist.browse searches for titles with query filter', async () => {
      const results = await anilist.browse({ query: 'One Piece' }, true);
      assert.ok(results, 'browse should return result object');
      assert.ok(Array.isArray(results.items), 'items should be an array');
      assert.ok(results.items.length > 0, 'items should not be empty');

      const match = results.items.find((item) =>
        item.title.english?.toLowerCase().includes('one piece') ||
        item.title.romaji?.toLowerCase().includes('one piece')
      );
      assert.ok(match, 'should find One Piece in search results');
    });

    test('anilist.schedule returns airing anime for timestamp window', async () => {
      const now = Math.floor(Date.now() / 1000);
      const from = now - 86400;
      const to = now + 86400;
      const items = await anilist.schedule(from, to, true);
      assert.ok(Array.isArray(items), 'schedule items should be an array');
    });
  });

  // ── 2. Episodes & Streams API ─────────────────────────────────────────────
  describe('Episodes and Streams API', () => {
    test('listEpisodes resolves episodes for Frieren (154587)', async () => {
      const result = await listEpisodes(154587, true);
      assert.ok(result, 'episodes result should be returned');
      assert.ok(Array.isArray(result.episodes), 'episodes should be an array');
      assert.ok(result.episodes.length > 0, 'episodes should not be empty');

      const ep1 = result.episodes[0];
      assert.equal(ep1.number, 1);
      assert.ok(ep1.subUrl || ep1.dubUrl, 'episode should have sub or dub embed URL');
    });

    test('stream embed validation permits known hosts and rejects unauthorized domains', () => {
      assert.equal(isKnownEmbed('https://evil-site.com/exploit.html'), false);
      assert.equal(isKnownEmbed('not-a-url'), false);

      const fakeEmbed = 'https://megaplay.test/e/sample-embed';
      allowEmbedHosts([fakeEmbed]);
      assert.equal(isKnownEmbed(fakeEmbed), true);
      assert.equal(isKnownEmbed('https://other-domain.org/player'), false);
    });
  });

  // ── 3. Manga Providers API ────────────────────────────────────────────────
  describe('Manga Providers and Sources API', () => {
    test('providerHealth reports status across all 5 registered providers', async () => {
      const health = await providerHealth(true);
      assert.ok(Array.isArray(health), 'providerHealth should return an array');

      const providers = health.map((h) => h.provider);
      assert.ok(providers.includes('mangadex'), 'must include mangadex');
      assert.ok(providers.includes('asura'), 'must include asura');
      assert.ok(providers.includes('weebcentral'), 'must include weebcentral');
      assert.ok(providers.includes('flame'), 'must include flame');
      assert.ok(providers.includes('mangapill'), 'must include mangapill');

      for (const h of health) {
        assert.ok(typeof h.provider === 'string', 'provider must be string');
        assert.ok(typeof h.ok === 'boolean', 'ok must be boolean');
        assert.ok(typeof h.ms === 'number', 'ms must be number');
      }
    });

    test('Asura Scans matches Solo Leveling and returns chapters with pages', async () => {
      const match = await asura.match(['Solo Leveling', 'Na Honjaman Level Up'], 2018);
      assert.ok(match, 'Asura Scans should find Solo Leveling');
      assert.ok(match.id, 'Match should contain series slug/id');
      assert.ok(match.title.toLowerCase().includes('solo leveling'));

      const chapters = await asura.chapters(match.id);
      assert.ok(Array.isArray(chapters), 'Asura chapters must be an array');
      assert.ok(chapters.length > 50, 'Asura Solo Leveling should have > 50 chapters');

      const ch1 = chapters.find((c) => c.number === '1');
      assert.ok(ch1, 'Should find Chapter 1 on Asura');
      assert.ok(ch1.id.startsWith('asura:'), 'Chapter ID must have asura prefix');

      const pages = await asura.pages(ch1.id);
      assert.ok(Array.isArray(pages), 'Asura pages must be an array');
      assert.ok(pages.length > 0, 'Asura chapter 1 should have pages');
      assert.ok(pages[0].url.startsWith('https://'), 'Page image URL must be https');
    });

    test('MangaDex ping and findByAnilist', async () => {
      await mangadex.ping();
      const hit = await mangadex.findByAnilist(105398, ['Solo Leveling'], false);
      assert.ok(hit, 'MangaDex should find Solo Leveling');
      assert.ok(hit.id, 'MangaDex hit should contain id');

      const chapters = await mangadex.chapters(hit.id);
      assert.ok(Array.isArray(chapters), 'MangaDex chapters should be an array');
      assert.ok(chapters.length > 0, 'MangaDex should have chapters');
    });

    test('MangaPill ping and chapters', async () => {
      await mangapill.ping();
      const hit = await mangapill.match(['Naruto'], 1999);
      assert.ok(hit, 'MangaPill should match Naruto');
      const chapters = await mangapill.chapters(hit.path);
      assert.ok(Array.isArray(chapters), 'MangaPill chapters must be an array');
      assert.ok(chapters.length > 0, 'MangaPill should have chapters');
    });

    test('chapterList aggregates chapters across providers for media', async () => {
      // 105398 = Solo Leveling
      const prefs = { titleLanguage: 'romaji', preferDub: false, dataSaver: false, readerMode: 'vertical' as const, readerDirection: 'ltr' as const, readerFit: 'width' as const, hideAdult: true };
      const list = await chapterList(105398, prefs, 'asura', true);
      assert.ok(list, 'chapterList should return list object');
      assert.equal(list.provider, 'asura');
      assert.ok(Array.isArray(list.chapters), 'chapters must be array');
      assert.ok(list.chapters.length > 0, 'chapters must not be empty');
      assert.ok(Array.isArray(list.providers), 'providers list must be present');
    });

    test('chapterList switches source dynamically when provider is explicitly selected', async () => {
      const prefs = { titleLanguage: 'romaji', preferDub: false, dataSaver: false, readerMode: 'vertical' as const, readerDirection: 'ltr' as const, readerFit: 'width' as const, hideAdult: true };
      // Test switching to MangaDex on Solo Leveling
      const dexList = await chapterList(105398, prefs, 'mangadex', false);
      assert.ok(dexList, 'chapterList should return list for MangaDex');
      assert.equal(dexList.provider, 'mangadex', 'Provider must switch to mangadex');
      assert.ok(dexList.chapters.length > 0, 'MangaDex chapters must be present');
      assert.ok(dexList.providers.length >= 2, 'Multiple providers should be discovered');

      // Test switching to MangaPill on One Piece (media 21)
      const pillList = await chapterList(21, prefs, 'mangapill', false);
      assert.ok(pillList, 'chapterList should return list for MangaPill');
      assert.equal(pillList.provider, 'mangapill', 'Provider must switch to mangapill');
      assert.ok(pillList.chapters.length > 0, 'MangaPill chapters must not be empty');
    });
  });

  // ── 4. HTTP RPC & Proxy Endpoints ─────────────────────────────────────────
  describe('HTTP RPC and Proxy Endpoints', () => {
    async function postRpc(channel: string, args: unknown[] = []) {
      const res = await fetch(`${baseUrl}/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
      });
      const data = await res.json();
      return { status: res.status, data };
    }

    test('POST /api/rpc/app:info returns server configuration', async () => {
      const { status, data } = await postRpc('app:info');
      assert.equal(status, 200);
      assert.equal(data.platform, 'web');
      assert.equal(typeof data.version, 'string');
      assert.equal(typeof data.streamRelay, 'boolean');
    });

    test('POST /api/rpc/manga:health returns health of providers over HTTP', async () => {
      const { status, data } = await postRpc('manga:health', [true]);
      assert.equal(status, 200);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 5);
      const asuraEntry = data.find((p: any) => p.provider === 'asura');
      assert.ok(asuraEntry, 'Asura must be in RPC health response');
      assert.equal(asuraEntry.ok, true, 'Asura Scans should be healthy');
    });

    test('POST /api/rpc/manga:extensions returns 50+ manga and manhwa extension catalog', async () => {
      const { status, data } = await postRpc('manga:extensions');
      assert.equal(status, 200);
      assert.ok(Array.isArray(data), 'Extensions must be an array');
      assert.ok(data.length >= 50, `Expected at least 50 extensions, got ${data.length}`);
      const asura = data.find((e: any) => e.id === 'asura');
      assert.ok(asura, 'Asura Scans must be in extension catalog');
      assert.equal(asura.category, 'manhwa');
      const manhuaPlus = data.find((e: any) => e.id === 'manhuaplus');
      assert.ok(manhuaPlus, 'ManhuaPlus must be in extension catalog');
      assert.equal(manhuaPlus.engine, 'madara');
    });

    test('POST /api/rpc/manga:toggleExtension enables and disables extensions', async () => {
      const toggleRes = await postRpc('manga:toggleExtension', ['toonily', false]);
      assert.equal(toggleRes.status, 200);
      assert.equal(toggleRes.data.ok, true);

      const { data } = await postRpc('manga:extensions');
      const toonily = data.find((e: any) => e.id === 'toonily');
      assert.ok(toonily);
      assert.equal(toonily.enabled, false, 'Toonily should be toggled off');

      // Re-enable
      await postRpc('manga:toggleExtension', ['toonily', true]);
    });

    test('POST /api/rpc/anilist:home returns trending over HTTP RPC', async () => {
      const { status, data } = await postRpc('anilist:home', [false]);
      assert.equal(status, 200);
      assert.ok(data.trending && data.trending.length > 0);
    });

    test('Rejects unknown RPC channels with 404', async () => {
      const { status, data } = await postRpc('unknown:channel');
      assert.equal(status, 404);
      assert.ok(data.error);
    });

    test('Rejects GET requests on RPC routes with 405', async () => {
      const res = await fetch(`${baseUrl}/api/rpc/app:info`, { method: 'GET' });
      assert.equal(res.status, 405);
      const body = await res.json();
      assert.equal(body.error, 'Use POST.');
    });

    test('Security: blocks exploit scanner probes with 403', async () => {
      const res = await fetch(`${baseUrl}/.env`);
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error, 'Blocked scanner probe.');
    });

    test('Proxy: generates and verifies signed URLs', () => {
      const sampleUrl = 'https://img.asurascans.com/media/chapter1/01.webp';
      const referer = 'https://asurascans.com/';
      const signed = fileUrl(sampleUrl, referer);
      assert.ok(signed.includes('?u='));
      assert.ok(signed.includes('&r='));
      assert.ok(signed.includes('&s='));

      const parsed = new URL(signed, baseUrl);
      const u = parsed.searchParams.get('u')!;
      const r = parsed.searchParams.get('r')!;
      const s = parsed.searchParams.get('s')!;

      assert.equal(verify(u, r, s), true, 'Valid signature must verify');
      assert.equal(verify(u, r, 'tampered-signature'), false, 'Tampered signature must fail');
      assert.equal(verify('https://other-url.com', r, s), false, 'Modified URL must fail');
    });
  });
});
