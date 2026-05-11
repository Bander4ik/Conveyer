# Setup Guide — for non-technical users

This guide walks you through installing and running Conveyer Isabell from absolute zero. If
you've never used a terminal or written a line of code in your life, this is the right document.

There are five parts, in order:

1. [Install Node.js](#1-install-nodejs) — the engine the platform runs on
2. [Install FFmpeg](#2-install-ffmpeg) — used to stitch videos together
3. [Download Conveyer Isabell](#3-download-conveyer-isabell) — the project itself
4. [Get the two required API keys](#4-get-the-two-required-api-keys) — Google + 69labs
5. [Run your first video](#5-run-your-first-video)

Each step lists what to download, where to click, and what to expect. You can stop after any
section and come back later — the platform remembers where you left off.

---

## 1. Install Node.js

Node.js is the program that runs the platform's code. You install it once and forget about it.

1. Open https://nodejs.org/ in your browser.
2. Click the **green "LTS"** button (the one labeled "Recommended for Most Users"). A file like
   `node-v20.x.x-x64.msi` will start downloading.
3. When the download finishes, **double-click the file** to open the installer.
4. Click **Next → Next → Next → Install**. Accept the license, leave all default options. When
   it asks about "Tools for Native Modules", you can leave that checkbox unticked — we don't
   need it.
5. When you see "Completed", click **Finish**.

**How to verify it worked:**

- Open the Start menu, type `cmd`, press Enter. A black window appears.
- Type `node --version` and press Enter.
- If you see something like `v20.18.0`, Node is installed correctly. Close the window.

---

## 2. Install FFmpeg

FFmpeg stitches your generated audio and images into a final video. The easiest way on
Windows is via Microsoft's built-in installer **winget**.

1. Open the Start menu, type `cmd`, press Enter.
2. Copy this command and paste it into the black window:

   ```
   winget install --id Gyan.FFmpeg
   ```

3. Press Enter. It will download for a minute or two and finish on its own.
4. **Close the black window completely**, then open a new one (this is important — the new
   window will know about FFmpeg, the old one doesn't yet).
5. Type `ffmpeg -version` and press Enter. If you see a bunch of text starting with
   `ffmpeg version 8.x.x`, you're done.

**If you're on macOS instead:** open Terminal and run `brew install ffmpeg`.
**On Linux:** `sudo apt install ffmpeg`.

---

## 3. Download Conveyer Isabell

### Option A — Simplest: download a ZIP

1. Open the project repository page in your browser (the GitHub link you were given).
2. Click the green **"< > Code"** button.
3. Click **"Download ZIP"** at the bottom of the dropdown.
4. When the ZIP finishes downloading, right-click it → **"Extract All..."** → choose where
   to put it (e.g. `C:\YouTube\Conveyer-Isabell`) → **Extract**.

You now have a folder called `Conveyer Isabell-main` (or similar). Open it.

### Option B — Easier to update later: use git

This option lets you pull in future bug fixes with one command. Skip if "git" sounds scary.

1. Open the Start menu, type `cmd`, press Enter.
2. Type:
   ```
   cd C:\YouTube
   git clone https://github.com/Bander4ik/Conveyer.git
   ```
   (You may need to create `C:\YouTube` first — replace with any folder you like.)

### Install the project's dependencies

Whichever option you used, you now have a folder with the project files. Open it.

You should see files like `package.json`, `start.bat`, `install.bat`, `README.md`.

**Double-click `install.bat`**. A black window opens and downloads ~100 MB of helper code
from npm. Wait until you see "Done! Run start.bat to launch the app." Then close the window.

This usually takes 1–3 minutes the first time. You only do this once.

---

## 4. Get the two required API keys

The platform talks to two outside services to do its work. Each one requires you to register
and copy a "key" (a long random string). It looks scary but takes 5 minutes total.

### 4a. Google AI key (free)

This is used by the LLM that splits your script into individual scenes.

1. Open https://aistudio.google.com/app/apikey in your browser.
2. Sign in with any Google account.
3. Click the blue **"Create API key"** button.
4. A long string starting with `AIzaSy...` appears. Click the copy icon next to it.
5. **Open Notepad** and paste it temporarily — you'll need it in the next section. Don't share
   this key with anyone.

The free tier gives you generous limits — you won't pay anything for normal use.

### 4b. 69labs key (paid subscription)

This is the all-in-one key that covers voiceover, image generation, and video animation.

1. Open https://69labs.vip in your browser.
2. Sign up with email + password.
3. Pick a subscription plan that includes API access (look for plans that mention API in the
   feature list — usually anything from "Pro" tier and above).
4. After payment, go to your **Account → API keys** page.
5. Click **"Create new API key"** (or whatever the button is called).
6. A key starting with `vk_...` appears. Copy it.
7. Paste it into your Notepad alongside the Google key.

---

## 5. Run your first video

Now we tie everything together.

### Start the platform

1. Go back to the project folder.
2. **Double-click `start.bat`**.
3. A black window opens. After a few seconds it says "Ready in 1.6s" and your browser opens
   to `http://localhost:3000`.
4. You'll see the Conveyer Isabell home page with a "New run" form.

The black window must stay open while you use the platform. Closing it stops the server.

### Enter your API keys

1. In the sidebar on the left, click **"Keys & Settings"**.
2. The top section is **Required API Keys** with a red border. There are two fields:
   `GOOGLE_API_KEY` and `LABS69_API_KEY`. Both look red because they're empty.
3. Paste your Google key into `GOOGLE_API_KEY`.
4. Paste your 69labs key into `LABS69_API_KEY`.
5. Scroll to the top, click **"Save all changes"**. You should see "Saved ✓".

That's it for configuration. Everything else has sensible defaults.

### Generate your first video

1. Click **"New run"** in the sidebar.
2. Give the run a title — anything you want (e.g. `My first test`). This becomes the folder
   name on disk.
3. Paste a script into the big text box. For a first test, try something short — 200 words is
   enough to verify everything works without burning credits.
4. Below the script box, you'll see live word count and estimated video length. Make sure they
   look reasonable.
5. Click **"Run pipeline"**.

You're now on the run page. Live logs stream in from the server as work progresses:

- The script gets split into scenes (~10 seconds)
- Each scene's voiceover is generated (parallel, ~10 seconds for short scripts)
- Each scene's image is generated (parallel, 1–5 minutes depending on settings)
- FFmpeg stitches everything together (~1 minute for a 1-minute video)

When you see "Pipeline complete", scroll up. The final video appears at the top with a play
button, a Download button, and an "Open folder" button.

### Where everything lives

Generated files are saved here by default:

- **Windows:** `C:\Users\YOUR_USERNAME\.conveyer-isabell\runs\YOUR_RUN_TITLE\`
- **macOS:** `~/.conveyer-isabell/runs/YOUR_RUN_TITLE/`

The folder starts with a dot, which means Windows hides it by default. The "Open folder"
button on the run page is the easiest way to get to it.

You can change this location in **Keys & Settings → Storage Location → RUNS_OUTPUT_DIR**.

---

## Troubleshooting

### "Port 3000 is already in use"
Another copy of the server is still running somewhere. Double-click `stop.bat` to kill it,
then try `start.bat` again.

### "ffmpeg: command not found" or assembly fails
Either FFmpeg isn't installed, or it isn't in your system PATH. Easiest fix: in
**Keys & Settings → Storage Location → FFMPEG_PATH**, paste the absolute path to
`ffmpeg.exe`. On Windows it's usually
`C:\Users\YOUR_NAME\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-X.X.X-full_build\bin\ffmpeg.exe`.

### The pipeline says "GOOGLE_API_KEY is not set" even though you saved it
Make sure you saved with **"Save all changes"** at the top of the page, not just hit Enter
inside the field. Refresh the page — if the field still shows masked dots, the save worked.

### A specific scene fails but the rest succeed
This is normal. AI services sometimes drop requests. The platform marks failed scenes and
keeps going. When the run finishes with errors, you'll see a **"Reassemble from existing
assets"** button that regenerates only the missing pieces.

### The voice "swallows" sentence endings or speaks too fast
Open **Keys & Settings → Sentence Pauses**. Make sure `TTS_AUTO_PAUSE` is `1` and
`TTS_PAUSE_DURATION` is around `0.4`. For an even slower delivery, lower `TTS_SPEED` in
**Voice Fine-Tuning** from `0.93` down to `0.88`.

### Images don't match the script content
The look-and-feel of every image is controlled by the **scene_split** and **image_prompt**
fields in the `/prompts` page. The defaults are tuned for cosmic / astronomy content. If your
channel is on a different topic, edit `image_prompt` to remove the space-specific styling, and
edit `scene_split` to give the LLM different visual direction.

### Generation is too slow
Open **Keys & Settings → Performance (Concurrency)**. Raise `IMAGE_CONCURRENCY` to `6` or
`7` (7 is the 69labs hard limit). On a beefy CPU, raise `ASSEMBLE_CONCURRENCY` to `6` or `8`.

---

## What to do next

- Read [README.md](./README.md) for the architecture overview.
- Read the inline descriptions on the **Keys & Settings** page — every field is explained.
- Edit the **Prompts** page to control visual style and how the LLM splits scripts.
- Increase `ANIMATION_RATIO_PERCENT` in settings if you want more video animation in your
  final output (it defaults to 50% — first half video, second half photos with Ken-Burns).

If you get stuck on something not covered here, open an Issue on the GitHub repository with
a screenshot of the error and the contents of the black terminal window.
