import sys
import html
import argparse
from urllib.parse import quote_plus
import requests
from bs4 import BeautifulSoup

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

API_BASE = "https://anikotoapi.site"
MEGAPLAY_BASE = "https://megaplay.buzz"
SEARCH_DOMAINS = [
    "https://anikoto.cz",
    "https://anikototv.to"
]

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def search_anime(keyword: str, page: int = 1):
    if not keyword or not keyword.strip():
        return {"ok": False, "error": "Empty keyword", "results": []}

    encoded_kw = quote_plus(keyword.strip())
    last_err = None

    for domain in SEARCH_DOMAINS:
        url = f"{domain}/search?keyword={encoded_kw}&page={page}"
        try:
            resp = requests.get(url, headers=DEFAULT_HEADERS, timeout=12)
            if resp.status_code != 200:
                continue

            soup = BeautifulSoup(resp.text, "html.parser")
            items = soup.select(".item")

            results = []
            for item in items:
                tip_el = item.select_one("[data-tip]")
                anime_id = tip_el.get("data-tip") if tip_el else None

                title_el = item.select_one(".info .name")
                raw_title = title_el.get_text(strip=True) if title_el else "Unknown"
                title = html.unescape(raw_title)

                raw_jp = title_el.get("data-jp") if title_el else None
                jp_title = html.unescape(raw_jp) if raw_jp else None

                type_el = item.select_one(".meta .right")
                anime_type = type_el.get_text(strip=True) if type_el else "TV"

                sub_el = item.select_one(".ep-status.sub")
                dub_el = item.select_one(".ep-status.dub")
                sub_count = sub_el.get_text(strip=True) if sub_el else "0"
                dub_count = dub_el.get_text(strip=True) if dub_el else "0"

                link_el = item.select_one('a[href*="/watch/"]')
                watch_url = link_el["href"] if link_el else ""

                slug = ""
                if "/watch/" in watch_url:
                    parts = watch_url.split("/watch/")[1].split("/")
                    slug = parts[0] if parts else ""

                if anime_id:
                    results.append({
                        "id": int(anime_id) if anime_id.isdigit() else anime_id,
                        "title": title,
                        "jp_title": jp_title,
                        "type": anime_type,
                        "sub": sub_count,
                        "dub": dub_count,
                        "slug": slug,
                        "url": watch_url
                    })

            has_next = False
            for a in soup.select("ul.pagination a[href]"):
                if f"page={page + 1}" in a.get("href", ""):
                    has_next = True
                    break

            return {
                "ok": True,
                "keyword": keyword.strip(),
                "page": page,
                "has_next": has_next,
                "results": results
            }
        except Exception as e:
            last_err = e
            continue

    return {"ok": False, "error": str(last_err), "results": []}


def search_all_pages(keyword: str, max_pages: int = 5):
    all_results = []
    current_page = 1

    while current_page <= max_pages:
        res = search_anime(keyword, page=current_page)
        if not res["ok"] or not res["results"]:
            break

        all_results.extend(res["results"])
        if not res.get("has_next"):
            break
        current_page += 1

    return all_results


def search_full_database(keyword: str):
    res = search_anime(keyword)
    if res["ok"]:
        return {"data": {"animes": res["results"]}}
    return None


def get_series_details(anime_id: int):
    url = f"{API_BASE}/series/{anime_id}"
    try:
        resp = requests.get(url, headers={"Accept": "application/json"}, timeout=12)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("data", {})
        elif resp.status_code == 404:
            print(f"[-] Series ID '{anime_id}' not found.")
            return None
        else:
            print(f"[-] API error fetching series {anime_id} (Status code: {resp.status_code})")
            return None
    except Exception as e:
        print(f"[-] Connection error fetching series {anime_id}: {e}")
        return None


def build_iframe(embed_url: str):
    return f'<iframe src="{embed_url}" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen></iframe>'


def print_single_episode(ep: dict, mal_id=None, ani_id=None):
    ep_num = ep.get("number")
    raw_title = ep.get("title") or f"Episode {ep_num}"
    ep_title = html.unescape(raw_title)
    embed_id = ep.get("episode_embed_id")
    embed_urls = ep.get("embed_url", {})
    sub_url = embed_urls.get("sub") or f"{MEGAPLAY_BASE}/stream/s-2/{embed_id}/sub"
    dub_url = embed_urls.get("dub") or f"{MEGAPLAY_BASE}/stream/s-2/{embed_id}/dub"

    print("\n" + "-" * 70)
    print(f" Episode #{ep_num}: {ep_title}")
    print(f" Episode Embed ID : {embed_id}")
    print(f" Sub Stream URL   : {sub_url}")
    print(f" Sub Iframe HTML  : {build_iframe(sub_url)}")
    if ep.get("embed_url", {}).get("dub") or ep.get("is_dub"):
        print(f" Dub Stream URL   : {dub_url}")
        print(f" Dub Iframe HTML  : {build_iframe(dub_url)}")
    if mal_id:
        print(f" MAL Stream URL   : {MEGAPLAY_BASE}/stream/mal/{mal_id}/{ep_num}/sub")
    if ani_id:
        print(f" AniList Stream   : {MEGAPLAY_BASE}/stream/ani/{ani_id}/{ep_num}/sub")
    print("-" * 70)


