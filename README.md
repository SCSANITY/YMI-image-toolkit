# YMI Image Toolkit

Standalone internal Windows desktop tool for batch image format conversion.
Same family as `subtitle-template-editor-app/` and `subtitle-json-combiner-app/`:
independently maintained, NOT wired into `worker/` or `ymi-books-web-1.0/`.

Primary job: turn web product originals (PNG / JPEG) into WebP, and back again.

---

## Run / build

```bash
cd "d:/IT_David/Program/Voice Imagination/Web/image-toolkit-app"

npm run dev        # Vite (port 5175) + Electron with devtools
npm run dist       # -> release/YMI Image Toolkit Setup 0.1.0.exe
npm run dist:dir   # -> release/win-unpacked/YMI Image Toolkit.exe (no installer)
npm run icon       # re-rasterise build/icon.svg -> icon.png + multi-size icon.ico
```

Close the running app before `npm run dist` — Windows keeps a lock on
`d3dcompiler_47.dll` in `release/win-unpacked` and the build fails otherwise.

---

## What it does

| | |
|---|---|
| Reads | PNG, JPEG, WebP, AVIF, TIFF |
| Writes | **WebP, PNG, JPEG** |
| Input | drag & drop files *or folders* (recursive, max depth 8), or the Add buttons |
| Batch | 3 conversions in flight, per-file result and size delta, cancellable |
| Selection | per-row checkbox + select-all; selected rows can be downloaded, removed, or narrow what Convert acts on |
| Resize | none / percentage (up- or downscale) / fit within a W x H box, Lanczos 3 |
| Alpha | preserved for WebP + PNG; flattened onto a chosen colour for JPEG |
| Metadata | EXIF stripped by default, ICC colour profile always kept |
| Output | destination is chosen *after* converting, optional filename suffix |

### Convert, then download when you want it

Converting writes into a temp staging folder and stops there — no dialog interrupts the
batch. Each converted row grows a **Download** button, and selected rows can be
downloaded together from the selection bar. One image gets a Save-As dialog (name
included), several get a single folder picker; never a dialog per file. The last chosen
folder becomes the next download's default.

Staged results are **copied**, not moved, so the same conversion can be downloaded more
than once (different folders, different names). Staging is cleared when the app quits,
and closing with undownloaded conversions raises a light confirm first — the renderer
keeps `set-unsaved-count` up to date so the main process knows when to ask. Removing a
row deletes its staged bytes immediately.

**Source files are never overwritten.** A multi-image download that would land on the
source path (e.g. PNG -> PNG back into its own folder) forces a `-converted` suffix; a
Save-As aimed straight at the source file is refused with a clear message. With "Replace
existing" off, collisions get a `-1`, `-2`, ... counter.

---

## Architecture

```
electron/imageOps.cjs   the whole image pipeline (plain Node + sharp, no Electron)
                        convertToStaging():  read -> resize -> flatten (only if the target
                                             has no alpha) -> encode -> write to temp
                        saveOutputs():       copy staged files to the chosen destination
electron/main.cjs       window + IPC handlers; every handler returns {ok:true,...} | {ok:false,error}
electron/preload.cjs    contextBridge surface -> window.imageToolkit
build/icon.svg          app icon source; build/make-icon.mjs rasterises it
src/App.jsx             file list state, selection, batch orchestration, drag & drop
src/components/         SettingsPanel, FileRow, SelectionBar, Checkbox, WindowControls
src/lib/                formatBytes / deltaPercent, runPool
```

Three rules that keep this clean as it grows:

1. **`imageOps.cjs` owns the settings contract.** `DEFAULT_SETTINGS` lives there and
   the renderer fetches it over the `get-defaults` IPC on boot. There is no second
   copy of the defaults in the UI to drift out of sync.
2. **The pipeline is one linear chain, not a branch pile.** New capabilities become
   one more step inside `convertToStaging` (and one more panel section), never a
   parallel code path.
3. **Staging is the reason nothing is written by surprise.** Encode and destination are
   separate phases, so "where does this go" is a user decision made once per batch
   rather than a default baked into the pipeline.

