import requests
import re
import logging
import time
from urllib.parse import quote_plus

log = logging.getLogger("get")

_AL = "https://graphql.anilist.co"
_ANIKOTO_API = "https://anikotoapi.site"
_ANIKOTO_DOMAINS = ["https://anikoto.cz", "https://anikototv.to"]
_MEGAPLAY = "https://megaplay.buzz"
_HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}

# High-Speed In-Memory Cache with 15-min TTL
_CACHE = {}
_CACHE_TTL = 900

def _cache_get(key: str):
    item = _CACHE.get(key)
    if item and (time.time() - item[0] < _CACHE_TTL):
        return item[1]
    return None

def _cache_set(key: str, data):
    _CACHE[key] = (time.time(), data)

def _al_post(query: str, variables: dict = None):
    try:
        r = requests.post(_AL, json={"query": query, "variables": variables or {}}, timeout=12)
        r.raise_for_status()
        return r.json().get("data", {})
    except Exception as e:
        log.error(f"[AniList] GraphQL error: {e}")
        return {}

ANIME_SEARCH_ALIASES = {
    "jjk": "Jujutsu Kaisen",
    "aot": "Attack on Titan",
    "snk": "Shingeki no Kyojin",
    "mha": "My Hero Academia",
    "bnha": "Boku no Hero Academia",
    "db": "Dragon Ball",
    "dbz": "Dragon Ball Z",
    "dbs": "Dragon Ball Super",
    "ds": "Demon Slayer",
    "kny": "Kimetsu no Yaiba",
    "op": "One Piece",
    "csm": "Chainsaw Man",
    "fma": "Fullmetal Alchemist",
    "fmab": "Fullmetal Alchemist: Brotherhood",
    "sao": "Sword Art Online",
    "nge": "Neon Genesis Evangelion",
    "eva": "Neon Genesis Evangelion",
    "opm": "One Punch Man",
    "hxh": "Hunter x Hunter",
    "sl": "Solo Leveling",
    "tg": "Tokyo Ghoul",
    "bc": "Black Clover",
    "bleach": "Bleach",
    "naruto": "Naruto",
    "shippuden": "Naruto Shippuden",
    "boruto": "Boruto",
    "death note": "Death Note",
    "dn": "Death Note",
    "cg": "Code Geass",
    "fate": "Fate/stay night",
    "vinland": "Vinland Saga",
    "slime": "That Time I Got Reincarnated as a Slime",
    "mob": "Mob Psycho 100",
    "mp100": "Mob Psycho 100",
    "dr stone": "Dr. Stone",
    "stone": "Dr. Stone",
    "blue lock": "Blue Lock",
    "spy x family": "Spy x Family",
    "sxf": "Spy x Family",
    "haikyuu": "Haikyuu!!",
    "kaiju": "Kaiju No. 8",
    "frieren": "Frieren: Beyond Journey's End",
    "dandadan": "Dandadan"
}

