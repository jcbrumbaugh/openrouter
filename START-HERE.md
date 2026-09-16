# Start here

A plain-language guide to running Node Space on a Mac. No coding needed, and
nothing here changes your Mac in a way you cannot undo.

---

## What you are installing

Exactly one thing: **Node**. It is a free, Apple-signed program from
[nodejs.org](https://nodejs.org) that runs the two small helpers this app needs.
It does not run in the background, does not start with your Mac, and can be
removed later.

Everything else lives inside the project folder. Delete that folder and the app
is gone.

---

## One-time setup

### 1. Install Node

1. Go to [nodejs.org](https://nodejs.org)
2. Click the big **LTS** button on the left
3. Open the downloaded file and click through the installer
4. It asks for your Mac password. That is Apple's installer asking, which is
   normal for any `.pkg`

### 2. Get the project folder

Open **Terminal** (press `Cmd+Space`, type `Terminal`, press Return) and paste
these three lines, pressing Return after each:

```bash
cd ~/Documents
git clone -b claude/node-based-html-api-space-2bdmys https://github.com/jcbrumbaugh/openrouter.git node-space
open node-space
```

A Finder window opens showing the project. Keep it in Documents — it is a normal
folder you can move or delete any time.

### 3. Get your API keys

You need one key per service you want to use. Each is free to create; you pay
per generation.

| Service | Where | What it does |
| --- | --- | --- |
| Tripo | [platform.tripo3d.ai](https://platform.tripo3d.ai) | image → 3D model |
| Runway | [dev.runwayml.com](https://dev.runwayml.com) | image → video (Seedance lives here) |
| OpenRouter | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | text and image models |

Copy each key with the copy button rather than selecting it by hand — a key
that is one character short fails with a confusing error.

**Set a spending limit on each key** while you are in those dashboards. It costs
nothing and it means a mistake can never run away with your money.

---

## Every time you want to use it

**Double-click `start.command`** in the project folder.

A black Terminal window opens and your browser opens to the app. That window is
the app running — leave it open while you work.

The first time only, macOS may say the file is from an unidentified developer.
Right-click `start.command` → **Open** → **Open**. You will not be asked again.

**To stop:** close that Terminal window. Everything stops. Nothing is left
running.

---

## Your first run

1. Click **Keys** at the top → paste a key → choose the matching service from
   the dropdown → **Save key** → **Close**
2. Repeat for each service you have a key for
3. On the **Tripo 3D** node, choose your Tripo key in the *Tripo key* dropdown
4. On the **Runway Video** node, choose your Runway key
5. On the **Image** node, click **Choose File** and pick a picture
6. Click **Run** at the top

Tripo turns your picture into a 3D model, then Runway turns Tripo's preview of
that model into a video. Both take a few minutes. The nodes show their progress,
and the **Log** panel at the bottom right shows what is happening.

---

## Reading the screen

- **gateway on** (top right, green) — the helper that talks to Tripo and Runway
  is running. If it says **gateway off** in orange, close the Terminal window
  and double-click `start.command` again.
- **Node colors** — a node glows amber while it works, green when it is done,
  red if it failed. Red nodes print the reason underneath.
- **Log** (bottom right) — click it to open. Every request and error, newest
  first.

---

## Keeping things tidy

Put what you make in the **`my-work`** folder inside the project. It has
`graphs`, `images`, `models` and `videos` folders ready to use.

**Download anything you want to keep.** Tripo and Runway give you links that
expire. Use the *download* link under a result, and save it into `my-work`.

**Export a graph you like** with the **Export** button. That saves a small file
you can **Import** later to get the same setup back. Your keys are never inside
it.

---

## Getting more out of it

**Use several photos of the same object.** The Tripo node has four image inputs:
Front, Left, Back and Right. Connect one Image node to each and it reconstructs
from all of them, which gets the back of an object right instead of inventing
it. Front alone still works.

**Try variations.** Click a node and press `Cmd+D` to duplicate it. Change the
Seed on the copy, then Run. Two versions sit side by side for comparison.

**Do more with a finished mesh.** Drag from the Tripo node's **Task** dot into a
**Tripo Refine** node to export a different file format (FBX for Blender, USDZ
for Apple AR, STL for printing), re-texture the same shape, or stylize it.

---

## If something goes wrong

| What you see | What it means |
| --- | --- |
| `gateway off` | Close the Terminal window, double-click `start.command` again |
| `401` on a node | That key is wrong, expired, or from another account — paste a fresh one |
| `402` on a node | That account is out of credit, or needs a payment method |
| Nothing happens on double-click | Right-click `start.command` → Open → Open |
| `command not found: git` | macOS will offer to install its developer tools — accept, then retry |

Still stuck? Open the **Log** panel and read the newest line. It names the thing
that failed.

---

## Removing it completely

1. Drag the project folder to the Trash. The app is gone.
2. Your keys are stored by your **browser**, not the folder, so clear them too:
   Chrome → `Cmd+Option+J` → Application → Local Storage → right-click
   `http://localhost:8080` → Clear. Or just delete the keys in each service's
   dashboard, which makes any leftover copy useless.
3. Node, if you want it gone: it lives in `/usr/local/bin/node`. Most people
   leave it — it is inert unless something runs it.

Nothing else was touched. No background services, no login items, no system
settings.
