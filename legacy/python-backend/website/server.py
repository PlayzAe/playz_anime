import json
import os
import sys
import re
import subprocess
import mimetypes
import logging
import requests
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

from .api import al_recent, al_search, get_series_full_data
from .cdn import cdn_start, get_cdn_status
from .downloader import dl_start, get_dl_status

log = logging.getLogger("get")

DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

class AniStreamHandler(BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def finish(self):
        try:
            super().finish()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def log_message(self, fmt, *args):
        log.debug(f"[HTTP] {fmt % args}")

    def _json(self, data: dict, code: int = 200):
        try:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def _serve_file(self, file_path: str):
        if not os.path.isfile(file_path):
            try:
                self.send_response(404)
                self.end_headers()
            except Exception:
                pass
            return
        
        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            if file_path.endswith(".js") or file_path.endswith(".mjs"):
                content_type = "application/javascript"
            elif file_path.endswith(".css"):
                content_type = "text/css"
            elif file_path.endswith(".html"):
                content_type = "text/html; charset=utf-8"
            else:
                content_type = "application/octet-stream"

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            if "/assets/" in file_path.replace("\\", "/"):
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            else:
                self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(content)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass
        except Exception as e:
            log.debug(f"Error serving {file_path}: {e}")

    def _read_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        qs = {}
        if "?" in self.path:
            raw_qs = self.path.split("?", 1)[1]
            for pair in raw_qs.split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    qs[k] = requests.utils.unquote(v)

        # API Routes
        if path == "/api/recent":
            page = int(qs.get("page", 1))
            genre = qs.get("genre", "").strip() or None
            format_type = qs.get("format", "").strip() or None
            data = al_recent(page=page, genre=genre, format_type=format_type)
            self._json({
                "ok": True,
                "results": data.get("results", []),
                "page": data.get("page", page),
                "hasNextPage": data.get("hasNextPage", False)
            })

        elif path == "/api/search":
            q = qs.get("q", "").strip()
            page = int(qs.get("page", 1))
            if not q:
                self._json({"ok": False, "error": "Missing search term"})
                return
            data = al_search(q, page=page)
            self._json({
                "ok": True,
                "results": data.get("results", []),
                "page": data.get("page", page),
                "hasNextPage": data.get("hasNextPage", False)
            })

        elif path == "/api/series":
            al_id = qs.get("al_id")
            title = qs.get("title", "")
            if not al_id:
                self._json({"ok": False, "error": "Missing al_id parameter"})
                return
            try:
                al_id = int(al_id)
            except ValueError:
                self._json({"ok": False, "error": "Invalid al_id"})
                return

            data = get_series_full_data(al_id, title)
            self._json(data)

        elif path == "/api/cdn":
            self._json(get_cdn_status())

        elif path == "/api/dl":
            self._json(get_dl_status())

        elif path == "/favicon.ico":
            fav = os.path.join(DIST_DIR, "favicon.ico")
            if os.path.exists(fav):
                self._serve_file(fav)
            else:
                self.send_response(204)
                self.end_headers()

        else:
            # Static file serving from website/dist/
            clean_rel = path.lstrip("/").replace("/", os.sep)
            target_path = os.path.join(DIST_DIR, clean_rel) if clean_rel else os.path.join(DIST_DIR, "index.html")

            if os.path.isfile(target_path):
                self._serve_file(target_path)
            else:
                # SPA Fallback to index.html
                index_path = os.path.join(DIST_DIR, "index.html")
                if os.path.isfile(index_path):
                    self._serve_file(index_path)
                else:
                    self.send_response(503)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(b"Frontend not built. Please run 'npm run build' first.")

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self._read_body()

        if path == "/api/watch":
            embed_url = body.get("embed_url", "").strip()
            if not embed_url:
                self._json({"ok": False, "error": "Missing embed_url"})
                return
            cdn_start(embed_url)
            self._json({"ok": True})

        elif path == "/api/download":
            master_url = (body.get("stream_url") or body.get("master_url") or "").strip()
            if not master_url:
                self._json({"ok": False, "error": "Missing stream_url or master_url"})
                return

            anime_name = body.get("anime_name") or body.get("title") or "Anime"
            season_num = body.get("season_num") or 1
            episode_num = body.get("episode_num") or 1
            quality = body.get("quality", "").strip()
            audio_type = body.get("audio_type", "").strip() or "SUB"
            subtitle_url = body.get("subtitle_url", "").strip()
            subtitle_lang = body.get("subtitle_lang", "").strip()

            user_home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
            videos_base = os.path.join(user_home, "Videos")
            os.makedirs(videos_base, exist_ok=True)

            clean_anime = re.sub(r'[\\/*?:"<>|]', "", str(anime_name)).replace(" ", "_").strip("_") or "Anime"

            try:
                s_int = int(season_num)
                season_dir = f"Season_{s_int:02d}"
            except (ValueError, TypeError):
                season_dir = "Season_01"
                s_int = 1

            target_dir = os.path.join(videos_base, "anime", clean_anime, season_dir)
            os.makedirs(target_dir, exist_ok=True)

            try:
                e_int = int(episode_num)
                ep_tag = f"S{s_int:02d}E{e_int:02d}"
            except (ValueError, TypeError):
                ep_tag = f"S{s_int:02d}E01"

            qm = re.search(r"(\d{3,4}p)", str(quality), re.IGNORECASE)
            clean_q = qm.group(1).lower() if qm else (re.sub(r"[^a-zA-Z0-9]", "", quality) if quality else "HD")
            clean_audio = re.sub(r"[^a-zA-Z0-9]", "", audio_type) if audio_type else "SUB"

            filename = f"{clean_anime}_{ep_tag}_{clean_q}_{clean_audio}.mp4"
            output_file = os.path.join(target_dir, filename)

            subtitle_file = None
            if subtitle_url:
                clean_lang = re.sub(r"[^a-zA-Z0-9]", "", subtitle_lang) if subtitle_lang else "sub"
                subtitle_file = os.path.join(target_dir, f"{clean_anime}_{ep_tag}_{clean_q}_{clean_audio}.{clean_lang}.vtt")

            started = dl_start(master_url, output_file, subtitle_url=subtitle_url, subtitle_file=subtitle_file)
            self._json({
                "ok": started,
                "output_file": output_file,
                "target_dir": target_dir,
                "error": "" if started else "Download task is already running."
            })

        elif path == "/api/open-folder":
            target_path = body.get("path", "").strip()
            if not target_path or not os.path.exists(target_path):
                user_home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
                target_path = os.path.join(user_home, "Videos", "anime")
                os.makedirs(target_path, exist_ok=True)

            try:
                norm_p = os.path.normpath(target_path)
                if os.path.isfile(norm_p):
                    subprocess.Popen(f'explorer.exe /select,"{norm_p}"')
                else:
                    subprocess.Popen(f'explorer.exe "{norm_p}"')
                self._json({"ok": True})
            except Exception as e:
                self._json({"ok": False, "error": str(e)})

        else:
            self.send_response(404)
            self.end_headers()

class PlayzaeServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc_type, exc_val, _ = sys.exc_info()
        if exc_type in (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError) or (
            isinstance(exc_val, OSError) and getattr(exc_val, "winerror", None) == 10053
        ):
            return
        super().handle_error(request, client_address)

def create_server(host: str = "127.0.0.1", start_port: int = 8000):
    for port in range(start_port, start_port + 20):
        try:
            srv = PlayzaeServer((host, port), AniStreamHandler)
            return srv, port
        except OSError:
            continue
    raise RuntimeError("Could not bind to any port between 8000 and 8020.")