### Look

The window is **frameless** (`frame: false`) over a real Windows acrylic material
(`backgroundMaterial: 'acrylic'` with a transparent `backgroundColor`), so the app draws
its own title bar — brand, actions and the three window buttons live in `.topbar`, which
is the drag region (`-webkit-app-region: drag`, with `no-drag` on every button).

The page paints its own translucent tint over the acrylic so contrast never depends on
the wallpaper. Everything above that tint is glass — low-alpha white fill, hairline
border, 1px top highlight, backdrop blur — with iOS-style segmented controls, switches,
round checkboxes and sliders. If the acrylic ever has to go, raise the `--tint-*` alphas
in `styles.css` and the app still reads correctly.

`sharp` is a native module. It loads via Node-API so no `electron-rebuild` is needed,
but it MUST stay outside the asar — `build.asarUnpack` in `package.json` covers
`node_modules/sharp/**` and `node_modules/@img/**`. If a packaged build ever throws
"Could not load the sharp module", that config is the first place to look.

Renderer-side note: Electron 32+ removed `File.path`. Dropped files are resolved
through `webUtils.getPathForFile` in the preload — that is the only supported way.

---

## Verified behaviour

Two harnesses were used during the build (both throwaway, kept out of the repo):

* **Headless pipeline** (plain Node against `imageOps.cjs`) — 26 checks: folder
  recursion + non-image filtering, thumbnail/probe output, staging isolation (nothing
  reaches the destination before the download, and a discarded run leaves no trace),
  JPEG->WebP, alpha PNG->WebP (alpha kept), alpha PNG->JPEG (flattened onto the picked
  colour, verified by sampling a pixel), WebP->PNG, 50% / 200% scaling, fit-box with
  and without upscaling, both no-overwrite-source guards, Save-As honouring an exact
  filename, collision counter, downloading the same conversion twice, and lossless WebP
  proven by pixel-identical round trip.
* **Headless Electron** (hidden BrowserWindow on the built `dist/`) — 26 checks driving
  the real UI with native clicks: renderer mounts, preload bridge exposed, glass blur
  computed live, page transparent for the acrylic, the three frameless window buttons
  reach main, Add images populates rows with checkboxes, Convert stages all three
  *without* a dialog, per-row Download asks Save-As once, bulk Download asks a folder
  once, statuses and the unsaved counter track correctly, and removing rows deletes
  their staged files.

The Electron harness exists because of a known failure mode in this app family: a
build can succeed and still open to a blank window (a runtime error, usually a
temporal-dead-zone read of a `const` declared below an early hook). Checking
`#root.childElementCount > 0` catches it.

---

## Roadmap (deliberately not built yet)

**Quality / upscale-downscale** — already shipped: percentage and fit-box resizing
with Lanczos 3, plus per-format quality, WebP lossless and effort, PNG palette
quantisation. What is *not* there is AI super-resolution (Real-ESRGAN class). That
is a genuinely different feature — a bundled ONNX model, hundreds of MB, seconds per
image — and belongs with the background-removal work below, not with resampling.

**One-click background removal** — feasible and worth doing, but it is a model, not
a function: `onnxruntime-node` in the main process plus an RMBG-1.4 / ISNet class
model (~40-180 MB). It slots in as one more step in `convertFile` between resize and
flatten. Deferred for v1 because (a) the stated need is PNG/JPEG -> WebP, (b) it
roughly triples the installer size, and (c) the model licence is a call to make
before shipping it internally. Cheap non-AI alternatives (white-background flood
fill) were skipped on purpose — they look acceptable on flat product shots and bad
on everything else, which is exactly the kind of half-path this codebase avoids.

**Other candidates**, in rough order of value: AVIF output, animated WebP/GIF
(currently only the first frame is read — the row shows a "N frames - first only"
badge), crop / trim transparent borders, watermarking, side-by-side quality preview
with a live size estimate, conversion presets, and a CLI entry point (already
possible: `imageOps.cjs` has no Electron dependency).
