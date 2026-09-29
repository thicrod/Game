# Game

Static site: a fake daily-planner loader that turns into a jumpscare on the first click, tap or keypress. Plain HTML/CSS/JS, no dependencies, no build step.

## Assets

`assets/` holds `foxy.mp4` (the clip), `foxy.gif` (play-once fallback made from the clip) and `scare.mp3`. Swap in other files with the same names, or change the lists in `CONFIG` in `script.js`.

To use hosted files instead, put their URLs at the top of the `CONFIG.visualSources` / `CONFIG.audioSources` arrays; the local paths below them act as fallbacks. If nothing loads, an original built-in creature and a synthesized scream are used.

## Run locally

    python3 -m http.server 8080
    # open http://localhost:8080

## Deploy on Render

Blueprint: push this folder to GitHub, then Render Dashboard → New → Blueprint → pick the repo → Apply.

Manual: New → Static Site → pick the repo → Build Command `echo "No build step"` → Publish Directory `.` → Create.

Every push to the connected branch redeploys automatically.