def display_anime_details(series_data: dict, target_ep: int = None):
    anime = series_data.get("anime", {})
    episodes = series_data.get("episodes", [])

    anime_id = anime.get("id")
    title = html.unescape(anime.get("title", "Unknown"))
    raw_alt = anime.get("titles") or anime.get("alternative")
    alt_title = html.unescape(raw_alt) if raw_alt else None
    mal_id = anime.get("mal_id")
    ani_id = anime.get("ani_id")
    status = anime.get("status", "N/A")
    rating = anime.get("rating", "N/A")
    aired = anime.get("aired", "N/A")
    total_episodes = anime.get("episodes") or len(episodes)

    print("\n" + "=" * 70)
    print(f" [SERIES DETAILS] {title}")
    if alt_title and alt_title != title:
        print(f"  Alt Title    : {alt_title}")
    print(f"  Anikoto ID   : {anime_id}")
    print(f"  MAL ID       : {mal_id or 'N/A'}")
    print(f"  AniList ID   : {ani_id or 'N/A'}")
    print(f"  Status       : {status} | Rating: {rating}")
    print(f"  Aired        : {aired}")
    print(f"  Episodes     : {total_episodes} (Loaded {len(episodes)} streamable)")
    print("=" * 70)

    if not episodes:
        print("[-] No episode stream links available for this series.")
        return

    if target_ep is not None:
        matched = [e for e in episodes if e.get("number") == target_ep]
        if matched:
            print_single_episode(matched[0], mal_id, ani_id)
        else:
            print(f"[-] Episode {target_ep} not found in series.")
        return

    print("\n[STREAMING ENDPOINTS (MegaPlay)]")
    print(f"Catalog URL : {MEGAPLAY_BASE}/stream/s-2/{{aniwatch-ep-id}}/{{language}}")
    if mal_id:
        print(f"MAL URL     : {MEGAPLAY_BASE}/stream/mal/{mal_id}/{{ep-num}}/{{language}}")
    if ani_id:
        print(f"AniList URL : {MEGAPLAY_BASE}/stream/ani/{ani_id}/{{ep-num}}/{{language}}")

    preview_eps = episodes[:3]
    if len(episodes) > 3 and episodes[-1] not in preview_eps:
        preview_eps.append(episodes[-1])

    print("\n--- Episode Quick Preview ---")
    for ep in preview_eps:
        ep_num = ep.get("number")
        raw_t = ep.get("title") or f"Episode {ep_num}"
        ep_title = html.unescape(raw_t)
        embed_id = ep.get("episode_embed_id")
        embed_urls = ep.get("embed_url", {})
        sub_url = embed_urls.get("sub") or f"{MEGAPLAY_BASE}/stream/s-2/{embed_id}/sub"
        dub_url = embed_urls.get("dub")

        print(f"\n* Ep #{ep_num}: {ep_title}")
        print(f"    Episode Embed ID : {embed_id}")
        print(f"    Sub Stream       : {sub_url}")
        if dub_url:
            print(f"    Dub Stream       : {dub_url}")

    while True:
        try:
            choice = input(f"\nEnter episode # to get embed code (1-{len(episodes)}), 'list' to see all, or 'b' to go back: ").strip().lower()
        except (KeyboardInterrupt, EOFError):
            break

        if choice in ["b", "back", ""]:
            break
        elif choice == "list":
            print("\nAvailable Episodes:")
            for ep in episodes:
                num = ep.get("number")
                raw_t = ep.get("title") or f"Episode {num}"
                t = html.unescape(raw_t)
                eid = ep.get("episode_embed_id")
                has_dub = "Yes" if ep.get("embed_url", {}).get("dub") else "No"
                print(f"  Ep {num:>3} | Embed ID: {eid:<8} | Dub: {has_dub:<3} | {t}")
        elif choice.isdigit():
            ep_idx = int(choice)
            matched = [e for e in episodes if e.get("number") == ep_idx]
            if matched:
                print_single_episode(matched[0], mal_id, ani_id)
            else:
                print(f"[-] Episode {ep_idx} not found in series.")
        else:
            print("[-] Invalid selection.")


