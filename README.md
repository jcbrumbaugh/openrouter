# Node Space

A node-based canvas that runs in the browser with no build step. You drop nodes
on a canvas, wire outputs into inputs, and hit Run to execute the graph. The
first provider wired up is **OpenRouter**, including a video node aimed at
**Seedance**.

![the canvas](docs/screenshot.png)

> **New to this?** [START-HERE.md](START-HERE.md) is the same setup written
> without jargon, for a Mac, step by step.

## Run it

Opening `index.html` by double-clicking will **not** work: browsers refuse to
load ES modules over `file://`, so the folder has to be served.

**On a Mac, double-click `start.command` in Finder.** It starts the page server
*and* the API gateway, then opens your browser. Close the Terminal window to
stop both. It reuses a gateway that is already running rather than starting a
second one, and if Node is missing it says how to install it.

The toolbar shows **gateway on / off** so you can see at a glance whether Tripo
and Runway will work.

From a terminal, either of these does the same thing:

```bash
npm run dev            # node scripts/serve.mjs --open
python3 -m http.server 8080    # then open http://localhost:8080
```

`start.command` uses python3 if it is there and falls back to node. macOS ships
neither by default; if it finds neither it tells you to run
`xcode-select --install` (one time, gives you python3) or install Node.

Any other static server works too (`npx serve`, `caddy file-server`, nginx).

### Hosting it on GitHub Pages

The app is plain static files with relative paths, so it works unchanged from a
project subpath. In the repository: **Settings → Pages → Source: Deploy from a
branch**, pick this branch and the `/ (root)` folder. The site lands at
`https://<user>.github.io/<repo>/` a minute or so later.

Your API key is not part of any of this. It lives in the `localStorage` of
whichever browser you typed it into, so visitors to a public deployment see an
empty Keys panel and must supply their own. Note that browser storage is scoped
to the *origin* (`https://<user>.github.io`), not the repo path, so every Pages
site under that account shares one storage area.

The `localhost` proxy fallback does not pair well with an HTTPS Pages origin:
Chrome permits requests to `http://localhost`, Safari blocks them. Run the app
locally if you need the proxy.

## Add your API key

1. Click **Keys** in the toolbar.
2. Paste an OpenRouter key, give it a label, save.
3. Hit **Test** next to the saved key. It calls OpenRouter's `/key` endpoint,
   which spends nothing, and reports either what the key is (label, usage,
   limit) or why it was rejected. `401 User not found` means the key is revoked
   or mistyped — the most common cause is pasting a key that was rotated after
   it was copied.
4. Pick that key in the *API key* dropdown on any OpenRouter node.

Keys are stored in **this browser's `localStorage`** and nowhere else. They are
deliberately left out of saved and exported graphs, so a `.json` you share
carries the wiring but not the secret.

> **Rotate any key you have pasted into a chat window, a screenshot, or a
> commit.** Treat it as public from that moment on:
> <https://openrouter.ai/settings/keys>

