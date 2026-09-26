import time
import json
import re
import threading
import logging
import requests
from urllib.parse import urlparse

log = logging.getLogger("get")

_MEGAPLAY = "https://megaplay.buzz"
_HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}

_cdn = {
    "status": "idle",
    "master": None,
    "best": None,
    "host": None,
    "variants": [],
    "subtitles": [],
    "error": None
}
_cdn_lock = threading.Lock()
_active_driver = None
_driver_lock = threading.Lock()

def cleanup_cdn_driver():
    """Forcibly closes any lingering headless Chrome / chromedriver instance."""
    global _active_driver
    with _driver_lock:
        if _active_driver is not None:
            try:
                _active_driver.quit()
            except Exception:
                pass
            _active_driver = None

def get_cdn_status():
    with _cdn_lock:
        return dict(_cdn)

def cdn_start(embed_url: str):
    with _cdn_lock:
        _cdn.update({
            "status": "extracting",
            "master": None,
            "best": None,
            "host": None,
            "variants": [],
            "subtitles": [],
            "error": None
        })
    threading.Thread(target=_cdn_worker, args=(embed_url,), daemon=True).start()

def _cdn_worker(embed_url: str):
    try:
        res = _cdn_extract(embed_url)
        with _cdn_lock:
            if res["ok"]:
                _cdn.update({
                    "status": "done",
                    "master": res["master"],
                    "best": res["best"],
                    "host": res["host"],
                    "variants": res["variants"],
                    "subtitles": res.get("subtitles", []),
                    "error": None
                })
                log.info(f"[CDN] Captured master URL on {res['host']}")
            else:
                _cdn.update({
                    "status": "error",
                    "error": res["error"]
                })
                log.warning(f"[CDN] Extraction error: {res['error']}")
    except Exception as e:
        log.error(f"[CDN] Worker exception: {e}")
        with _cdn_lock:
            _cdn.update({"status": "error", "error": str(e)})

def _cdn_extract(embed_url: str, timeout: int = 35):
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--autoplay-policy=no-user-gesture-required")
    opts.add_argument("--mute-audio")
    opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    opts.add_experimental_option("perfLoggingPrefs", {"enableNetwork": True, "enablePage": False})

    origin = "{0.scheme}://{0.netloc}".format(urlparse(embed_url))
    captured = []
    subtitles = []
    get_sources_url = None

    global _active_driver
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=opts)
    with _driver_lock:
        _active_driver = driver
    try:
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Network.setExtraHTTPHeaders", {"headers": {"Referer": f"{origin}/"}})
        driver.get(embed_url)

        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(1)
            try:
                logs = driver.get_log("performance")
            except Exception:
                logs = []

            for entry in logs:
                try:
                    msg = json.loads(entry["message"])["message"]
                    if msg.get("method") != "Network.requestWillBeSent":
                        continue
                    u = msg.get("params", {}).get("request", {}).get("url", "")
                    if ".m3u8" in u and "ping.gif" not in u and u not in captured:
                        captured.append(u)
                    if "getSources" in u and not get_sources_url:
                        get_sources_url = u
                    if (".vtt" in u or ".srt" in u) and "ping.gif" not in u:
                        sub_lang = "Subtitles"
                        m_lang = re.search(r"/([a-z]{2,3})(-\d+)?\.(vtt|srt)", u.lower())
                        if m_lang:
                            code = m_lang.group(1)
                            code_map = {
                                "eng": "English", "spa": "Spanish", "ger": "German",
                                "deu": "German", "ita": "Italian", "por": "Portuguese",
                                "rus": "Russian", "ara": "Arabic", "fra": "French",
                                "fre": "French", "jpn": "Japanese", "ind": "Indonesian"
                            }
                            sub_lang = code_map.get(code, code.upper())
                        if not any(s["url"] == u for s in subtitles):
                            subtitles.append({"label": sub_lang, "url": u})
                except Exception:
                    pass

            if captured:
                break
    finally:
        cleanup_cdn_driver()

    if get_sources_url:
        try:
            gs_hdr = _HDR | {"Referer": embed_url, "X-Requested-With": "XMLHttpRequest"}
            gs_resp = requests.get(get_sources_url, headers=gs_hdr, timeout=8)
            if gs_resp.status_code == 200:
                gs_data = gs_resp.json()
                tracks = gs_data.get("tracks", [])
                for t in tracks:
                    lbl = (t.get("label") or "").strip()
                    f_url = t.get("file")
                    if f_url and not any(s["url"] == f_url for s in subtitles):
                        u_low = f_url.lower()
                        if not lbl or lbl.lower() in ["subtitles", "default", "cc", "caption"]:
                            if "eng" in u_low or "/en" in u_low:
                                lbl = "English"
                            elif "spa" in u_low or "/es" in u_low:
                                lbl = "Spanish"
                            elif "ger" in u_low or "deu" in u_low:
                                lbl = "German"
                            elif "por" in u_low or "/pt" in u_low:
                                lbl = "Portuguese"
                            elif "ara" in u_low or "/ar" in u_low:
                                lbl = "Arabic"
                            elif "fra" in u_low or "fre" in u_low:
                                lbl = "French"
                            elif "ita" in u_low:
                                lbl = "Italian"
                            elif "rus" in u_low:
                                lbl = "Russian"
                            else:
                                lbl = "English"

                        # Disambiguate duplicate language labels
                        existing = [s["label"] for s in subtitles]
                        if lbl in existing:
                            if "lat" in u_low or "419" in u_low:
                                lbl = f"{lbl} (Latin)"
                            elif "es" in u_low or "cast" in u_low or "-2" in u_low:
                                lbl = f"{lbl} (Spain)"
                            else:
                                count = sum(1 for x in existing if x.startswith(lbl)) + 1
                                lbl = f"{lbl} ({count})"

                        subtitles.append({"label": lbl, "url": f_url})
        except Exception as e:
            log.debug(f"[CDN] Failed to query getSources: {e}")

    if not captured:
        return {"ok": False, "error": "Stream playlist (.m3u8) was not captured in time."}

    master = captured[0]
    variants = _parse_variants(master)
    best = variants[0]["url"] if variants else master
    return {
        "ok": True,
        "master": master,
        "best": best,
        "host": urlparse(master).netloc,
        "variants": variants,
        "subtitles": subtitles
    }

def _parse_variants(master_url: str):
    try:
        r = requests.get(master_url, headers=_HDR | {"Referer": f"{_MEGAPLAY}/"}, timeout=12)
        if r.status_code != 200:
            return []
    except Exception as e:
        log.debug(f"[CDN] Variant fetch failed: {e}")
        return []

    base = master_url.rsplit("/", 1)[0]
    tm = re.search(r"token=([^&]+)", master_url)
    tp = f"?token={tm.group(1)}" if tm else ""
    variants = []
    lines = [l.strip() for l in r.text.splitlines() if l.strip()]

    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF"):
            rm = re.search(r"RESOLUTION=(\d+x\d+)", line)
            bm = re.search(r"BANDWIDTH=(\d+)", line)
            if i + 1 < len(lines):
                uri = lines[i + 1]
                if not uri.startswith("#"):
                    full = uri if uri.startswith("http") else f"{base}/{uri}{tp}"
                    res_str = rm.group(1) if rm else "Auto"
                    variants.append({
                        "resolution": res_str,
                        "bandwidth": int(bm.group(1)) if bm else 0,
                        "url": full
                    })

    variants.sort(key=lambda x: x["bandwidth"], reverse=True)
    return variants
