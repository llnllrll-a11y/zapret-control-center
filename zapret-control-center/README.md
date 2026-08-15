# Zapret Control Center

A beautiful, modern GUI controller for the "zapret" DPI-bypass tool (winws.exe) on Windows 10/11.

It manages a folder containing zapret (default `C:\zapret`), discovers strategy scripts, launches `winws.exe` with parsed arguments, installs/removes a Windows service, measures real network availability per strategy, ranks strategies, auto-switches when quality degrades, detects network changes, and diagnoses what the provider blocks.

## Features

*   **Mac-like UI:** Clean, spacious, rounded cards, soft shadows, subtle motion, great typography.
*   **Themes:** "Modern", "Black", "Light", "Fallout", "Ocean".
*   **Zapret Path Management:** Easily point to your existing extracted zapret folder.
*   **Strategy Discovery:** Automatically finds and parses `general*.bat` scripts.
*   **Smart Check (Measurement Engine):** Actively tests DNS, TCP, HTTP, and WebSocket connectivity for YouTube and Discord to score and rank each strategy.
*   **Ranking & Auto-Find:** Ranks strategies by score. Finds the best strategy for your current network.
*   **Autopilot:** Automatically rechecks strategies periodically. If quality degrades, it tests and switches to a better strategy if one exists. Learns the best strategy for different ISPs (network ASNs).
*   **Diagnostics (X-Ray):** Interprets Smart Check results into human-readable findings (e.g., "DNS spoofed by provider", "DPI blocks HTTPS by SNI").
*   **Updates:** Checks for updates to both Zapret and the Zapret Control Center app via GitHub.
*   **Lists Editor:** Built-in editor for zapret lists (general, exclude, ipset).

## Requirements

*   Windows 10 or Windows 11.
*   [Flowseal's zapret-discord-youtube release](https://github.com/Flowseal/zapret-discord-youtube/releases) (The app can also download this for you).

## Setup & Running

This is a single portable `.exe`.
1. Download the `ZapretControlCenter.exe`.
2. Run it. (It requires Administrator privileges to manage the Windows Service and run `winws.exe` properly).
