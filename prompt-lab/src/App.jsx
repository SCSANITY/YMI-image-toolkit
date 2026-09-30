import React, { useCallback, useEffect, useMemo, useState } from 'react'

const api = window.promptLab
const PRESETS_KEY = 'ymi-prompt-lab-presets-v1'
const SETTINGS_KEY = 'ymi-prompt-lab-settings-v1'

function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

function formatUsd(value) {
  return typeof value === 'number' ? `$${value.toFixed(6)}` : 'not reported'
}

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return value ?? fallback
  } catch {
    return fallback
  }
}

function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

function Pill({ tone = 'neutral', children }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

function App() {
  const [boot, setBoot] = useState(null)
  const [settings, setSettings] = useState(null)
  const [experimentName, setExperimentName] = useState('cover-prompt-test')
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState([])
  const [mask, setMask] = useState(null)
  const [outputRoot, setOutputRoot] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dryRun, setDryRun] = useState(null)
  const [result, setResult] = useState(null)
  const [presets, setPresets] = useState(() => loadJson(PRESETS_KEY, []))

  useEffect(() => {
    if (!api) return
    api.boot().then((value) => {
      setBoot(value)
      const stored = loadJson(SETTINGS_KEY, null)
      setSettings({ ...value.capabilities.defaults, ...(stored || {}) })
      setOutputRoot(value.defaultOutputRoot)
    })
  }, [])

  useEffect(() => {
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const update = useCallback((field, value) => {
    setSettings((current) => ({ ...current, [field]: value }))
    setDryRun(null)
  }, [])

  const request = useMemo(() => ({
    experimentName,
    prompt,
    settings,
    imagePaths: images.map((image) => image.path),
    maskPath: mask?.path || null,
    outputRoot,
  }), [experimentName, prompt, settings, images, mask, outputRoot])

  const inspectPaths = useCallback(async (paths) => {
    if (!paths?.length) return
    const remaining = Math.max(0, 16 - images.length)
    const selected = paths.slice(0, remaining)
    const next = []
    for (const filePath of selected) {
      if (images.some((item) => item.path.toLowerCase() === filePath.toLowerCase())) continue
      const inspected = await api.inspectImage(filePath)
      if (!inspected.ok) {
        setNotice({ tone: 'error', text: inspected.error.message })
        continue
      }
      next.push(inspected.image)
    }
    if (next.length) {
      setImages((current) => [...current, ...next])
      setDryRun(null)
      setResult(null)
      setNotice(null)
    }
    if (paths.length > remaining) setNotice({ tone: 'warning', text: 'The Images Edit API accepts at most 16 inputs.' })
  }, [images])

  const addImages = useCallback(async () => inspectPaths(await api.pickImages()), [inspectPaths])

  const chooseMask = useCallback(async () => {
    const filePath = await api.pickMask()
    if (!filePath) return
    const inspected = await api.inspectImage(filePath, { isMask: true })
    if (!inspected.ok) {
      setNotice({ tone: 'error', text: inspected.error.message })
      return
    }
    setMask(inspected.image)
    setDryRun(null)
  }, [])

  const moveImage = useCallback((index, offset) => {
    setImages((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDryRun(null)
  }, [])

  const validate = useCallback(async () => {
    if (!settings) return null
    setBusy(true)
    setNotice(null)
    try {
      const response = await api.validate(request)
      if (!response.ok) {
        setDryRun(null)
        setNotice({ tone: 'error', text: response.error.message })
        return null
      }
      setDryRun(response.request)
      setNotice({ tone: 'success', text: 'Dry run passed. No API request was sent.' })
      return response.request
    } finally {
      setBusy(false)
    }
  }, [request, settings])

  const execute = useCallback(async () => {
    setBusy(true)
    setNotice(null)
    setResult(null)
    try {
      const response = await api.execute(request)
      if (response.cancelled) {
        setNotice({ tone: 'neutral', text: 'Request cancelled before sending.' })
        return
      }
      if (!response.ok) {
        const suffix = response.error.runDirectory ? ` Evidence: ${response.error.runDirectory}` : ''
        setNotice({
          tone: response.error.disposition === 'outcome_unknown' ? 'warning' : 'error',
          text: `${response.error.message}${suffix}`,
        })
        return
      }
      setResult(response.result)
      setDryRun(response.result.request)
      setNotice({ tone: 'success', text: 'One request completed. Outputs and evidence were saved locally.' })
    } finally {
      setBusy(false)
    }
  }, [request])

  const savePreset = useCallback(() => {
    if (!prompt.trim()) {
      setNotice({ tone: 'warning', text: 'Enter a prompt before saving a preset.' })
      return
    }
    const preset = {
      id: crypto.randomUUID(),
      name: experimentName.trim() || `Prompt ${presets.length + 1}`,
      prompt,
      settings,
      savedAt: new Date().toISOString(),
    }
    const next = [preset, ...presets].slice(0, 30)
    setPresets(next)
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
    setNotice({ tone: 'success', text: 'Prompt preset saved locally in this app.' })
  }, [experimentName, presets, prompt, settings])

  const deletePreset = useCallback((id) => {
    const next = presets.filter((preset) => preset.id !== id)
    setPresets(next)
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
  }, [presets])

  const importConfig = useCallback(async () => {
    try {
      const config = await api.importConfig()
      if (!config) return
      setExperimentName(config.experimentName || 'imported-experiment')
      setPrompt(config.prompt)
      setSettings((current) => ({ ...current, ...config.settings }))
      setDryRun(null)
      setNotice({ tone: 'success', text: 'Experiment settings imported. Images are intentionally not imported.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    }
  }, [])

  const exportConfig = useCallback(async () => {
    try {
      const target = await api.exportConfig({ experimentName, prompt, settings })
      if (target) setNotice({ tone: 'success', text: `Experiment exported to ${target}` })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    }
  }, [experimentName, prompt, settings])

  const dropImages = useCallback((event) => {
    event.preventDefault()
    const paths = Array.from(event.dataTransfer.files).map((file) => api.pathForFile(file)).filter(Boolean)
    inspectPaths(paths)
  }, [inspectPaths])

  if (!api) {
    return <div className="boot"><h1>YMI Image Prompt Lab</h1><p>Launch this page through Electron, not a standalone browser.</p></div>
  }
  if (!boot || !settings) return <div className="boot"><p>Starting Prompt Lab…</p></div>

  const model = boot.capabilities.models.find((item) => item.id === settings.model)
  const compressionEnabled = settings.output_format === 'jpeg' || settings.output_format === 'webp'
  const promptCharacters = prompt.length

  return (
    <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={dropImages}>
      <header className="app-header">
        <div>
          <div className="eyebrow">YMI local research tool</div>
          <h1>Image Prompt Lab</h1>
          <p>One deliberate Images Edit request at a time. No automatic retry.</p>
        </div>
        <div className="status-stack">
          <Pill tone={boot.apiKeyLoaded ? 'success' : 'warning'}>{boot.apiKeyLoaded ? 'API key loaded' : 'API key missing'}</Pill>
          <Pill>Local outputs only</Pill>
        </div>
      </header>

      {notice ? <div className={`notice ${notice.tone}`}>{notice.text}</div> : null}

      <main className="workspace">
        <section className="column primary-column">
          <div className="panel">
            <div className="panel-title-row">
              <div><span className="step">01</span><h2>Experiment</h2></div>
              <div className="row-actions">
                <button type="button" className="quiet" onClick={importConfig} disabled={busy}>Import</button>
                <button type="button" className="quiet" onClick={exportConfig} disabled={busy}>Export</button>
              </div>
            </div>
            <Field label="Experiment name" hint="Used only for local folders and prompt history.">
              <input value={experimentName} onChange={(event) => setExperimentName(event.target.value)} maxLength={120} />
            </Field>
            <Field label="Prompt" hint="The first input should be the illustration; later inputs are identity references in the order your prompt describes.">
              <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setDryRun(null) }} rows={12} maxLength={boot.capabilities.limits.maxPromptChars} placeholder="Describe exactly which identity to apply, what must remain unchanged, and how multiple people map to references…" />
              <span className={`counter ${promptCharacters > 30_000 ? 'warning-text' : ''}`}>{promptCharacters.toLocaleString()} / {boot.capabilities.limits.maxPromptChars.toLocaleString()}</span>
            </Field>
            <div className="prompt-actions">
              <button type="button" className="secondary" onClick={savePreset} disabled={busy}>Save prompt preset</button>
            </div>
            {presets.length ? (
              <div className="preset-list">
                {presets.slice(0, 6).map((preset) => (
                  <div className="preset" key={preset.id}>
                    <button type="button" className="preset-load" onClick={() => { setExperimentName(preset.name); setPrompt(preset.prompt); setSettings((current) => ({ ...current, ...preset.settings })); setDryRun(null) }}>
                      <strong>{preset.name}</strong><span>{new Date(preset.savedAt).toLocaleString()}</span>
                    </button>
                    <button type="button" className="icon-button" aria-label={`Delete ${preset.name}`} onClick={() => deletePreset(preset.id)}>×</button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-title-row">
              <div><span className="step">02</span><h2>Ordered image inputs</h2></div>
              <button type="button" className="secondary" onClick={addImages} disabled={busy || images.length >= 16}>Add images</button>
            </div>
            <p className="section-copy">Up to 16 PNG, JPEG, or WebP files. The optional mask always applies to input 1.</p>
            {images.length ? (
              <ol className="input-list">
                {images.map((image, index) => (
                  <li key={image.path} className="input-card">
                    <img src={image.previewUrl} alt="" />
                    <div className="input-details">
                      <strong>{index === 0 ? 'Illustration / first input' : `Reference ${index}`}</strong>
                      <span title={image.path}>{image.name}</span>
                      <small>{image.width}×{image.height} · {image.format.toUpperCase()} · {formatBytes(image.byte_count)}</small>
                      <code>{image.sha256.slice(0, 16)}…</code>
                    </div>
                    <div className="reorder">
                      <button type="button" aria-label="Move up" disabled={busy || index === 0} onClick={() => moveImage(index, -1)}>↑</button>
                      <button type="button" aria-label="Move down" disabled={busy || index === images.length - 1} onClick={() => moveImage(index, 1)}>↓</button>
                      <button type="button" aria-label="Remove" disabled={busy} onClick={() => { setImages((current) => current.filter((_, itemIndex) => itemIndex !== index)); setDryRun(null) }}>×</button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <button type="button" className="drop-zone" onClick={addImages} disabled={busy}>
                <strong>Drop images here or choose files</strong>
                <span>No upload happens until you explicitly send a request.</span>
              </button>
            )}

            <div className="mask-row">
              <div>
                <strong>Optional mask</strong>
                <span>{mask ? `${mask.name} · ${mask.width}×${mask.height}` : 'PNG with alpha, under 4 MB, same dimensions as input 1'}</span>
              </div>
              <div className="row-actions">
                {mask ? <button type="button" className="quiet" onClick={() => { setMask(null); setDryRun(null) }} disabled={busy}>Remove</button> : null}
                <button type="button" className="secondary" onClick={chooseMask} disabled={busy}>{mask ? 'Replace mask' : 'Choose mask'}</button>
              </div>
            </div>
          </div>
        </section>

        <aside className="column settings-column">
          <div className="panel sticky-panel">
            <div className="panel-title-row"><div><span className="step">03</span><h2>Request controls</h2></div></div>
            <Field label="Model">
              <select value={settings.model} onChange={(event) => update('model', event.target.value)}>
                {boot.capabilities.models.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
              </select>
            </Field>
            {!model?.pinned ? <div className="inline-warning">Rolling aliases can change behavior. Use a dated snapshot for reproducible comparisons.</div> : null}

            <div className="field-grid">
              <Field label="Size" hint="Use auto or WIDTHxHEIGHT; both edges must be divisible by 16.">
                <input value={settings.size} onChange={(event) => update('size', event.target.value)} list="size-options" />
                <datalist id="size-options"><option value="1024x1024" /><option value="2048x2048" /><option value="1536x1024" /><option value="1024x1536" /><option value="auto" /></datalist>
              </Field>
              <Field label="Quality">
                <select value={settings.quality} onChange={(event) => update('quality', event.target.value)}>
                  {boot.capabilities.qualities.map((value) => <option value={value} key={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="Output format">
                <select value={settings.output_format} onChange={(event) => update('output_format', event.target.value)}>
                  {boot.capabilities.outputFormats.map((value) => <option value={value} key={value}>{value.toUpperCase()}</option>)}
                </select>
              </Field>
              <Field label="Background">
                <select value={settings.background} onChange={(event) => update('background', event.target.value)}>
                  {boot.capabilities.backgrounds.map((value) => <option value={value} key={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="Number of outputs" hint="1–10; cost usually scales with output count.">
                <input type="number" min="1" max="10" value={settings.n} onChange={(event) => update('n', Number(event.target.value))} />
              </Field>
              <Field label="Compression" hint={compressionEnabled ? '0–100 for JPEG/WebP.' : 'PNG ignores output_compression.'}>
                <input type="number" min="0" max="100" value={settings.output_compression} disabled={!compressionEnabled} onChange={(event) => update('output_compression', Number(event.target.value))} />
              </Field>
            </div>

            <button type="button" className="advanced-toggle" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>
              <span>Advanced controls</span><span>{advanced ? '−' : '+'}</span>
            </button>
            {advanced ? (
              <div className="advanced-panel">
                <label className="switch-row">
                  <span><strong>Stream response</strong><small>Receives SSE partial/final events.</small></span>
                  <input type="checkbox" checked={settings.stream} onChange={(event) => update('stream', event.target.checked)} />
                </label>
                <Field label="Partial images" hint="0–3; each partial adds 100 output tokens." className={!settings.stream ? 'disabled-field' : ''}>
                  <input type="number" min="0" max="3" value={settings.partial_images} disabled={!settings.stream} onChange={(event) => update('partial_images', Number(event.target.value))} />
                </Field>
                <Field label="Input fidelity" hint={boot.capabilities.notes.inputFidelity}>
                  <select value={settings.input_fidelity} onChange={(event) => update('input_fidelity', event.target.value)}>
                    <option value="omit">Do not send (recommended)</option>
                    <option value="low">low</option>
                    <option value="high">high</option>
                  </select>
                </Field>
                {settings.input_fidelity !== 'omit' ? <div className="inline-warning">The dated Flare snapshot rejected this parameter in YMI's live evaluation. This option is exposed only for intentional capability testing.</div> : null}
                <Field label="End-user ID" hint="Optional abuse-monitoring identifier sent as user.">
                  <input value={settings.user} onChange={(event) => update('user', event.target.value)} maxLength={256} placeholder="optional" />
                </Field>
                <Field label="Local timeout (ms)" hint="10,000–600,000. Timeout stops locally and never triggers a retry.">
                  <input type="number" min="10000" max="600000" step="1000" value={settings.timeout_ms} onChange={(event) => update('timeout_ms', Number(event.target.value))} />
                </Field>
                <div className="fixed-contract"><strong>response_format</strong><span>Not sent. GPT Image always returns base64 image data.</span></div>
              </div>
            ) : null}

            <Field label="Run output folder" hint="Each request receives a new immutable local evidence folder.">
              <div className="path-picker">
                <input value={outputRoot} readOnly title={outputRoot} />
                <button type="button" className="secondary" onClick={async () => { const selected = await api.pickOutputRoot(outputRoot); if (selected) setOutputRoot(selected) }} disabled={busy}>Choose</button>
              </div>
            </Field>

            <div className="action-stack">
              <button type="button" className="secondary full" onClick={validate} disabled={busy}>Validate / dry run</button>
              <button type="button" className="primary full" onClick={execute} disabled={busy || !boot.apiKeyLoaded}>
                {busy ? 'Working…' : 'Send one paid request'}
              </button>
              {!boot.apiKeyLoaded ? <small className="center-note">Start with <code>START_PROMPT_LAB.ps1</code> to load the key securely.</small> : null}
            </div>
          </div>
        </aside>
      </main>

      {dryRun ? (
        <section className="panel evidence-panel">
          <div className="panel-title-row"><div><span className="step">04</span><h2>Validated request</h2></div><Pill tone="success">0 requests sent by dry run</Pill></div>
          <div className="metrics">
            <div><span>Model</span><strong>{dryRun.parameters.model}</strong></div>
            <div><span>Size</span><strong>{dryRun.parameters.size}</strong></div>
            <div><span>Inputs</span><strong>{dryRun.ordered_inputs.length}</strong></div>
            <div><span>Outputs</span><strong>{dryRun.parameters.n}</strong></div>
            <div><span>Retry</span><strong>Off</strong></div>
            <div><span>Prompt hash</span><strong title={dryRun.prompt_sha256}>{dryRun.prompt_sha256.slice(0, 12)}…</strong></div>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="panel result-panel">
          <div className="panel-title-row">
            <div><span className="step">05</span><h2>Latest result</h2></div>
            <button type="button" className="secondary" onClick={() => api.openPath(result.runDirectory)}>Open run folder</button>
          </div>
          <div className="metrics">
            <div><span>Request ID</span><strong>{result.evidence.provider_request_id || 'not reported'}</strong></div>
            <div><span>Provider time</span><strong>{(result.evidence.provider_timing_ms / 1000).toFixed(2)} s</strong></div>
            <div><span>Calculated charge</span><strong>{formatUsd(result.evidence.calculated_charge_usd)}</strong></div>
            <div><span>Transport calls</span><strong>{result.evidence.transport_calls}</strong></div>
          </div>
          <div className="output-grid">
            {result.outputs.map((output) => (
              <figure key={output.file}>
                <img src={output.previewUrl} alt={`Generated output ${output.file}`} />
                <figcaption><strong>{output.file}</strong><span>{output.width}×{output.height} · {formatBytes(output.byte_count)}</span><code>{output.sha256.slice(0, 16)}…</code></figcaption>
              </figure>
            ))}
          </div>
          {result.partialOutputs.length ? <p className="section-copy">{result.partialOutputs.length} streamed partial image(s) were also saved in the run folder.</p> : null}
        </section>
      ) : null}

      <footer>
        <span>Direct endpoint: <code>{boot.capabilities.endpoint}</code></span>
        <a href="https://developers.openai.com/api/reference/cli/resources/images/methods/edit" target="_blank" rel="noreferrer">Official Images Edit reference</a>
      </footer>
    </div>
  )
}

export default App