If you would rather the key never touch the browser, run the bundled proxy
instead (see [Keeping the key server-side](#keeping-the-key-server-side)).

## Using the canvas

| Action | How |
| --- | --- |
| Add a node | Click it in the left palette, or double-click empty canvas for a searchable menu |
| Connect | Drag from an output dot (right side) to an input dot (left side) |
| Disconnect | Drag off a connected input, or double-click the wire |
| Delete | Select a node or wire, press `Delete`; or use the `✕` on the node header |
| Move / zoom | Drag empty canvas to pan, scroll to zoom, **Fit** to frame everything |
| Run everything | **Run ▶** or `Ctrl`/`Cmd` + `Enter` |
| Run one branch | The `▶` on a node header — runs just that node and its upstream |
| Duplicate | Select a node and press `Cmd`/`Ctrl` + `D` |
| Force re-run | **Force** ignores cached results |

Results are cached per node against its inputs and settings, so re-running only
repeats the work that actually changed. Editing a field invalidates that node
and everything downstream of it.

Graphs autosave to `localStorage` on every change; **Export** / **Import** move
them between browsers.

## Nodes

**Input** — `Text` (prompts and any string), `Number`, `Image` (file upload kept
in memory as a data URL, or a pasted URL).

**Transform**
- `Template` — compose text from up to three inputs with `{{a}} {{b}} {{c}}`.
- `Extract` — read a path out of a JSON payload (`choices[0].message.content`),
  or auto-find the first video/image URL anywhere in it.
- `HTTP Request` — the generic plug for **any** REST API: method, URL, auth
  header, extra headers, and a JSON body template with `{{input}}` / `{{image}}`
  substituted from its ports.

**OpenRouter**
- `OpenRouter Models` — lists live model slugs, with a filter box. Use it to
  find the exact id to type into a model field.
- `OpenRouter Chat` — any text model; attach an image for vision models.
- `OpenRouter Image` — image-output models via `/chat/completions` with the
  image modality.
- `Video (Seedance)` — see below.

**3D** — `Tripo 3D` (hosted) and `Hunyuan3D 2.1` (self-hosted) turn an image
into a textured mesh. See below.

**Runway** — `Runway Video` drives image-to-video, including Seedance.

**Output** — `Preview` renders whatever it is handed: text, JSON, an image, a
playable video, or a 3D mesh you can orbit.

## The Seedance video node

Video generation is asynchronous and the exact endpoint and payload differ by
provider and change over time, so this node is **request-spec driven** rather
than hard-coded. It submits a job, then polls until a video URL appears.

Fields:

- **Model** — defaults to `bytedance/seedance-2.5`. Hit the `↻` button beside it
  to pull the live model list into the field's autocomplete; matching `seedance`
  slugs are printed in the Log. If the default slug 404s, the real one is in
  that list (or on <https://openrouter.ai/models>).
- **Call style**
  - *Generation endpoint (submit + poll)* — `POST /videos` with
    `{model, prompt, duration, resolution, aspect_ratio, image?}`, then polls
    `GET /videos/{id}` until it is done. This is the default.
  - *Chat completions* — `POST /chat/completions` with
    `modalities: ["video","text"]`, for models exposed through the chat surface.
  - *Custom body* — you write the JSON, with `{{prompt}}`, `{{image}}` and
    `{{duration}}` placeholders.
- **Seconds / Resolution / Aspect** — sent as `duration`, `resolution`,
  `aspect_ratio`.
- **Advanced** — submit path, poll path (`{id}` is substituted), poll interval,
  timeout, and Base URL.

Wire an `Image` node into **First frame** for image-to-video.

**If the response shape is not what the node expects**, it says so and still
emits the raw payload on its `JSON` port. Wire that into a `Preview` to see what
came back, then either adjust the paths under **Advanced** or pull the URL out
with an `Extract` node (`Find video URL` mode handles most shapes). The three
outputs are `Video` (plays in a Preview), `URL` (plain text), and `JSON` (the
whole payload).

## The pipeline this is built around

A still image becomes a mesh, and the mesh's rendered preview drives a video you
can use as animation reference:

```
Image -> Tripo 3D -> Model  -> Preview      (orbit the mesh, download .glb)
                  \-> Render -> Runway Video -> Preview   (with a Text prompt)
```

Tripo returns a `rendered_image` alongside the mesh, so the video step needs no
manual screenshot — the render port feeds Runway directly. That is the graph the
**Starter** button builds.

## Running the gateway (required for Tripo and Runway)

OpenRouter serves CORS headers, so the page calls it directly. **Tripo and
Runway do not** — Runway's own SDK refuses to run in a browser at all — so those
two go through the small gateway in `scripts/proxy.mjs`:

```bash
npm run proxy
```

```
http://localhost:8787/openrouter/... -> https://openrouter.ai/...
http://localhost:8787/tripo/...      -> https://api.tripo3d.ai/...
http://localhost:8787/runway/...     -> https://api.dev.runwayml.com/...
```

The Tripo and Runway nodes already default to those addresses. Keys still come
from your browser unless you put them in the environment instead
(`TRIPO_API_KEY`, `RUNWAYML_API_SECRET`, `OPENROUTER_API_KEY`), in which case the
gateway fills them in. It also adds Runway's required `X-Runway-Version` header.

Because the gateway is plain `http://localhost`, **run the app locally for these
two nodes**. Chrome tolerates an HTTPS page calling `http://localhost`; Safari
does not, so the GitHub Pages copy is OpenRouter-only in Safari.

## Tripo (hosted image to 3D)

### Multiple views

The node has four image inputs: **Front**, **Left**, **Back**, **Right**.
Connect Front alone and it runs `image_to_model`. Connect any of the others and
it switches to `multiview_to_model`, sending the views in that fixed order with
gaps preserved, which is how Tripo maps an image to a side. More views means
less guessing about the parts of the object the camera never saw. Turbo does not
accept multiple views; the node says so instead of failing at the API.


Get a key at [platform.tripo3d.ai](https://platform.tripo3d.ai), add it under
**Keys** with provider *Tripo*, and pick it on the node — provider-scoped
dropdowns mean a Runway key never shows up in a Tripo slot.

The node posts `image_to_model` to `/v2/openapi/task` and polls `/task/{id}`
until the status is `success`. A local upload is pushed through `/upload` first
and referenced by token; a public image URL is passed straight through. Model
versions run from `v2.5` up to `v3.1`, with Turbo for quick drafts. **Quad
topology** is worth turning on if you plan to rig the result.

Outputs: `Model` (the GLB), `Render` (Tripo's preview image), `Task` (the task
id), and the raw task JSON. Tripo's URLs are signed and expire, so download
anything worth keeping.

Meshes are pulled through the local gateway into the page rather than linked
directly: provider CDNs serve no CORS headers, so a viewer pointed at the remote
URL renders an empty box. If that download fails the node falls back to the
remote URL and says the preview will be download-only.

Each downloaded mesh is identified from its own bytes rather than trusted to be
what was asked for, because the format depends on the options: **glTF can only
store triangles, so turning on quad topology makes Tripo return FBX instead**.
The file is named from what actually arrived (`.glb`, `.fbx`, `.obj`, `.zip`,
`.usdc`…), the log reports it, and a format the browser cannot render says so
instead of failing in the viewer.

For a real glTF the log also reports its version and any extension needing a
decoder fetched at runtime (`KHR_draco_mesh_compression`,
`EXT_meshopt_compression`, `KHR_texture_basisu`); if the viewer then fails, the
preview names that decoder rather than implying the mesh is broken. A response
that is not a mesh at all — an expired-link JSON error, say — is reported as
such, with its leading bytes.

### Follow-up tasks

`Tripo Refine` takes the **Task** output of a Tripo 3D node and runs another
task against that same mesh:

- **Export another format** — GLTF/GLB, USDZ, FBX, OBJ, STL, 3MF, with optional
  quad topology, a face limit and texture size. Anything that is not glTF is
  download-only in the preview, which the node says rather than showing a blank.
- **Re-texture** — new materials on the same geometry, optionally steered by a
  text prompt, with its own seed.
- **Stylize** — lego, voxel, voronoi or minecraft.

### Polygon budget

The **Polygon budget** slider maps to Tripo's `face_limit`. At `auto` (zero) the
parameter is omitted entirely and Tripo decides; anything higher caps the face
count. It is a post-generation decimation setting, so it does not change what a
generation costs — only what you get back. Tripo's credit cost is driven by task
type and the texture options (turning texture off is cheaper, `detailed` texture
quality costs more).

### Iterating

Two ways to try variations:

- **Cmd+D** duplicates the selected node beside itself, with its settings but
  without its last result. Give each copy a different seed and hit Run to
  compare them side by side.
- **Seed 0** means random every run, so pressing **Force** re-rolls. A non-zero
  seed makes a run repeatable.

## Runway video (including Seedance)

Runway routes third-party models, so Seedance is reachable there:
`seedance2_5`, `seedance2`, `seedance2_fast`, `seedance2_mini`, alongside
`gen4.5`, `gen4_turbo`, `veo3.1`, `hailuo3` and `wan3`. The node defaults to
**Seedance 2.5**.

It posts to `/v1/image_to_video` and polls `/v1/tasks/{id}` through
`PENDING → RUNNING → SUCCEEDED`. Ratios are explicit pixel sizes
(`1280:720`), durations are 4, 6 or 8 seconds. The image must be a public URL or
a data URL — a mesh render from Tripo qualifies, a `blob:` URL that only exists
inside the page does not, and the node says so rather than failing obscurely.
Runway's output URLs expire too.

## Hunyuan3D 2.1 (self-hosted image to 3D)

[Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) is an
open-source model, not a hosted service, so this node talks to a server **you**
run. The repo ships a FastAPI app for exactly that:

```bash
python api_server.py --port 8081
```

Point the node's **Server URL** at it (`http://localhost:8081` by default) and
wire an `Image` node into its input. That server sets
`allow_origins=["*"]`, so the browser is allowed to call it directly — no proxy
needed. The node speaks its real contract: `POST /send` to queue a job, then
`GET /status/{uid}` until the status turns `completed`, which carries the mesh
back as base64. Switch **Call style** to `/generate` for a single blocking
request that returns the GLB directly.

**Hardware.** Their README quotes 10 GB VRAM for shape generation, 21 GB for
texture, and 29 GB for both, on CUDA. That means an NVIDIA GPU — a Mac cannot
run it locally, Apple Silicon included. Realistic options are a rented cloud GPU
(RunPod, Vast.ai, Lambda), a desktop with a large NVIDIA card, or a hosted
Hunyuan3D endpoint driven through the `HTTP Request` node. Leave **Generate PBR
texture** off to stay in the 10 GB lane.

**Reaching a remote server.** If the box is not the machine running the browser,
put its address in Server URL. One catch: a page served over HTTPS (GitHub
Pages) may not call a plain `http://` address — browsers treat that as mixed
content. `http://localhost` is exempt in Chrome, a remote IP is not. So for a
remote GPU box, either run this app locally over `http://`, or terminate TLS in
front of the Hunyuan3D server.

The mesh arrives as a `blob:` URL held in memory for the session: the Preview
node orbits it, and the download link saves a `.glb`. The inline viewer is the
app's only external dependency, `<model-viewer>`, fetched from a CDN the first
time a mesh appears and never before. If it cannot load, the download link is
still there — macOS previews `.glb` with Quick Look.

## When a provider has a bad day

Gateway errors (502/503/504) are the providers' own infrastructure, and they
are handled differently depending on whether repeating the request is safe:

- **Status checks retry** — up to four attempts with 2s/4s/8s backoff. A job
  already running on the provider's side survives a blip instead of being
  thrown away after two minutes of waiting, and the log says it is retrying.
- **Task creation does not retry.** Repeating a POST can mean two jobs and two
  charges, so the node stops and says nothing was generated or charged, and to
  press Run again.

Provider error pages are HTML; the headline is extracted so the node shows
`502 Bad Gateway (the provider's own server returned an error page)` rather
than a wall of markup.

## Plugging in your other APIs

Two options, in increasing order of effort:

1. **`HTTP Request` node** — no code. Set the URL, pick a key (stored the same
   way as the OpenRouter one), write a body template, and pull fields out of the
   response with `Extract`.
2. **A real node type** — add a definition in `src/nodes/`. A node is plain data
   plus an async `run()`:

```js
registry.register({
  type: 'my-api',
  title: 'My API',
  category: 'Custom',
  accent: '#7dd3a0',
  inputs: [{ id: 'prompt', label: 'Prompt', type: 'text', required: true }],
  outputs: [{ id: 'text', label: 'Text', type: 'text' }],
  fields: [
    { id: 'credential', kind: 'credential', label: 'API key' },
    { id: 'endpoint', kind: 'text', label: 'Endpoint' },
  ],
  defaults: { credential: '', endpoint: 'https://api.example.com/v1/run' },
  async run({ inputs, data, keystore, signal, log }) {
    const key = keystore.require(data.credential);
    const res = await fetch(data.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt: inputs.prompt }),
      signal,
    });
    const payload = await res.json();
    log('done');
    return { text: payload.output };
  },
});
```

Register it from `src/main.js` and it shows up in the palette. Field kinds
available to you: `text`, `textarea`, `number`, `select`, `checkbox`, `file`,
`credential`, `model`, `preview`, `info` — plus `advanced: true` to tuck a field
behind the Advanced toggle and `showWhen` / `hideWhen` for conditional fields.

## Keeping the key server-side

The browser calls OpenRouter directly. If the browser blocks that as
cross-origin, or you would rather the key lived in an env var than in
`localStorage`:

```bash
OPENROUTER_API_KEY=sk-or-v1-... npm run proxy
```

Then set **Base URL** (under Advanced on any OpenRouter node) to
`http://localhost:8787/api/v1`. The proxy forwards everything to
`https://openrouter.ai` and injects the key when the request has no
`Authorization` header of its own. Do not expose it on a public interface — it
is a development convenience with no auth of its own.

## Tests

```bash
npm install          # playwright, dev-only
npm test             # serves the app + mock APIs, drives it in Chromium
npm run test:launcher # start.command brings both services up and takes them down
node tests/screenshot.mjs   # refreshes docs/screenshot.png
```

The smoke test covers booting, palette insertion, drag-to-connect, port type
and cycle rejection, full submit-and-poll runs against mocks of OpenRouter,
Tripo, Runway and Hunyuan3D, the missing-key and revoked-key paths, secret-free
export, autosave restore, provider-scoped credential dropdowns and the gateway
indicator — 53 assertions, no network access required. The launcher test checks
that closing the window really does leave nothing running.

## Layout

```
index.html            shell: toolbar, palette, canvas, log
.nojekyll             tells GitHub Pages to serve the files as-is
start.command         double-click launcher for macOS
styles.css            all styling (dark, CSS custom properties)
src/core/             store (graph state), engine (topo run + cache), types
src/nodes/            registry + node definitions (core, openrouter, tripo, runway, hunyuan3d)
src/providers/        openrouter, tripo, runway clients + credential keystore
src/ui/               canvas/wires, node cards, palette, keys modal, log
src/util/             dom helpers, response extraction, media conversion
scripts/serve.mjs     local dev server
scripts/proxy.mjs     local gateway for Tripo/Runway (and optionally OpenRouter)
tests/                headless smoke test and screenshot tool
```

## Known limits

- One edge per input (fan-out from an output is unlimited).
- No subgraphs, loops or batching yet — the engine runs each node once per run.
- Streaming responses are not surfaced; chat calls resolve as a whole.
