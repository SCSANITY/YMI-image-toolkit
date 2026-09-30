# YMI Image Prompt Lab

An isolated local Electron window for repeated OpenAI Images Edit prompt tests.
It is a research tool, not a production Worker and not a batch orchestrator.

## Start on Windows

From the `image-toolkit-app` repository:

```powershell
.\prompt-lab\START_PROMPT_LAB.ps1
```

The launcher asks for `OPENAI_API_KEY` as a secure PowerShell value when the
current process does not already have it. The key is inherited only by the
Prompt Lab process tree, is never exposed to the renderer, and is removed from
the launcher session when the app exits.

Use **Validate / dry run** first. It validates the prompt, ordered images, mask
and API controls but sends no request. **Send one paid request** opens a native
confirmation showing model, size, quality, output count and the no-retry rule.

## Supported Images Edit controls

- 1–16 ordered PNG, JPEG or WebP inputs;
- optional alpha PNG mask applied to input 1;
- pinned and rolling GPT Image 2.5 Flare/Sunburst model IDs;
- `size`, including valid custom `WIDTHxHEIGHT` values and `auto`;
- `quality`, `output_format`, `background`, `n` and conditional
  `output_compression`;
- optional streaming plus `partial_images`;
- optional `input_fidelity` and `user`;
- local timeout (not an API field).

`response_format` is intentionally not sent because GPT Image models always
return base64 image data. The pinned Flare snapshot rejected `input_fidelity`
during YMI's live evaluation, so its default is **Do not send**; low/high remain
visible only for deliberate capability testing.

Official references:

- <https://developers.openai.com/api/reference/cli/resources/images/methods/edit>
- <https://developers.openai.com/api/reference/resources/images/edit-streaming-events>
- <https://developers.openai.com/api/docs/guides/image-generation>

## Safety and evidence

- maximum concurrency is one;
- the HTTP transport is invoked at most once per click;
- there is no SDK and no automatic retry;
- timeout or interrupted-body outcomes are recorded as unknown and are never
  resubmitted automatically;
- the fixed endpoint cannot be changed in the UI;
- each real request receives a new local folder containing sanitized request,
  response and evidence JSON plus output images;
- evidence contains filenames, hashes and dimensions, never the API key;
- source images are read in place and are not modified or copied into the run
  directory.

By default, runs are written to `Documents\YMI Prompt Lab Runs`; the operator
can choose another local folder before sending.

## Verification

```powershell
npm run prompt-lab:test
npm run prompt-lab:build
npm run prompt-lab:smoke
```

The contract suite preloads a network guard and uses only injected fake
responses. The smoke suite opens a real Electron window with the real preload,
checks key controls and error overlays, and saves a temporary screenshot. None
of these commands can send an OpenAI request.
