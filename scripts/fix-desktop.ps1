$content = @'
<p align="center">
  <a href="https://playzae.github.io/playz_anime_landingpage/">
    <img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/icon.png" alt="PlayzAnime Logo" width="75px" />
  </a>
</p>

<h1 align="center"><b>PlayzAnime</b></h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/og.png" alt="PlayzAnime home screen" width="100%" />
</p>

<p align="center">
  <a href="https://playzae.github.io/playz_anime_landingpage/">Website</a> |
  <a href="https://playz-anime.onrender.com">Web App</a> |
  <a href="#get-started">Get Started</a> |
  <a href="#features">Features</a> |
  <a href="https://playzae.github.io/playz_anime_landingpage/docs">Documentation</a> |
  <a href="https://playzae.github.io/playz_anime_landingpage/docs/policies/dmca">Copyright</a>
</p>

<div align="center">
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-f0532c?style=flat-square" alt="Windows 10 and 11" />
  <img src="https://img.shields.io/badge/electron-30+-2b2622?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-2b2622?style=flat-square&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/ads-none-93c48d?style=flat-square" alt="No ads" />
  <a href="https://github.com/PlayzAe"><img src="https://img.shields.io/static/v1?label=Support&message=%E2%9D%A4&style=flat-square&logo=GitHub&color=%23f0532c" alt="Support PlayzAnime" /></a>
</div>

<h5 align="center">If PlayzAnime is useful to you, a star or a follow on <a href="https://github.com/PlayzAe">GitHub</a> keeps it going. ⭐️</h5>

<br>

## About

PlayzAnime is a Windows desktop application for **watching and downloading anime** and **reading and downloading manga, manhwa, and manhua**, in one place. Metadata comes from AniList; streams and chapters are sourced directly from public third-party providers. It features a custom native player, dedicated manga reader, offline media library, and private profiles you can share with friends.

> [!IMPORTANT]
> PlayzAnime does not host, upload, or distribute any media. It parses content that third-party sites already make public. Users are responsible for their own use and for complying with their local copyright laws.

---

## Features

- **Native Video Player:** Streams play directly in PlayzAnime's custom player with zero ads: auto skip intro/outro, next episode autoplay, subtitle rendering in any language, keyboard shortcuts, picture-in-picture, taskbar playback controls, and Windows media keys.
- **Resilient Background Downloads:** Episodes download as standard MP4 with embedded subtitles; manga chapters download as CBZ. Downloads automatically resume on interruption, respect rate limits, and organize into tidy folders: `PlayzAnime\<Show>\Season 2\<Show>_E05_720p.mp4` and `PlayzManga\<Series>\<Series>_Ch012.cbz`.
- **True Offline Mode:** With no internet connection, PlayzAnime seamlessly opens on your local library. Watch downloaded episodes and read saved manga chapters grouped by series, season, and quality.
- **Multi-Source Manga Auto-Pick:** MangaDex, WeebCentral, Flame Comics, and MangaPill are searched in parallel. PlayzAnime automatically serves chapters from whichever source is furthest along, skipping any that are unresponsive. Includes a live health check in Settings.
- **Dual-Mode Manga Reader:** Traditional manga opens right-to-left in single pages; manhwa and webtoons open in a continuous vertical scroll strip. Features fit-to-width/height, keyboard navigation, and instant source switching.
- **Portable User Profiles:** Create a custom profile with avatars and favorite lists. Export your profile as a compact `.playzanime` file to share with friends, allowing them to view your watchlist in its own isolated tab.
- **Automated First-Run Setup:** First launch sets up storage directories, verifies Windows Controlled Folder Access (with one-click allowlisting), and warms the catalog in your custom accent theme.
- **Low-Bandwidth Data Saver:** Limits video buffer consumption, caps stream resolution at 720p, and serves compressed image pages from providers.

---

## Screenshots

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/screenshots/home.png" alt="Home Screen" /></td>
    <td><img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/screenshots/manga.png" alt="Manga Reader" /></td>
  </tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/screenshots/downloads.png" alt="Downloads Manager" /></td>
    <td><img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/screenshots/profiles.png" alt="User Profiles" /></td>
  </tr>
</table>

---

## Get started

1. Download **`PlayzAnime-Setup-0.1.0.exe`** (Windows Installer) or **`PlayzAnime-Portable-0.1.0.exe`** (Single Portable Binary).
2. If Windows SmartScreen displays a warning for unsigned software: click **More info** → **Run anyway**.
3. Launch the app. First-run configuration takes under a minute.

> [!TIP]
> **Controlled Folder Access Warning:** If Windows Defender Ransomware Protection is enabled, it may block writes to Desktop/Documents. Choose **Allow PlayzAnime** during setup or in **Settings → Downloads**, or run `resources\tools\allow-folder-access.bat` from the installation directory.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl K` or `/` | Search anime and manga |
| `Space` or `K` | Play / Pause |
| `J` / `L` | Seek backward / forward 10 seconds |
| `←` / `→` | Seek backward / forward 5 seconds |
| `N` / `P` | Next / Previous episode |
| `S` | Skip intro / outro |
| `C` | Cycle subtitles |
| `F` / `T` | Fullscreen / Theater mode |
| `[` / `]` | Previous / Next manga chapter |
| `M` | Switch between Scroll and Page reading mode |

---

## Development & Build

### Prerequisites
- Node.js >= 20 LTS
- npm >= 9
- Windows 10 or 11 (64-bit)

### Commands
```bash
# Start development server with hot-reload
npm run dev

# Run self-tests (verifies HLS extraction, MP4 remuxing, offline storage)
npm run selftest

# Package Windows Installer and Portable executable
npm run package:win
```

The compiled binaries will be output to the `release/` directory.

---

## Tech Stack

* **Shell & Core:** [Electron](https://www.electronjs.org/)
* **Frontend:** [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/)
* **Media Remuxing:** [ffmpeg](https://ffmpeg.org/) (downloaded on demand for episode packaging)
* **Metadata & Tracker:** [AniList GraphQL API](https://graphql.anilist.co)

---

## License & Policies

Distributed under custom fair-use terms. For DMCA notices and takedown requests, consult [Legal & DMCA Policies](https://playzae.github.io/playz_anime_landingpage/docs/policies/dmca).
'@

[System.IO.File]::WriteAllText("C:\Users\Moses\Documents\GitHub\playz_anime_desktopapp\README.md", $content, [System.Text.Encoding]::UTF8)
Write-Output "Successfully wrote clean README to playz_anime_desktopapp!"
