import os
import re
import sys
import json
import argparse
import requests
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://megaplay.buzz/"
}


def parse_master_variants(master_url: str):
    session = requests.Session()
    session.headers.update(DEFAULT_HEADERS)
    
    try:
        resp = session.get(master_url, timeout=10)
        if resp.status_code != 200:
            return []
    except Exception:
        return []

    content = resp.text
    base_url = master_url.rsplit("/", 1)[0]
    token_match = re.search(r"token=([^&]+)", master_url)
    token_param = f"?token={token_match.group(1)}" if token_match else ""

    variants = []
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF"):
            res_match = re.search(r"RESOLUTION=(\d+x\d+)", line)
            resolution = res_match.group(1) if res_match else "unknown"
            bw_match = re.search(r"BANDWIDTH=(\d+)", line)
            bandwidth = int(bw_match.group(1)) if bw_match else 0
            
            if i + 1 < len(lines):
                uri = lines[i + 1].strip()
                if not uri.startswith("#"):
                    full_uri = uri if uri.startswith("http") else f"{base_url}/{uri}{token_param}"
                    variants.append({
                        "resolution": resolution,
                        "bandwidth": bandwidth,
                        "filename": uri,
                        "url": full_uri
                    })

    variants.sort(key=lambda x: x["bandwidth"], reverse=True)
    return variants


def extract_stream(embed_url: str, timeout: int = 20):
    parsed = urlparse(embed_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    captured_master = []
    captured_subs = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=DEFAULT_HEADERS["User-Agent"],
            extra_http_headers={"Referer": f"{origin}/"}
        )
        page = context.new_page()

        def route_filter(route):
            req = route.request
            rtype = req.resource_type
            u = req.url
            if rtype in ["image", "font", "media"]:
                route.abort()
            elif any(x in u for x in ["google-analytics", "tiktok", "statlytic", "ping.gif"]):
                route.abort()
            else:
                route.continue_()

        page.route("**/*", route_filter)

        def on_request(req):
            u = req.url
            if "master.m3u8" in u and u not in captured_master:
                captured_master.append(u)
            elif ".vtt" in u and u not in captured_subs:
                captured_subs.append(u)

        page.on("request", on_request)

        try:
            page.goto(embed_url, timeout=timeout * 1000)
        except Exception as e:
            browser.close()
            return {"ok": False, "error": f"Failed to load page: {e}"}

        max_cycles = timeout * 10
        cycles = 0
        while not captured_master and cycles < max_cycles:
            page.wait_for_timeout(100)
            cycles += 1

        browser.close()

    if not captured_master:
        return {"ok": False, "error": "Could not intercept master.m3u8 manifest."}

    master_url = captured_master[0]
    cdn_host = urlparse(master_url).netloc
    variants = parse_master_variants(master_url)
    best_variant = variants[0]["url"] if variants else master_url

    return {
        "ok": True,
        "embed_url": embed_url,
        "cdn_host": cdn_host,
        "master_m3u8": master_url,
        "best_variant": best_variant,
        "variants": variants,
        "subtitles": captured_subs
    }


def rip_stream(master_url: str, output_file: str = "anime_output.mp4"):
    try:
        from ripper import download_stream_manually
        print(f"[*] Handing off stream to ripper engine -> {output_file}")
        download_stream_manually(master_url, output_file)
    except Exception as e:
        print(f"[-] Ripper failed: {e}")


def main():
    parser = argparse.ArgumentParser(description="MegaPlay Direct CDN & M3U8 Stream Extractor")
    parser.add_argument("url", nargs="?", help="MegaPlay embed URL (e.g. https://megaplay.buzz/stream/s-2/58333/sub)")
    parser.add_argument("-r", "--rip", action="store_true", help="Automatically rip stream to MP4 using ripper engine")
    parser.add_argument("-o", "--output", default="anime_output.mp4", help="Output file path for ripped video")
    parser.add_argument("--json", action="store_true", help="Output raw JSON data")

    args = parser.parse_args()

    target_url = args.url
    if not target_url:
        try:
            target_url = input("Enter MegaPlay stream URL: ").strip()
        except (KeyboardInterrupt, EOFError):
            return

    if not target_url:
        print("[-] Empty URL provided.")
        return

    if not args.json:
        print(f"[*] Extracting CDN stream from: {target_url}")

    data = extract_stream(target_url)

    if not data["ok"]:
        if args.json:
            print(json.dumps(data))
        else:
            print(f"[-] Extraction failed: {data.get('error')}")
        return

    if args.json:
        print(json.dumps(data, indent=2))
        return

    print("\n" + "=" * 70)
    print(f" [CDN EXTRACTION SUCCESS]")
    print(f" CDN Host     : {data['cdn_host']}")
    print(f" Master M3U8  : {data['master_m3u8']}")
    print("=" * 70)

    variants = data.get("variants", [])
    if variants:
        print("\nAvailable Stream Quality Variants:")
        for v in variants:
            res = v["resolution"]
            bw = f"{round(v['bandwidth'] / 1000)} kbps"
            print(f"  * {res:<10} ({bw:<10}) -> {v['url']}")

    subs = data.get("subtitles", [])
    if subs:
        print("\nSubtitles:")
        for s in subs:
            print(f"  * {s}")

    print("\nBest Direct Stream (1080p / Highest):")
    print(data["best_variant"])

    if args.rip:
        print("\n" + "=" * 70)
        rip_stream(data["master_m3u8"], args.output)


if __name__ == "__main__":
    main()