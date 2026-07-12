# 📺 MeSatzTV

Turn your media library into scheduled **24/7 live TV channels** — complete with
bumpers, filler, watermark overlays, and standard **M3U + XMLTV** output that
plugs straight into Plex, Jellyfin, Emby, or any IPTV player.

Inspired by [ErsatzTV](https://ersatztv.org/), built to be simple to run and
easy to update on Unraid.

> **Status:** Milestone 2 — data + media indexing. The app scans your library
> with ffprobe, parses Plex-style names, and lets you browse it Plex-style
> (library → shows → seasons → episodes; movies with detail). Runs on Unraid via
> a template with NVIDIA GPU passthrough. Scheduling & streaming come next.

---

## Tech stack

| Layer      | Choice                                   |
| ---------- | ---------------------------------------- |
| Backend    | Express + TypeScript (`server/`)         |
| Frontend   | React + Vite + Tailwind (`web/`)         |
| Streaming  | ffmpeg / ffprobe (bundled in the image)  |
| Database   | SQLite via Prisma (`server/prisma/`)     |
| Deploy     | A single Docker container                |

---

## Quick start (local development)

Requires Node 22+ and ffmpeg on your PATH.

```bash
npm run install:all   # install root, server, and web dependencies
npm run dev           # backend on :8688, frontend on :5173
```

Open <http://localhost:5173>. The React dev server proxies `/api/*` to the
backend automatically. (First run creates a local SQLite DB at
`server/prisma/dev.db` — run `npm --prefix server run db:push` if it's missing.)

To test a production-style build locally:

```bash
npm run build                 # builds web/dist and server/dist
cp -r web/dist server/public  # backend serves the built UI
node server/dist/index.js     # open http://localhost:8688
```

---

## Deploy on Unraid

Two options: a proper Unraid **template** that pulls a prebuilt image (nicer,
with the WebUI button, icon, GPU, and Edit form), or **Docker Compose** that
builds from source.

### Option A — Unraid template + GHCR image (recommended)

Every push to `main` triggers a GitHub Actions build that publishes the image to
**`ghcr.io/tronvondoom/mesatztv:latest`**. Unraid just pulls it — no building on
the server, and updates are one click.

The image is **private**, so authenticate once, then add the template:

1. **Log in to GHCR on Unraid** (one time). Create a GitHub token with
   `read:packages` scope, then on the Unraid terminal:

   ```bash
   docker login ghcr.io -u TronVonDoom
   # paste the token as the password
   ```

2. **Install the template.** Copy [`unraid/my-MeSatzTV.xml`](unraid/my-MeSatzTV.xml)
   to `/boot/config/plugins/dockerMan/templates-user/my-MeSatzTV.xml` (e.g.
   `curl -L -o /boot/config/plugins/dockerMan/templates-user/my-MeSatzTV.xml \
   https://raw.githubusercontent.com/TronVonDoom/mesatztv/main/unraid/my-MeSatzTV.xml`).

3. On the Unraid **Docker** tab → **Add Container** → pick **MeSatzTV** from the
   template dropdown. Adjust the media path if needed, then **Apply**.

**GPU:** the template sets `--runtime=nvidia` + `NVIDIA_VISIBLE_DEVICES=all`, so
it uses your NVIDIA GPU for hardware transcoding (needs the **Nvidia-Driver**
plugin). Set `NVIDIA_VISIBLE_DEVICES` to a specific GPU UUID (`nvidia-smi -L`)
to pin one card.

**Updating:** Docker tab → MeSatzTV → **Force Update** (or check for updates).
It pulls the newest image built by CI.

### Option B — Docker Compose (build from source)

You'll need **git** and **docker compose** on Unraid. The easiest way is the
**Compose Manager** plugin (Community Apps), which bundles `docker compose`.
For `git`, install the **NerdTools** plugin and enable `git`. The compose file
also enables the NVIDIA runtime — remove `runtime: nvidia` if you don't have an
NVIDIA GPU.

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

## Using it (Milestone 2)

1. Open the web UI → **Libraries**.
2. Add a library pointing at a folder **inside the container**, under your
   mounted `/media` volume — e.g. name `TV Shows`, path `/media/TV`, type
   `TV Shows`. Add another for `/media/Movies` as `Movies`.
3. Click **Scan**. A progress bar shows files being probed. The scanner reads
   duration/resolution/codecs via ffprobe and parses Plex-style names into
   show / season / episode / year / title.
4. Browse everything under **Browse**, Plex-style: pick a library → TV shows
   drill into season tiles and episodes; movies open a detail panel. Tiles use
   **local artwork** (`poster.jpg` / `folder.jpg` / episode thumbnails, Plex &
   Kodi/Jellyfin naming) when present, falling back to a monogram tile. Re-scanning
   is incremental — unchanged files are skipped, files that disappeared are
   flagged missing.

## Roadmap

- [x] **M1 — Deploy loop:** repo, Docker, web UI, GitHub → Unraid update flow
- [x] **M2 — Data + media indexing:** SQLite/Prisma, scan library, build metadata
- [ ] **M3 — Channels & scheduler:** define blocks by day/time, collections
- [ ] **M4 — Guide output:** M3U playlist + XMLTV EPG generation
- [ ] **M5 — Streaming pipeline:** continuous ffmpeg stream, seamless transitions
- [ ] **M6 — Bumpers, filler & overlays:** interstitials + scheduled watermarks
