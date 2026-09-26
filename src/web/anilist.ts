import type {
  AiringItem,
  BrowseFilters,
  HomeFeed,
  MangaFeed,
  Media,
  MediaDetail,
  MediaSeason,
  Paged,
} from '../shared/types';

/*
 * Direct client-side AniList client.
 * https://graphql.anilist.co has open CORS headers (Access-Control-Allow-Origin: *),
 * so browsers can query it directly without any server proxy or backend.
 */

const ENDPOINT = 'https://graphql.anilist.co';
const MIN = 60_000;

// Simple in-memory TTL cache for the browser session
class MemoryCache {
  private cache = new Map<string, { expires: number; value: unknown }>();

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (this.cache.size > 300) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.set(key, { expires: Date.now() + ttlMs, value });
  }

  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>, force = false): Promise<T> {
    if (!force) {
      const cached = this.get<T>(key);
      if (cached !== undefined) return cached;
    }
    const fresh = await fn();
    this.set(key, fresh, ttlMs);
    return fresh;
  }
}

const cache = new MemoryCache();

const CARD_FRAGMENT = /* GraphQL */ `
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
`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const vars = Object.fromEntries(Object.entries(variables).filter(([, v]) => v !== null && v !== undefined));
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: CARD_FRAGMENT + query, variables: vars }),
    });
  } catch {
    throw new Error('Could not connect to AniList.');
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  if (!json.data) throw new Error('AniList returned no data.');
  return json.data;
}

const adultVar = (hideAdult: boolean) => (hideAdult ? false : null);

export function currentSeason(date = new Date()): { season: MediaSeason; year: number } {
  const m = date.getMonth();
  const season: MediaSeason = m <= 2 ? 'WINTER' : m <= 5 ? 'SPRING' : m <= 8 ? 'SUMMER' : 'FALL';
  return { season, year: date.getFullYear() };
}

// ── Home feeds ──────────────────────────────────────────────────────────────

const HOME_QUERY = /* GraphQL */ `
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
`;

export function homeDirect(hideAdult: boolean, force = false): Promise<HomeFeed> {
  const label = currentSeason();
  return cache.wrap(
    `home:${hideAdult}`,
    10 * MIN,
    async () => {
      const data = await gql<{ trending: { media: Media[] }; season: { media: Media[] }; top: { media: Media[] } }>(HOME_QUERY, {
        season: label.season,
        year: label.year,
        isAdult: adultVar(hideAdult),
      });
      return { trending: data.trending.media, season: data.season.media, top: data.top.media, seasonLabel: label };
    },
    force,
  );
}

const MANGA_HOME_QUERY = /* GraphQL */ `
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
`;

export function mangaHomeDirect(hideAdult: boolean, force = false): Promise<MangaFeed> {
  return cache.wrap(
    `mangaHome:${hideAdult}`,
    10 * MIN,
    async () => {
      const data = await gql<{ trending: { media: Media[] }; manhwa: { media: Media[] }; top: { media: Media[] } }>(
        MANGA_HOME_QUERY,
        { isAdult: adultVar(hideAdult) },
      );
      return { trending: data.trending.media, manhwa: data.manhwa.media, top: data.top.media };
    },
    force,
  );
}

// ── Browse & search ─────────────────────────────────────────────────────────

const BROWSE_QUERY = /* GraphQL */ `
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
`;

export function browseDirect(filters: BrowseFilters, hideAdult: boolean): Promise<Paged<Media>> {
  const type = filters.type ?? 'ANIME';
  const search = filters.search?.trim() || null;
  const sort = filters.sort ?? (search ? 'SEARCH_MATCH' : 'TRENDING_DESC');
  const isManga = type === 'MANGA';
  const vars = {
    type,
    page: filters.page ?? 1,
    perPage: Math.min(filters.perPage ?? 30, 50),
    search,
    sort: sort === 'SEARCH_MATCH' ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : [sort, 'POPULARITY_DESC'],
    genres: filters.genres?.length ? filters.genres : null,
    formats: filters.formats?.length ? filters.formats : null,
    formatsNot: isManga ? ['NOVEL'] : ['MUSIC'],
    season: isManga ? null : (filters.season ?? null),
    year: isManga ? null : (filters.year ?? null),
    status: filters.status ?? null,
    statusNot: filters.status || search || isManga ? null : 'NOT_YET_RELEASED',
    isAdult: adultVar(hideAdult),
    country: isManga ? (filters.country ?? null) : null,
  };
  const key = `browse:${JSON.stringify(vars)}`;
  return cache.wrap(key, (search ? 5 : 10) * MIN, async () => {
    const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; media: Media[] } }>(BROWSE_QUERY, vars);
    return { items: data.Page.media, page: vars.page, hasNextPage: data.Page.pageInfo.hasNextPage };
  });
}

// ── Media detail ────────────────────────────────────────────────────────────

const MEDIA_QUERY = /* GraphQL */ `
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
`;

export async function mediaDirect(id: number, hideAdult: boolean, force = false): Promise<MediaDetail> {
  const m = await cache.wrap(`media:${id}`, 30 * MIN, async () => (await gql<{ Media: MediaDetail }>(MEDIA_QUERY, { id })).Media, force);
  const detail = { ...m };
  if (detail.relations) {
    detail.relations = { edges: detail.relations.edges.filter((e) => e.node && e.node.format !== 'NOVEL' && !(hideAdult && e.node.isAdult)) };
  }
  if (detail.recommendations) {
    detail.recommendations = {
      nodes: detail.recommendations.nodes.filter((n) => n.mediaRecommendation && !(hideAdult && n.mediaRecommendation.isAdult)),
    };
  }
  return detail;
}

// ── Airing schedule ─────────────────────────────────────────────────────────

const SCHEDULE_QUERY = /* GraphQL */ `
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
`;

export function scheduleDirect(from: number, to: number, hideAdult: boolean): Promise<AiringItem[]> {
  return cache.wrap(`schedule:${from}:${to}:${hideAdult}`, 15 * MIN, async () => {
    const items: AiringItem[] = [];
    for (let page = 1; page <= 8; page++) {
      const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; airingSchedules: AiringItem[] } }>(
        SCHEDULE_QUERY,
        { page, from, to },
      );
      items.push(...data.Page.airingSchedules);
      if (!data.Page.pageInfo.hasNextPage) break;
    }
    return items.filter((i) => i.media && !(hideAdult && i.media.isAdult));
  });
}
