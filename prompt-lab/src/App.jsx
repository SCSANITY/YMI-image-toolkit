import React, { useCallback, useEffect, useMemo, useState } from 'react'

const api = window.promptLab
const PRESETS_KEY = 'ymi-prompt-lab-presets-v1'
const SETTINGS_KEY = 'ymi-prompt-lab-settings-v1'
const SIZE_PRESETS = ['1024x1024', '2048x2048', '1536x1024', '1024x1536', 'auto']

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
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

function Field({ label, hint, children, className = '' }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint ? <span className="field-hint">{hint}</span> : null}</label>
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
  const [selectedOutputIndex, setSelectedOutputIndex] = useState(0)
  const [presets, setPresets] = useState(() => loadJson(PRESETS_KEY, []))
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)

  useEffect(() => {
    if (!api) return
    api.boot().then((value) => {
      setBoot(value)
      setSettings({ ...value.capabilities.defaults, ...(loadJson(SETTINGS_KEY, null) || {}) })
      setOutputRoot(value.defaultOutputRoot)
    })
  }, [])

  useEffect(() => { if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) }, [settings])

  const update = useCallback((field, value) => {
    setSettings((current) => ({ ...current, [field]: value }))
    setDryRun(null)
  }, [])

  const request = useMemo(() => ({
    experimentName, prompt, settings,
    imagePaths: images.map((image) => image.path),
    maskPath: mask?.path || null,
    outputRoot,
  }), [experimentName, prompt, settings, images, mask, outputRoot])

  const inspectPaths = useCallback(async (paths) => {
    if (!paths?.length) return
    const remaining = Math.max(0, 16 - images.length)
    const next = []
    for (const filePath of paths.slice(0, remaining)) {
      if (images.some((item) => item.path.toLowerCase() === filePath.toLowerCase())) continue
      const inspected = await api.inspectImage(filePath)
      if (!inspected.ok) setNotice({ tone: 'error', text: inspected.error.message })
      else next.push(inspected.image)
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
    if (!inspected.ok) return setNotice({ tone: 'error', text: inspected.error.message })
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
    setBusy(true); setNotice(null)
    try {
      const response = await api.validate(request)
      if (!response.ok) {
        setDryRun(null); setNotice({ tone: 'error', text: response.error.message }); return null
      }
      setDryRun(response.request)
      setNotice({ tone: 'success', text: 'Dry run passed. No API request was sent.' })
      return response.request
    } finally { setBusy(false) }
  }, [request, settings])

  const execute = useCallback(async () => {
    setBusy(true); setNotice(null)
    try {
      const response = await api.execute(request)
      if (response.cancelled) return setNotice({ tone: 'neutral', text: 'Request cancelled before sending.' })
      if (!response.ok) {
        const evidenceNote = response.error.runId && response.error.evidenceSaved
          ? ` Internal safety evidence was saved for run ${response.error.runId}.`
          : response.error.runId ? ` Run ${response.error.runId} was assigned, but internal evidence could not be verified.` : ''
        const requestNote = response.error.providerRequestId ? ` Provider request ID: ${response.error.providerRequestId}.` : ''
        return setNotice({ tone: ['outcome_unknown', 'result_received'].includes(response.error.disposition) ? 'warning' : 'error', text: `${response.error.message}${evidenceNote}${requestNote}` })
      }
      setResult(response.result); setSelectedOutputIndex(0); setDryRun(response.result.request)
      const missing = response.result.outputs.filter((output) => !output.previewUrl).length
      if (!response.result.localArtifactsAvailable) setNotice({ tone: 'warning', text: 'The request completed, but its local image files could not be verified. Do not resend automatically.' })
      else if (missing) setNotice({ tone: 'warning', text: `One request completed and its images were saved. ${missing} preview(s) could not be displayed; use Open image folder.` })
      else setNotice({ tone: 'success', text: 'One request completed. Your image folder contains images only.' })
    } finally { setBusy(false) }
  }, [request])

  const savePreset = useCallback(() => {
    if (!prompt.trim()) return setNotice({ tone: 'warning', text: 'Enter a prompt before saving a preset.' })
    const preset = { id: crypto.randomUUID(), name: experimentName.trim() || `Prompt ${presets.length + 1}`, prompt, settings, savedAt: new Date().toISOString() }
    const next = [preset, ...presets].slice(0, 30)
    setPresets(next); localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
    setNotice({ tone: 'success', text: 'Prompt preset saved locally in this app.' })
  }, [experimentName, presets, prompt, settings])

  const deletePreset = useCallback((id) => {
    const next = presets.filter((preset) => preset.id !== id)
    setPresets(next); localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
  }, [presets])

  const importConfig = useCallback(async () => {
    try {
      const config = await api.importConfig()
      if (!config) return
      setExperimentName(config.experimentName || 'imported-experiment'); setPrompt(config.prompt)
      setSettings((current) => ({ ...current, ...config.settings })); setDryRun(null)
      setNotice({ tone: 'success', text: 'Experiment settings imported. Images are intentionally not imported.' })
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }, [])

  const exportConfig = useCallback(async () => {
    try {
      const target = await api.exportConfig({ experimentName, prompt, settings })
      if (target) setNotice({ tone: 'success', text: `Experiment exported to ${target}` })
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }, [experimentName, prompt, settings])

  const applyApiKeyStatus = useCallback((status) => setBoot((current) => current ? ({ ...current, apiKeyLoaded: Boolean(status?.configured && status?.readable), apiKeyStatus: status }) : current), [])

  const saveApiKey = useCallback(async () => {
    setKeyBusy(true); setNotice(null)
    try {
      const status = await api.saveApiKey(keyDraft)
      setKeyDraft(''); applyApiKeyStatus(status)
      setNotice({ tone: 'success', text: 'API key saved with Windows account encryption. It will be reused next time.' })
    } catch (error) { setNotice({ tone: 'error', text: error?.message || 'The API key could not be saved.' }) }
    finally { setKeyBusy(false) }
  }, [applyApiKeyStatus, keyDraft])

  const removeApiKey = useCallback(async () => {
    setKeyBusy(true); setNotice(null)
    try {
      const response = await api.removeApiKey(); applyApiKeyStatus(response.status)
      if (response.removed) { setKeyDraft(''); setNotice({ tone: 'success', text: 'The saved API key was removed from this Windows account.' }) }
    } catch (error) { setNotice({ tone: 'error', text: error?.message || 'The saved API key could not be removed.' }) }
    finally { setKeyBusy(false) }
  }, [applyApiKeyStatus])

  const dropImages = useCallback((event) => {
    event.preventDefault()
    inspectPaths(Array.from(event.dataTransfer.files).map((file) => api.pathForFile(file)).filter(Boolean))
  }, [inspectPaths])

  if (!api) return <div className="boot"><h1>YMI Image Prompt Lab</h1><p>Launch this page through Electron, not a standalone browser.</p></div>
  if (!boot || !settings) return <div className="boot"><p>Starting Prompt Lab…</p></div>

  const model = boot.capabilities.models.find((item) => item.id === settings.model)
  const compressionEnabled = settings.output_format === 'jpeg' || settings.output_format === 'webp'
  const selectedOutput = result?.outputs?.[selectedOutputIndex] || result?.outputs?.[0] || null

  return (
    <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={dropImages}>
      <header className="app-header">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true">Y</div><div><div className="eyebrow">YMI creative workspace</div><h1>Image Prompt Lab</h1></div></div>
        <div className="status-stack"><Pill tone={boot.apiKeyLoaded ? 'success' : 'warning'}>{boot.apiKeyLoaded ? 'API key ready' : 'API key missing'}</Pill><Pill>One request at a time</Pill><Pill tone="image">Images-only output</Pill></div>
      </header>

      {notice ? <div className={`notice ${notice.tone}`} role="status">{notice.text}</div> : null}

      <main className="creative-workspace">
        <aside className="asset-sidebar workspace-surface" aria-label="Source assets">
          <div className="section-heading"><div><span className="section-kicker">Inputs</span><h2>Source images</h2></div><button type="button" className="small-action" onClick={addImages} disabled={busy || images.length >= 16}>+ Add</button></div>
          <p className="section-copy">Input 1 is the illustration. Add identity references in the order described by your prompt.</p>
          {images.length ? <ol className="input-list">{images.map((image, index) => (
            <li key={image.path} className="input-card"><div className="input-index">{index + 1}</div><img src={image.previewUrl} alt="" /><div className="input-details"><strong>{index === 0 ? 'Illustration' : `Reference ${index}`}</strong><span title={image.path}>{image.name}</span><small>{image.width}×{image.height} · {image.format.toUpperCase()}</small></div><div className="reorder"><button type="button" aria-label="Move up" disabled={busy || index === 0} onClick={() => moveImage(index, -1)}>↑</button><button type="button" aria-label="Move down" disabled={busy || index === images.length - 1} onClick={() => moveImage(index, 1)}>↓</button><button type="button" aria-label="Remove" disabled={busy} onClick={() => { setImages((current) => current.filter((_, itemIndex) => itemIndex !== index)); setDryRun(null) }}>×</button></div></li>
          ))}</ol> : <button type="button" className="drop-zone" onClick={addImages} disabled={busy}><span className="drop-icon" aria-hidden="true">＋</span><strong>Drop images here</strong><span>or choose PNG, JPEG, or WebP</span></button>}

          <div className="mask-block"><div><strong>Optional mask</strong><span>{mask ? `${mask.name} · ${mask.width}×${mask.height}` : 'PNG with alpha, applied to input 1'}</span></div><div className="row-actions">{mask ? <button type="button" className="text-button" onClick={() => { setMask(null); setDryRun(null) }} disabled={busy}>Remove</button> : null}<button type="button" className="small-action" onClick={chooseMask} disabled={busy}>{mask ? 'Replace' : 'Choose'}</button></div></div>
          <div className="sidebar-divider" />
          <div className="section-heading compact"><div><span className="section-kicker">Library</span><h2>Prompt presets</h2></div></div>
          {presets.length ? <div className="preset-list">{presets.slice(0, 8).map((preset) => <div className="preset" key={preset.id}><button type="button" className="preset-load" onClick={() => { setExperimentName(preset.name); setPrompt(preset.prompt); setSettings((current) => ({ ...current, ...preset.settings })); setDryRun(null) }}><strong>{preset.name}</strong><span>{new Date(preset.savedAt).toLocaleDateString()}</span></button><button type="button" className="icon-button" aria-label={`Delete ${preset.name}`} onClick={() => deletePreset(preset.id)}>×</button></div>)}</div> : <p className="empty-copy">Saved prompts will appear here.</p>}
        </aside>

        <section className="studio-column" aria-label="Image generation workspace">
          <div className="canvas-surface workspace-surface">
            <div className="canvas-toolbar"><div><span className="section-kicker">Result canvas</span><h2>{selectedOutput ? selectedOutput.file : 'Ready when you are'}</h2></div>{result ? <button type="button" className="small-action" onClick={() => api.openRunFolder(result.runId)}>Open image folder</button> : null}</div>
            <div className={`result-canvas ${selectedOutput?.previewUrl ? 'has-image' : ''}`}>
              {busy ? <div className="canvas-empty busy-state"><span className="spinner" /><strong>Creating your image…</strong><p>One provider request. No automatic retry.</p></div>
                : selectedOutput?.previewUrl ? <img src={selectedOutput.previewUrl} alt={`Generated output ${selectedOutput.file}`} />
                  : selectedOutput ? <div className="canvas-empty"><span className="empty-symbol">!</span><strong>Preview unavailable</strong><p>The image may still be available in the image folder.</p></div>
                    : <div className="canvas-empty"><span className="empty-symbol">✦</span><strong>Your generated image will appear here</strong><p>Add source images, write a prompt, then validate or generate.</p></div>}
            </div>
            {result?.outputs?.length > 1 ? <div className="output-filmstrip" aria-label="Generated outputs">{result.outputs.map((output, index) => <button type="button" key={output.file} className={index === selectedOutputIndex ? 'selected' : ''} onClick={() => setSelectedOutputIndex(index)}>{output.previewUrl ? <img src={output.previewUrl} alt="" /> : <span>!</span>}<small>{index + 1}</small></button>)}</div> : null}
            {result ? <details className="run-details"><summary>Run details</summary><div className="detail-grid"><div><span>Provider time</span><strong>{(result.evidence.provider_timing_ms / 1000).toFixed(2)} s</strong></div><div><span>Calculated charge</span><strong>{formatUsd(result.evidence.calculated_charge_usd)}</strong></div><div><span>Request ID</span><strong>{result.evidence.provider_request_id || 'not reported'}</strong></div><div><span>Transport calls</span><strong>{result.evidence.transport_calls}</strong></div>{selectedOutput ? <div><span>Image</span><strong>{selectedOutput.width}×{selectedOutput.height} · {formatBytes(selectedOutput.byte_count)}</strong></div> : null}</div></details> : null}
          </div>

          <div className="prompt-composer workspace-surface">
            <div className="composer-topline"><Field label="Experiment name"><input value={experimentName} onChange={(event) => setExperimentName(event.target.value)} maxLength={120} /></Field><div className="composer-utility"><button type="button" className="text-button" onClick={importConfig} disabled={busy}>Import</button><button type="button" className="text-button" onClick={exportConfig} disabled={busy}>Export</button><button type="button" className="text-button" onClick={savePreset} disabled={busy}>Save preset</button></div></div>
            <label className="prompt-field"><span className="sr-only">Prompt</span><textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setDryRun(null) }} rows={7} maxLength={boot.capabilities.limits.maxPromptChars} placeholder="Describe the identity change, who maps to each reference, and everything that must remain unchanged…" /></label>
            <div className="composer-footer"><div className="composer-status"><span>{prompt.length.toLocaleString()} / {boot.capabilities.limits.maxPromptChars.toLocaleString()}</span>{dryRun ? <Pill tone="success">Validated · 0 requests sent</Pill> : <span>Validate before sending</span>}</div><div className="composer-actions"><button type="button" className="secondary" onClick={validate} disabled={busy}>Validate / dry run</button><button type="button" className="primary" onClick={execute} disabled={busy || !boot.apiKeyLoaded}>{busy ? 'Creating…' : 'Send one paid request'}</button></div></div>
          </div>
        </section>

        <aside className="control-sidebar workspace-surface" aria-label="Generation settings">
          <div className="section-heading"><div><span className="section-kicker">Controls</span><h2>Generation settings</h2></div></div>
          <Field label="Model"><select value={settings.model} onChange={(event) => update('model', event.target.value)}>{boot.capabilities.models.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></Field>
          {!model?.pinned ? <div className="inline-warning">Use a dated snapshot for reproducible comparisons.</div> : null}
          <div className="field-grid">
            <Field label="Size"><select aria-label="Size preset" value={SIZE_PRESETS.includes(settings.size) ? settings.size : 'custom'} onChange={(event) => update('size', event.target.value === 'custom' ? '' : event.target.value)}><option value="1024x1024">1024×1024</option><option value="2048x2048">2048×2048</option><option value="1536x1024">1536×1024</option><option value="1024x1536">1024×1536</option><option value="auto">Auto</option><option value="custom">Custom…</option></select>{!SIZE_PRESETS.includes(settings.size) ? <input aria-label="Custom size" value={settings.size} onChange={(event) => update('size', event.target.value)} placeholder="1280x1280" /> : null}</Field>
            <Field label="Quality"><select value={settings.quality} onChange={(event) => update('quality', event.target.value)}>{boot.capabilities.qualities.map((value) => <option value={value} key={value}>{value}</option>)}</select></Field>
            <Field label="Format"><select value={settings.output_format} onChange={(event) => update('output_format', event.target.value)}>{boot.capabilities.outputFormats.map((value) => <option value={value} key={value}>{value.toUpperCase()}</option>)}</select></Field>
            <Field label="Background"><select value={settings.background} onChange={(event) => update('background', event.target.value)}>{boot.capabilities.backgrounds.map((value) => <option value={value} key={value}>{value}</option>)}</select></Field>
            <Field label="Outputs" hint="1–10"><input type="number" min="1" max="10" value={settings.n} onChange={(event) => update('n', Number(event.target.value))} /></Field>
            <Field label="Compression" hint={compressionEnabled ? '0–100' : 'PNG ignores this'}><input type="number" min="0" max="100" value={settings.output_compression} disabled={!compressionEnabled} onChange={(event) => update('output_compression', Number(event.target.value))} /></Field>
          </div>
          <button type="button" className="advanced-toggle" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}><span>Advanced controls</span><span>{advanced ? '−' : '+'}</span></button>
          {advanced ? <div className="advanced-panel"><label className="switch-row"><span><strong>Stream response</strong><small>Receive partial/final events.</small></span><input type="checkbox" checked={settings.stream} onChange={(event) => update('stream', event.target.checked)} /></label><Field label="Partial images" hint="0–3" className={!settings.stream ? 'disabled-field' : ''}><input type="number" min="0" max="3" value={settings.partial_images} disabled={!settings.stream} onChange={(event) => update('partial_images', Number(event.target.value))} /></Field><Field label="Input fidelity" hint={boot.capabilities.notes.inputFidelity}><select value={settings.input_fidelity} onChange={(event) => update('input_fidelity', event.target.value)}><option value="omit">Do not send</option><option value="low">low</option><option value="high">high</option></select></Field>{settings.input_fidelity !== 'omit' ? <div className="inline-warning">The dated Flare snapshot rejected this parameter in YMI's live evaluation.</div> : null}<Field label="End-user ID"><input value={settings.user} onChange={(event) => update('user', event.target.value)} maxLength={256} placeholder="optional" /></Field><Field label="Local timeout (ms)" hint="No retry after timeout"><input type="number" min="10000" max="600000" step="1000" value={settings.timeout_ms} onChange={(event) => update('timeout_ms', Number(event.target.value))} /></Field><div className="fixed-contract"><strong>response_format</strong><span>Not sent; the API returns base64 image data.</span></div></div> : null}
          <div className="sidebar-divider" />
          <div className="output-location"><div className="output-copy"><span className="section-kicker">Save to</span><h3>Image output folder</h3><p>Each successful run creates one subfolder containing images only.</p></div><div className="path-picker"><input value={outputRoot} readOnly title={outputRoot} /><button type="button" className="small-action" onClick={async () => { const selected = await api.pickOutputRoot(outputRoot); if (selected) setOutputRoot(selected) }} disabled={busy}>Choose</button></div></div>
          <div className="sidebar-divider" />
          <details className="connection-panel"><summary><span><span className={`status-dot ${boot.apiKeyLoaded ? 'ready' : ''}`} /> API connection</span><small>{boot.apiKeyLoaded ? 'Ready' : 'Not configured'}</small></summary><p>Saved with Windows account encryption. The key is never written to run evidence.</p><input type="password" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder={boot.apiKeyLoaded ? 'Paste a new key to replace it' : 'Paste your OpenAI API key'} autoComplete="new-password" spellCheck="false" aria-label="OpenAI API key" disabled={keyBusy || busy} /><div className="row-actions key-actions"><button type="button" className="secondary" onClick={saveApiKey} disabled={keyBusy || busy || !keyDraft.trim()}>{boot.apiKeyLoaded ? 'Replace key' : 'Save key'}</button>{boot.apiKeyLoaded || boot.apiKeyStatus?.configured ? <button type="button" className="text-button" onClick={removeApiKey} disabled={keyBusy || busy}>Remove</button> : null}</div></details>
        </aside>
      </main>

      <footer><span>Direct Images Edit API · automatic retry off · safety evidence stored internally</span><a href="https://developers.openai.com/api/reference/cli/resources/images/methods/edit" target="_blank" rel="noreferrer">Official API reference</a></footer>
    </div>
  )
}

export default App