def al_search(q: str, n: int = 24, page: int = 1):
    clean_q = q.strip()
    target_q = ANIME_SEARCH_ALIASES.get(clean_q.lower(), clean_q)
    cache_key = f"search_{target_q.lower()}_{page}_{n}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    gql = """query($s:String,$n:Int,$p:Int){Page(page:$p,perPage:$n){pageInfo{hasNextPage} media(search:$s,type:ANIME,sort:SEARCH_MATCH){
      id title{romaji english native} episodes season seasonYear format status
      coverImage{large medium extraLarge} bannerImage genres averageScore popularity
      description(asHtml:false)}}}"""
    p_data = _al_post(gql, {"s": target_q, "n": n, "p": page}).get("Page", {})
    items = p_data.get("media", [])
    has_next = bool(p_data.get("pageInfo", {}).get("hasNextPage", False))
    result = {"results": items, "page": page, "hasNextPage": has_next}
    _cache_set(cache_key, result)
    return result

def al_recent(page: int = 1, n: int = 24, genre: str = None, format_type: str = None):
    # Determine format_in filter
    fmt_in = None
    if format_type:
        fmt_u = format_type.upper().strip()
        if fmt_u in ["MOVIE", "FILM"]:
            fmt_in = ["MOVIE"]
        elif fmt_u in ["TV", "SERIES"]:
            fmt_in = ["TV", "TV_SHORT"]

    cache_key = f"recent_{page}_{n}_{genre or 'all'}_{fmt_in[0] if fmt_in else 'all'}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    if genre and fmt_in:
        gql = """query($p:Int,$n:Int,$g:String,$f:[MediaFormat]){Page(page:$p,perPage:$n){pageInfo{hasNextPage} media(genre:$g,format_in:$f,type:ANIME,sort:TRENDING_DESC,
          status_not:NOT_YET_RELEASED){id title{romaji english native} episodes season seasonYear format status
          coverImage{large medium extraLarge} bannerImage genres averageScore popularity}}}"""
        p_data = _al_post(gql, {"p": page, "n": n, "g": genre, "f": fmt_in}).get("Page", {})
    elif genre:
        gql = """query($p:Int,$n:Int,$g:String){Page(page:$p,perPage:$n){pageInfo{hasNextPage} media(genre:$g,type:ANIME,sort:TRENDING_DESC,
          status_not:NOT_YET_RELEASED){id title{romaji english native} episodes season seasonYear format status
          coverImage{large medium extraLarge} bannerImage genres averageScore popularity}}}"""
        p_data = _al_post(gql, {"p": page, "n": n, "g": genre}).get("Page", {})
    elif fmt_in:
        gql = """query($p:Int,$n:Int,$f:[MediaFormat]){Page(page:$p,perPage:$n){pageInfo{hasNextPage} media(format_in:$f,type:ANIME,sort:TRENDING_DESC,
          status_not:NOT_YET_RELEASED){id title{romaji english native} episodes season seasonYear format status
          coverImage{large medium extraLarge} bannerImage genres averageScore popularity}}}"""
        p_data = _al_post(gql, {"p": page, "n": n, "f": fmt_in}).get("Page", {})
    else:
        # Both Movies and Series mixed together on landing page!
        gql = """query($p:Int,$n:Int){Page(page:$p,perPage:$n){pageInfo{hasNextPage} media(type:ANIME,sort:TRENDING_DESC,
          status_not:NOT_YET_RELEASED){id title{romaji english native} episodes season seasonYear format status
          coverImage{large medium extraLarge} bannerImage genres averageScore popularity}}}"""
        p_data = _al_post(gql, {"p": page, "n": n}).get("Page", {})

    items = p_data.get("media", [])
    has_next = bool(p_data.get("pageInfo", {}).get("hasNextPage", False))
    result = {"results": items, "page": page, "hasNextPage": has_next}
    _cache_set(cache_key, result)
    return result

def al_media(al_id: int):
    gql = """query($id:Int){Media(id:$id,type:ANIME){
      id title{romaji english native} episodes season seasonYear format status
      coverImage{large medium extraLarge} bannerImage genres averageScore popularity
      description(asHtml:false) nextAiringEpisode{episode} studios(isMain:true){nodes{name}}}}"""
    return _al_post(gql, {"id": al_id}).get("Media", {})

def _score_anikoto_item(target_title: str, target_format: str, target_eps: int | None,
                        item_title: str, item_type: str, item_eps_str: str) -> int:
    score = 0
    t_clean = re.sub(r"[^a-z0-9]", "", target_title.lower())
    it_clean = re.sub(r"[^a-z0-9]", "", item_title.lower())

    if it_clean == t_clean:
        score += 120
    elif it_clean.startswith(t_clean):
        score += 35
    elif t_clean in it_clean:
        score += 15
    else:
        score -= 20

    t_fmt = (target_format or "TV").upper()
    it_type = (item_type or "").upper()
    if t_fmt in it_type or it_type in t_fmt:
        score += 60
    elif t_fmt == "TV" and it_type in ["MOVIE", "SPECIAL", "OVA"]:
        score -= 60
    elif t_fmt == "MOVIE" and it_type == "MOVIE":
        score += 70

    try:
        m = re.search(r"\d+", item_eps_str)
        ie = int(m.group()) if m else 0
    except Exception:
        ie = 0

    if target_eps and target_eps > 1:
        if ie == target_eps:
            score += 100
        elif ie > 1:
            score += 40
        elif ie == 1 and t_fmt == "TV":
            score -= 50
    elif target_eps == 1 or t_fmt == "MOVIE":
        if ie == 1:
            score += 50
        elif ie > 1:
            score -= 30
    elif t_fmt == "TV" and ie > 1:
        score += 45

    return score

def anikoto_find_id(title: str, al_format: str = "TV", target_eps: int = None):
    """Scrape Anikoto search page to find best matching internal series ID."""
    from bs4 import BeautifulSoup
    best_id = None
    best_score = -999

    for domain in _ANIKOTO_DOMAINS:
        try:
            url = f"{domain}/search?keyword={quote_plus(title)}"
            r = requests.get(url, headers=_HDR, timeout=10)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            items = soup.select(".item")
            if not items:
                continue

            for item in items:
                tip = item.select_one("[data-tip]")
                if not tip or not tip.get("data-tip", "").isdigit():
                    continue
                tip_id = int(tip["data-tip"])

                title_el = item.select_one(".name, .film-name, .title, a")
                it_title = title_el.get_text(strip=True) if title_el else ""

                meta_right = item.select_one(".meta .right, .type, .film-type")
                it_type = meta_right.get_text(strip=True) if meta_right else ""

                ep_sub = item.select_one(".ep-status.sub, .ep-status")
                it_eps = ep_sub.get_text(strip=True) if ep_sub else ""

                sc = _score_anikoto_item(title, al_format, target_eps, it_title, it_type, it_eps)
                if sc > best_score:
                    best_score = sc
                    best_id = tip_id

            if best_id and best_score >= 80:
                return best_id
        except Exception as e:
            log.debug(f"[Anikoto] search failed on {domain}: {e}")

    return best_id

def anikoto_series(anikoto_id: int):
    try:
        r = requests.get(f"{_ANIKOTO_API}/series/{anikoto_id}",
                         headers={"Accept": "application/json"}, timeout=12)
        if r.status_code == 200:
            return r.json().get("data", {})
    except Exception as e:
        log.error(f"[Anikoto] series API error: {e}")
    return None

def get_series_full_data(al_id: int, title: str = ""):
    """Combines AniList metadata with Anikoto episodes, with bulletproof fallback."""
    cache_key = f"series_{al_id}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    al_data = al_media(al_id)
    titles = al_data.get("title", {})
    eng_title = titles.get("english") or ""
    romaji_title = titles.get("romaji") or ""
    if not title:
        title = eng_title or romaji_title or ""

    al_format = al_data.get("format") or "TV"
    is_movie = (al_format.upper() == "MOVIE")
    al_eps = al_data.get("episodes")
    if not al_eps:
        if is_movie:
            al_eps = 1
        else:
            next_airing = al_data.get("nextAiringEpisode")
            if next_airing and isinstance(next_airing, dict) and next_airing.get("episode"):
                al_eps = max(1, next_airing["episode"] - 1)

    episodes = []
    ani_id_for_embed = al_data.get("id") or al_id

    candidates = [t for t in [title, eng_title, romaji_title] if t]
    anikoto_id = None
    sd = None

    for cand in candidates:
        cand_id = anikoto_find_id(cand, al_format=al_format, target_eps=al_eps)
        if cand_id:
            cand_sd = anikoto_series(cand_id)
            if cand_sd:
                ep_list = cand_sd.get("episodes", [])
                if al_format == "TV" and (al_eps and al_eps > 1):
                    if len(ep_list) == 1 and (ep_list[0].get("title") or "").strip().lower() == "full":
                        log.info(f"[Matcher] Discarding movie match ID {cand_id} ('Full') for TV series {cand}")
                        continue
                anikoto_id = cand_id
                sd = cand_sd
                break

    if sd:
        ep_list = sd.get("episodes", [])
        anime_meta = sd.get("anime", {})
        ani_id_for_embed = anime_meta.get("ani_id") or ani_id_for_embed
        for ep in ep_list:
            embed_urls = ep.get("embed_url") or {}
            sub_url = embed_urls.get("sub") or f"{_MEGAPLAY}/stream/ani/{ani_id_for_embed}/{ep.get('number')}/sub"
            dub_url = embed_urls.get("dub")
            ep_title = ep.get("title") or f"Episode {ep.get('number')}"
            if is_movie:
                ep_title = "Full Movie"
            episodes.append({
                "number": 1 if is_movie else ep.get("number"),
                "title": ep_title,
                "embed_id": ep.get("episode_embed_id"),
                "sub_url": sub_url,
                "dub_url": dub_url,
            })
            if is_movie:
                break

    # Fallback: if Anikoto found no episodes, build episode list from AniList episode count
    if not episodes:
        total_eps = 1 if is_movie else (al_eps or 12)
        for ep_num in range(1, total_eps + 1):
            episodes.append({
                "number": ep_num,
                "title": "Full Movie" if is_movie else f"Episode {ep_num}",
                "embed_id": None,
                "sub_url": f"{_MEGAPLAY}/stream/ani/{ani_id_for_embed}/{ep_num}/sub",
                "dub_url": None,
            })

    result = {
        "ok": True,
        "anime": al_data,
        "episodes": episodes,
        "ani_id": ani_id_for_embed,
        "anikoto_id": anikoto_id
    }
    _cache_set(cache_key, result)
    return result