def interactive_search():
    print("=" * 70)
    print("  ANIKOTO / MEGAPLAY ANIME SEARCH & ID DISCOVERY TOOL")
    print("  Searches entire catalog & retrieves Anikoto, MAL, AniList & Embed IDs")
    print("=" * 70)

    while True:
        try:
            query = input("\nEnter anime name or ID to search (or 'q' to quit): ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break

        if not query:
            continue
        if query.lower() in ["q", "quit", "exit"]:
            print("Exiting.")
            break

        if query.isdigit():
            aid = int(query)
            print(f"[*] Fetching series details directly for ID: {aid}...")
            series = get_series_details(aid)
            if series:
                display_anime_details(series)
            continue

        page = 1
        while True:
            print(f"[*] Searching database for '{query}' (Page {page})...")
            search_res = search_anime(query, page=page)

            if not search_res["ok"]:
                print(f"[-] Search error: {search_res.get('error', 'Failed to retrieve response')}")
                break

            items = search_res["results"]
            if not items:
                print(f"[-] No matching anime found for '{query}' on page {page}.")
                break

            print(f"\n[+] Found {len(items)} matching results (Page {page}):\n")
            print(f" {'#':<3} | {'ID':<6} | {'Type':<6} | {'Sub/Dub':<10} | {'Title'}")
            print("-" * 70)

            for idx, anime in enumerate(items, 1):
                anime_id = anime.get("id")
                title = anime.get("title")
                atype = anime.get("type", "TV")
                sub_dub = f"{anime.get('sub')}/{anime.get('dub')}"
                print(f" [{idx:>2}] | {anime_id:<6} | {atype:<6} | {sub_dub:<10} | {title}")

            print("\nOptions:")
            print(f"  - Enter result number [1-{len(items)}] to view details & episode embed links")
            if search_res.get("has_next"):
                print("  - Type 'n' for next page")
            if page > 1:
                print("  - Type 'p' for previous page")
            print("  - Type 's' to search again or 'q' to quit")

            try:
                sel = input("\nSelect an option: ").strip().lower()
            except (KeyboardInterrupt, EOFError):
                return

            if sel == "q":
                return
            elif sel == "s" or sel == "":
                break
            elif sel == "n" and search_res.get("has_next"):
                page += 1
            elif sel == "p" and page > 1:
                page -= 1
            elif sel.isdigit():
                sel_idx = int(sel)
                if 1 <= sel_idx <= len(items):
                    selected = items[sel_idx - 1]
                    aid = selected["id"]
                    print(f"\n[*] Fetching series details for '{selected['title']}' (ID: {aid})...")
                    series = get_series_details(aid)
                    if series:
                        display_anime_details(series)
                else:
                    print("[-] Number out of range.")
            else:
                print("[-] Unknown option.")


def main():
    parser = argparse.ArgumentParser(description="Search Anikoto / MegaPlay Anime Database & Get Embed IDs")
    parser.add_argument("keyword", nargs="?", help="Anime keyword to search for")
    parser.add_argument("--id", type=int, help="Directly lookup an anime series by its ID")
    parser.add_argument("--ep", type=int, help="Specific episode number to inspect")
    parser.add_argument("--all", action="store_true", help="Search and list across all pages")

    args = parser.parse_args()

    if args.id:
        series = get_series_details(args.id)
        if series:
            display_anime_details(series, target_ep=args.ep)
    elif args.keyword:
        if args.all:
            print(f"[*] Searching all pages for '{args.keyword}'...")
            results = search_all_pages(args.keyword)
            print(f"\n[+] Found {len(results)} total results across database:\n")
            for idx, anime in enumerate(results, 1):
                print(f"[{idx:>2}] ID: {anime['id']:<6} | {anime['type']:<5} | Sub: {anime['sub']} Dub: {anime['dub']} | {anime['title']}")
        else:
            search_res = search_anime(args.keyword)
            if search_res["ok"] and search_res["results"]:
                print(f"\n[+] Found {len(search_res['results'])} matching results:\n")
                for idx, anime in enumerate(search_res["results"], 1):
                    print(f"[{idx:>2}] ID: {anime['id']:<6} | {anime['type']:<5} | Sub: {anime['sub']} Dub: {anime['dub']} | {anime['title']}")
            else:
                print(f"[-] No results found for '{args.keyword}'.")
    else:
        interactive_search()


if __name__ == "__main__":
    main()