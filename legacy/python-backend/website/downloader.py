import os
import re
import shutil
import tempfile
import threading
import subprocess
import logging
import time
import requests

log = logging.getLogger("get")

_MEGAPLAY = "https://megaplay.buzz"
_HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}

_dl = {
    "status": "idle",
    "message": "",
    "progress": 0,
    "output_file": "",
    "error": "",
    "bytes_dl": 0,
    "total_segs": 0,
    "done_segs": 0,
    "speed_mbps": 0.0,
    "speed_str": "",
    "mb_downloaded": 0.0
}
_dl_lock = threading.Lock()

def get_dl_status():
    with _dl_lock:
        return dict(_dl)

def _get_ffmpeg():
    p = shutil.which("ffmpeg")
    if p:
        return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        log.error(f"[Downloader] Failed to locate FFmpeg: {e}")
        return "ffmpeg"

def dl_start(master_url: str, output_file: str, subtitle_url: str = None, subtitle_file: str = None) -> bool:
    with _dl_lock:
        if _dl["status"] == "running":
            return False
        _dl.update({
            "status": "running",
            "message": "Initializing download...",
            "progress": 0,
            "output_file": output_file,
            "error": "",
            "bytes_dl": 0,
            "total_segs": 0,
            "done_segs": 0,
            "speed_mbps": 0.0,
            "speed_str": "",
            "mb_downloaded": 0.0
        })
    threading.Thread(target=_dl_worker, args=(master_url, output_file, subtitle_url, subtitle_file), daemon=True).start()
    return True

def _dl_worker(master_url: str, out: str, subtitle_url: str = None, subtitle_file: str = None):
    session = requests.Session()
    session.headers.update(_HDR | {"Referer": f"{_MEGAPLAY}/"})

    def _update(**kw):
        with _dl_lock:
            _dl.update(kw)

    tmp_ts = os.path.join(tempfile.gettempdir(), f"anime_stream_{os.getpid()}.ts")

    try:
        _update(message="Connecting to stream server...")
        resp = session.get(master_url, timeout=15)
        if resp.status_code != 200:
            raise Exception(f"Stream manifest HTTP {resp.status_code}")

        base = master_url.rsplit("/", 1)[0]
        tm = re.search(r"token=([^&]+)", master_url)
        tp = f"?token={tm.group(1)}" if tm else ""

        variant_text = resp.text
        base_v = base

        # If it's a master playlist, pick the highest bandwidth variant
        if "#EXT-X-STREAM-INF" in resp.text:
            lines = [l.strip() for l in resp.text.splitlines() if l.strip()]
            vs = []
            for i, line in enumerate(lines):
                if line.startswith("#EXT-X-STREAM-INF"):
                    bm = re.search(r"BANDWIDTH=(\d+)", line)
                    if i + 1 < len(lines):
                        uri = lines[i + 1].strip()
                        if not uri.startswith("#"):
                            full = uri if uri.startswith("http") else f"{base}/{uri}{tp}"
                            vs.append((int(bm.group(1)) if bm else 0, full))
            if vs:
                variant_url = sorted(vs, reverse=True)[0][1]
                _update(message="Resolving video stream segments...", progress=4)
                vr = session.get(variant_url, timeout=15)
                if vr.status_code != 200:
                    raise Exception(f"Variant playlist HTTP {vr.status_code}")
                variant_text = vr.text
                base_v = variant_url.rsplit("/", 1)[0]

        segs = []
        for line in variant_text.splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                url = line if line.startswith("http") else f"{base_v}/{line}"
                if "?" not in url and tp:
                    url += tp
                segs.append(url)

        if not segs:
            raise Exception("No transport stream segments found in playlist.")

        total = len(segs)
        _update(total_segs=total, message=f"0/{total} segments (0.0 MB)", progress=5)
        log.info(f"[DL] Downloading {total} segments to temporary file {tmp_ts}...")

        bytes_total = 0
        start_t = time.time()
        last_speed_t = start_t
        last_bytes = 0
        current_speed_mbs = 0.0

        with open(tmp_ts, "wb") as f:
            for i, url in enumerate(segs):
                for attempt in range(3):
                    try:
                        sr = session.get(url, timeout=20)
                        if sr.status_code == 200:
                            f.write(sr.content)
                            bytes_total += len(sr.content)
                            break
                    except Exception:
                        pass

                now = time.time()
                dt = now - last_speed_t
                if dt >= 0.4:
                    current_speed_mbs = ((bytes_total - last_bytes) / (1024 * 1024)) / dt
                    last_speed_t = now
                    last_bytes = bytes_total

                mb = bytes_total / (1024 * 1024)
                speed_mbps = current_speed_mbs * 8
                speed_str = f"{current_speed_mbs:.1f} MB/s ({speed_mbps:.1f} Mbps)" if current_speed_mbs > 0.05 else "Buffering..."
                pct = 5 + int((i + 1) / total * 85)
                _update(
                    message=f"{mb:.1f} MB downloaded · {speed_str} ({i + 1}/{total} segments)",
                    progress=pct,
                    bytes_dl=bytes_total,
                    done_segs=i + 1,
                    speed_mbps=round(speed_mbps, 1),
                    speed_str=speed_str,
                    mb_downloaded=round(mb, 1)
                )

        # Download subtitle if requested
        if subtitle_url and subtitle_file:
            try:
                _update(message="Downloading subtitle track...", progress=90)
                sub_dir = os.path.dirname(subtitle_file)
                if sub_dir:
                    os.makedirs(sub_dir, exist_ok=True)
                s_resp = session.get(subtitle_url, timeout=12)
                if s_resp.status_code == 200:
                    with open(subtitle_file, "wb") as sf:
                        sf.write(s_resp.content)
                    log.info(f"[DL] Subtitle track saved to {subtitle_file}")
            except Exception as se:
                log.warning(f"[DL] Subtitle download warning: {se}")

        mb = bytes_total / (1024 * 1024)
        _update(message=f"Muxing {mb:.1f} MB into MP4 container...", progress=92)
        log.info(f"[DL] Muxing {mb:.1f} MB to final MP4: {out}")

        ffmpeg_bin = _get_ffmpeg()
        cmd = [
            ffmpeg_bin, "-y",
            "-i", tmp_ts,
            "-c", "copy",
            "-bsf:a", "aac_adtstoasc",
            out
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise Exception(f"FFmpeg muxing failed: {res.stderr[-400:]}")

        if os.path.exists(tmp_ts):
            try:
                os.remove(tmp_ts)
            except Exception:
                pass

        _update(
            status="done",
            message=f"Saved {mb:.1f} MB to Videos",
            progress=100,
            output_file=out,
            mb_downloaded=round(mb, 1),
            speed_str=""
        )
        log.info(f"[DL] Successfully completed: {out} ({mb:.1f} MB)")

    except Exception as e:
        log.error(f"[DL] Download error: {e}")
        if os.path.exists(tmp_ts):
            try:
                os.remove(tmp_ts)
            except Exception:
                pass
        _update(
            status="error",
            message="Download failed.",
            error=str(e),
            speed_str=""
        )
