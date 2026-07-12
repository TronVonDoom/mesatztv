# 📺 MeSatzTV

Turn your media library into scheduled **24/7 live TV channels** — complete with
bumpers, filler, watermark overlays, and standard **M3U + XMLTV** output that
plugs straight into Plex, Jellyfin, Emby, or any IPTV player.

Inspired by [ErsatzTV](https://ersatztv.org/), built to be simple to run and
easy to update on Unraid.

> **Status:** Milestone 1 — the deploy loop. The app boots, serves a web UI, and
> confirms `ffmpeg` is available. Scheduling, streaming, and overlays come next.

---

## Tech stack

| Layer      | Choice                                   |
| ---------- | ---------------------------------------- |
| Backend    | Express + TypeScript (`server/`)         |
| Frontend   | React + Vite + Tailwind (`web/`)         |
| Streaming  | ffmpeg (bundled in the Docker image)     |
| Database   | SQLite via Prisma *(added in Milestone 2)* |
| Deploy     | A single Docker container                |

---

## Quick start (local development)

Requires Node 22+ and ffmpeg on your PATH.

```bash
npm run install:all   # install root, server, and web dependencies
npm run dev           # backend on :8688, frontend on :5173
```

Open <http://localhost:5173>. The React dev server proxies `/api/*` to the
backend automatically.

To test a production-style build locally:

```bash
npm run build                 # builds web/dist and server/dist
cp -r web/dist server/public  # backend serves the built UI
node server/dist/index.js     # open http://localhost:8688
```

---

## Deploy on Unraid

The whole point of this setup: **push to GitHub → pull on Unraid → rebuild.**
No manual file copying, no image registry needed.

### One-time setup

You'll need **git** and **docker compose** on Unraid. The easiest way is the
**Compose Manager** plugin (Community Apps), which bundles `docker compose`.
For `git`, install the **NerdTools** plugin and enable `git`.

1. Open an Unraid terminal (or SSH in).

2. Clone the repo to a share on the array (persists across reboots):

   ```bash
   mkdir -p /mnt/user/appdata
   cd /mnt/user/appdata
   git clone https://github.com/TronVonDoom/mesatztv.git
   cd mesatztv
   ```

3. Point the media volume at your library. Edit `docker-compose.yml` and change
   the media line to your actual media share, e.g.:

   ```yaml
       volumes:
         - ./data:/app/data
         - /mnt/user/media:/media:ro
   ```

4. Build and start it:

   ```bash
   docker compose up -d --build
   ```

5. Open **http://<your-unraid-ip>:8688**. You should see “MeSatzTV is alive”
   with `ffmpeg: available`. 🎉

### Updating (the loop you wanted)

Whenever we push changes to GitHub, update your Unraid instance with one command:

```bash
cd /mnt/user/appdata/mesatztv
./scripts/update.sh
```

That pulls the latest code, rebuilds the image, restarts the container, and
prunes old images. (Equivalent to `git pull && docker compose up -d --build`.)

> **Tip:** You can wire `scripts/update.sh` into the Unraid **User Scripts**
> plugin to add a one-click "Update MeSatzTV" button, or schedule it.

---

## Configuration

Set these in `docker-compose.yml` under `environment:`

| Variable | Default            | Purpose                          |
| -------- | ------------------ | -------------------------------- |
| `PORT`   | `8688`             | Port the app listens on          |
| `TZ`     | `America/Chicago`  | Timezone for schedules & guide   |

Volumes:

| Container path | Purpose                                        |
| -------------- | ---------------------------------------------- |
| `/app/data`    | Database + config (persistent — keep this)     |
| `/media`       | Your media library (mount read-only)           |

---

## Roadmap

- [x] **M1 — Deploy loop:** repo, Docker, web UI, GitHub → Unraid update flow
- [ ] **M2 — Data + media indexing:** SQLite/Prisma, scan library, build metadata
- [ ] **M3 — Channels & scheduler:** define blocks by day/time, collections
- [ ] **M4 — Guide output:** M3U playlist + XMLTV EPG generation
- [ ] **M5 — Streaming pipeline:** continuous ffmpeg stream, seamless transitions
- [ ] **M6 — Bumpers, filler & overlays:** interstitials + scheduled watermarks
