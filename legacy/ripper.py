import os
import re
import subprocess
import requests

def download_stream_manually(master_url: str, output_filename: str = "anime_output.mp4"):
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://megaplay.buzz/"
    })
    
    print("[*] Fetching manifest...")
    resp = session.get(master_url)
    if resp.status_code != 200:
        raise Exception(f"[-] Failed to fetch manifest, status: {resp.status_code}")
        
    content = resp.text
    base_url = master_url.rsplit('/', 1)[0]
    token_match = re.search(r'token=([^&]+)', master_url)
    token_param = f"?token={token_match.group(1)}" if token_match else ""
    
    variant_url = None
    if "#EXT-X-STREAM-INF" in content:
        lines = [l.strip() for l in content.splitlines() if l.strip()]
        variants = []
        for i, line in enumerate(lines):
            if line.startswith("#EXT-X-STREAM-INF"):
                bw_match = re.search(r'BANDWIDTH=(\d+)', line)
                bw = int(bw_match.group(1)) if bw_match else 0
                if i + 1 < len(lines):
                    v_uri = lines[i+1].strip()
                    if not v_uri.startswith("#"):
                        v_full = v_uri if v_uri.startswith("http") else f"{base_url}/{v_uri}{token_param}"
                        variants.append((bw, v_full))
        if variants:
            variants.sort(key=lambda x: x[0], reverse=True)
            variant_url = variants[0][1]
    
    if not variant_url:
        variant_url = master_url

    print(f"[*] Downloading variant playlist: {variant_url}")
    var_resp = session.get(variant_url)
    if var_resp.status_code != 200:
        raise Exception("[-] Failed to fetch variant playlist.")
        
    var_content = var_resp.text
    base_var_url = variant_url.rsplit('/', 1)[0]
    
    segments = []
    for line in var_content.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            if not line.startswith("http"):
                seg_url = f"{base_var_url}/{line}"
            else:
                seg_url = line
            if "?" not in seg_url and token_param:
                seg_url += token_param
            segments.append(seg_url)
            
    print(f"[+] Found {len(segments)} stream segments to download.")
    
    temp_ts = "downloaded_stream.ts"
    print(f"[*] Downloading segments into binary stream: {temp_ts}")
    
    with open(temp_ts, "wb") as outfile:
        for i, seg_url in enumerate(segments):
            print(f"[*] Downloading segment {i+1}/{len(segments)}...", end="\r")
            seg_resp = session.get(seg_url, timeout=15)
            if seg_resp.status_code == 200:
                outfile.write(seg_resp.content)
            else:
                print(f"\n[-] Warning: Failed to download segment {i+1}, status: {seg_resp.status_code}")
                
    print("\n[+] All segments downloaded successfully. Muxing to final MP4 via FFmpeg...")
    
    cmd = [
        "ffmpeg",
        "-y",
        "-i", temp_ts,
        "-c", "copy",
        "-bsf:a", "aac_adtstoasc",
        output_filename
    ]
    
    try:
        subprocess.run(cmd, check=True)
        print(f"\n[SUCCESS] Rip complete: {output_filename}")
    except subprocess.CalledProcessError as e:
        print(f"[-] FFmpeg muxing failed with code {e.returncode}")
    finally:
        if os.path.exists(temp_ts):
            os.remove(temp_ts)

if __name__ == "__main__":
    target_master = "https://fetch.nexabloom.top/anime/2a084e55c87b1ebcdaad1f62fdbbac8e/f90f54b024e9be2d84327e95ab7dcc75/index-f1-v1-a1.m3u8?token=MTc4OTk1NzIwNnwyYTA4NGU1NWM4N2IxZWJjZGFhZDFmNjJmZGJiYWM4ZS9mOTBmNTRiMDI0ZTliZTJkODQzMjdlOTVhYjdkY2M3NQ.ai23CweVy04oGccd-wwcYi9VL1LK1ticOUKO8bW1VmM"
    download_stream_manually(target_master, "anime_output.mp4")