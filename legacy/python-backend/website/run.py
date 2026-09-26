"""
website/run.py — AniStream Web Application Runner
Auto-installs missing dependencies and starts local server & browser.
Includes robust self-cleanup on termination (Ctrl+C, terminal exit, or taskkill).
"""
import os
import sys
import atexit
import signal
import subprocess
import threading
import webbrowser
import logging

_DEPS = [
    ("requests",          "requests"),
    ("selenium",          "selenium"),
    ("webdriver_manager", "webdriver-manager"),
    ("imageio_ffmpeg",    "imageio-ffmpeg"),
    ("bs4",               "beautifulsoup4"),
]

def _bootstrap():
    missing = []
    for mod, pkg in _DEPS:
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"[*] Installing required packages: {', '.join(missing)} ...")
        subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing + ["-q"])
        print("[*] Installation complete, continuing...")

_bootstrap()

# Setup logging
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_FILE = os.path.join(WORKSPACE_DIR, "get_debug.log")

file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
file_handler.setLevel(logging.DEBUG)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[file_handler, console_handler]
)

log = logging.getLogger("get")

for noisy in ("urllib3", "selenium", "WDM", "hpack", "httpcore"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Ensure parent workspace directory is in sys.path
if WORKSPACE_DIR not in sys.path:
    sys.path.insert(0, WORKSPACE_DIR)

from website.server import create_server
from website.cdn import cleanup_cdn_driver

_SERVER = None
_SHUTDOWN_EVENT = threading.Event()
_CLEANED_UP = False

def cleanup_all():
    global _CLEANED_UP, _SERVER
    if _CLEANED_UP:
        return
    _CLEANED_UP = True
    log.info("Shutdown initiated. Cleaning up drivers and server sockets...")
    cleanup_cdn_driver()
    if _SERVER:
        try:
            _SERVER.shutdown()
            _SERVER.server_close()
        except Exception:
            pass
    # Kill any orphaned chromedriver processes on Windows
    if os.name == "nt":
        try:
            subprocess.run(["taskkill", "/F", "/IM", "chromedriver.exe"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

atexit.register(cleanup_all)

# Handle Windows Console Close Event (clicking the 'X' button on CMD window)
if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    PHANDLER_ROUTINE = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)

    def _win_console_ctrl_handler(dwCtrlType):
        cleanup_all()
        _SHUTDOWN_EVENT.set()
        return False

    _handler_ref = PHANDLER_ROUTINE(_win_console_ctrl_handler)
    ctypes.windll.kernel32.SetConsoleCtrlHandler(_handler_ref, True)

def _signal_handler(signum, frame):
    cleanup_all()
    _SHUTDOWN_EVENT.set()

signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)

def main():
    global _SERVER
    print("=" * 60)
    print("           ⚡ PlayzAe.Tv — Streaming Portal")
    print(f"  Logging to: {LOG_FILE}")
    print("=" * 60)

    server, port = create_server("127.0.0.1", 8000)
    _SERVER = server
    url = f"http://127.0.0.1:{port}"

    log.info(f"Server initialized at {url}")
    print(f"\n[+] Local Server running: {url}")
    print("[*] Opening browser interface...")
    print("[!] Press Ctrl+C in this terminal or close window to exit.\n")

    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    webbrowser.open(url)

    try:
        _SHUTDOWN_EVENT.wait()
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        cleanup_all()
        print("\n[+] PlayzAe.Tv stopped cleanly.")

if __name__ == "__main__":
    main()
