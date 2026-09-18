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
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | text or image → images. **Not covered by a ChatGPT subscription** — the API is billed separately |
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

## Keeping your work

Your Mac already has a **`my-work`** folder inside the project. The app can now
write to it directly.

**To save something:** add a **Save to Library** node (left sidebar, under
Library) and drag the result into it — a mesh, a video, an image. Give it a
title, some tags and notes, then Run. The file lands in `my-work/models`,
`my-work/videos` or `my-work/images`, with your notes saved beside it.

**To find it later:** click the **Library** tab at the top of the left sidebar.
Everything you have saved is there with a thumbnail. Search by title, tag or
note. Edit notes and tags right in the panel — changes save as you go. **Add to
canvas** brings an image back into the graph to use again.

**Sticky notes:** the **Note** node is a place to write down what worked — a
seed, a setting, an idea for next time. It is saved with the graph, and you can
wire it into a Save node so a result is filed together with the thinking behind
it.

Nothing leaves your Mac. There is no account and no cloud copy; if you delete
the `my-work` folder, it is gone.

---

## Getting updates

**Double-click `update.command`** in the project folder. It downloads the latest
version, lists what changed, and tells you when it is done. It never touches
your keys, your exported graphs or anything in `my-work`.

Then double-click `start.command` as usual, and once the app opens press
`Command + Shift + R` — that forces the browser to load the new version instead
of the copy it remembered.

---

## Getting more out of it

**Use several photos of the same object.** The Tripo node has four image inputs:
Front, Left, Back and Right. Connect one Image node to each and it reconstructs
from all of them, which gets the back of an object right instead of inventing
it. Front alone still works.

**Generate several images at once.** The OpenAI Image node has a *Variations per
run* slider. Set it to 4, press Run, and click whichever thumbnail you like —
that one feeds the next node. Clicking a different one is free; you already paid
for all four.

**Try variations.** Click a node and press `Cmd+D` to duplicate it. Change the
Seed on the copy, then Run. Two versions sit side by side for comparison.

**Generate several at once.** The Tripo node has *Generations per run* — set it
to 2 or 4, press Run, and each result appears as a thumbnail. Click the one you
like; the others cost nothing more.

**Clean up the mesh for rigging.** Drag the Tripo node's **Task** dot into a
**Tripo Smart Mesh** node. That is the Studio's Smart Mesh: pick quads or
triangles and a polycount between 500 and 25,000, and it rebuilds the mesh with
clean edge flow using Tripo's P2.0 model.

**Set a polygon budget.** The Tripo node has a *Polygon budget* slider. Left at
`auto` Tripo decides. Moving it caps how many faces the mesh has, which matters
if the model is going into a game engine or onto the web. It does not change
what a generation costs.

**Do more with a finished mesh.** Drag from the Tripo node's **Task** dot into a
**Tripo Refine** node to export a different file format (FBX for Blender, USDZ
for Apple AR, STL for printing), re-texture the same shape, or stylize it.

---

## If something goes wrong

| What you see | What it means |
| --- | --- |
| The 3D preview says it cannot show the file | Check whether **Quad topology** is ticked on the Tripo node. Quads cannot be stored in the format browsers display, so Tripo returns FBX instead. Untick it to preview; leave it on when you want the file for rigging |
| A node says `no result yet - press Run` | That node has not run. The small ▶ on a node runs it and everything feeding *into* it, but nothing after it. **Run** at the top runs the whole graph |
| `gateway off` | Close the Terminal window, double-click `start.command` again |
| `looks like a <service> key` | The key chosen on that node belongs to a different service. The message names which node to use instead |
| `401` on a node | That key is wrong, expired, or from another account — paste a fresh one |
| `402` on a node | That account is out of credit, or needs a payment method |
| `502`, `503` or `504` | The provider's own servers are having a moment. Nothing is wrong with your key or your image. Status checks retry themselves; if a generation failed to start, nothing was charged — just press Run again |
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
