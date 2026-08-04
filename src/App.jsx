import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SettingsPanel from './components/SettingsPanel.jsx'
import FileRow from './components/FileRow.jsx'
import SelectionBar from './components/SelectionBar.jsx'
import WindowControls from './components/WindowControls.jsx'
import { formatBytes } from './lib/format.js'
import { runPool } from './lib/pool.js'
import { outputExtFor, outputNameFor, outputStemFor, sanitizeStem } from './lib/naming.js'

const api = window.imageToolkit
const SETTINGS_KEY = 'ymi-image-toolkit-settings'
const PROBE_CONCURRENCY = 4
const CONVERT_CONCURRENCY = 3

const rowId = (filePath) => filePath.toLowerCase()

function loadStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function App() {
  const [defaults, setDefaults] = useState(null)
  const [settings, setSettings] = useState(null)
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [phase, setPhase] = useState('idle') // idle | converting | saving
  const [dragOver, setDragOver] = useState(false)
  const [notice, setNotice] = useState('')

  const knownPaths = useRef(new Set())
  const cancelRef = useRef(false)
  const settingsRef = useRef(null)
  const filesRef = useRef(files)
  const formatsRef = useRef(null)
  settingsRef.current = settings
  filesRef.current = files
  formatsRef.current = defaults?.outputFormats

  /** Staged files are real temp files; dropping a row has to drop its bytes too. */
  const discardStagedFor = useCallback((rows) => {
    const paths = rows.filter((f) => f.staged).map((f) => f.staged.stagedPath)
    if (paths.length) api.discardStaged(paths)
  }, [])

  const busy = phase !== 'idle'

  // ── boot: the pipeline hands us the canonical settings contract ────────────
  useEffect(() => {
    if (!api) return
    api.getDefaults().then((payload) => {
      setDefaults(payload)
      const stored = loadStoredSettings()
      setSettings(stored ? { ...payload.settings, ...stored } : payload.settings)
    })
  }, [])

  useEffect(() => {
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  // Converted-but-not-downloaded images only exist in temp, so the main process warns
  // about them before the window closes.
  const unsavedCount = useMemo(
    () => files.filter((f) => f.staged && !f.outputPath).length,
    [files]
  )
  useEffect(() => { api?.setUnsavedCount?.(unsavedCount) }, [unsavedCount])

  // ── adding files ───────────────────────────────────────────────────────────
  const addPaths = useCallback(async (paths) => {
    if (!paths.length) return
    const expanded = await api.expandPaths(paths)
    if (!expanded.ok) {
      setNotice(expanded.error)
      return
    }
    const fresh = expanded.paths.filter((p) => !knownPaths.current.has(rowId(p)))
    if (!fresh.length) {
      setNotice(expanded.paths.length ? 'Those images are already in the list.' : 'No supported images found.')
      return
    }
    fresh.forEach((p) => knownPaths.current.add(rowId(p)))
    setNotice('')
    setFiles((prev) => [
      ...prev,
      ...fresh.map((p) => ({
        id: rowId(p),
        path: p,
        name: p.split(/[\\/]/).pop(),
        status: 'probing',
        pages: 1,
      })),
    ])

    await runPool(fresh, PROBE_CONCURRENCY, async (filePath) => {
      const res = await api.probeFile(filePath)
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== rowId(filePath)) return f
          return res.ok
            ? { ...f, ...res.file, id: f.id, status: 'ready' }
            : { ...f, status: 'error', error: res.error }
        })
      )
    })
  }, [])

  const handleAddFiles = useCallback(async () => {
    const paths = await api.pickFiles()
    await addPaths(paths)
  }, [addPaths])

  const handleAddFolder = useCallback(async () => {
    const dir = await api.pickDirectory('Add every image in a folder')
    if (dir) await addPaths([dir])
  }, [addPaths])

  const handleDrop = useCallback(async (event) => {
    event.preventDefault()
    setDragOver(false)
    const paths = Array.from(event.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean)
    await addPaths(paths)
  }, [addPaths])

  // ── removing rows (and their staged files) ─────────────────────────────────
  const dropRows = useCallback((ids) => {
    const doomed = new Set(ids)
    discardStagedFor(filesRef.current.filter((f) => doomed.has(f.id)))
    doomed.forEach((id) => knownPaths.current.delete(id))
    setFiles((prev) => prev.filter((f) => !doomed.has(f.id)))
    setSelected((prev) => {
      const next = new Set(prev)
      doomed.forEach((id) => next.delete(id))
      return next
    })
  }, [discardStagedFor])

  const clearAll = useCallback(() => {
    discardStagedFor(filesRef.current)
    knownPaths.current.clear()
    setFiles([])
    setSelected(new Set())
    setNotice('')
  }, [discardStagedFor])

  /**
   * Renaming a row changes what its download is called — never the source file. An empty
   * or illegal-only name is ignored so a row can't end up nameless.
   */
  const renameRow = useCallback((id, rawStem) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f
        const ext = outputExtFor(f, settingsRef.current, formatsRef.current)
        const stem = sanitizeStem(rawStem, ext)
        if (!stem || stem === outputStemFor(f, settingsRef.current)) return f
        return { ...f, customStem: stem }
      })
    )
  }, [])

  // ── selection ──────────────────────────────────────────────────────────────
  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback((checked) => {
    setSelected(checked ? new Set(files.map((f) => f.id)) : new Set())
  }, [files])

  const selectedRows = useMemo(() => files.filter((f) => selected.has(f.id)), [files, selected])

  // ── conversion ─────────────────────────────────────────────────────────────
  // Converting is deliberately selection-gated: you pick the rows, then convert them.
  // Nothing selected means nothing to convert, so the action stays disabled.
  const convertible = useMemo(
    () => files.filter((f) => selected.has(f.id) && f.status !== 'probing' && f.width > 0),
    [files, selected]
  )

  const startConversion = useCallback(async () => {
    const targets = convertible.map((f) => f.path)
    if (!targets.length) return

    cancelRef.current = false
    setPhase('converting')
    setNotice('')
    const targetIds = new Set(targets.map(rowId))
    // Re-converting replaces the previous staged result; drop the old temp files first.
    discardStagedFor(filesRef.current.filter((f) => targetIds.has(f.id)))
    setFiles((prev) =>
      prev.map((f) => (targetIds.has(f.id)
        ? { ...f, status: 'queued', error: null, staged: null, outputPath: null }
        : f))
    )

    await runPool(targets, CONVERT_CONCURRENCY, async (filePath) => {
      if (cancelRef.current) {
        setFiles((prev) => prev.map((f) => (f.id === rowId(filePath) && f.status === 'queued' ? { ...f, status: 'ready' } : f)))
        return
      }
      setFiles((prev) => prev.map((f) => (f.id === rowId(filePath) ? { ...f, status: 'working' } : f)))
      const res = await api.convertToStaging(filePath, settingsRef.current)
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== rowId(filePath)) return f
          return res.ok
            ? { ...f, status: 'converted', staged: res.result, error: null }
            : { ...f, status: 'error', error: res.error }
        })
      )
    })

    setPhase('idle')
    if (cancelRef.current) setNotice('Cancelled — nothing was written.')
  }, [convertible, discardStagedFor])

  const cancelConversion = useCallback(() => { cancelRef.current = true }, [])

  // ── downloading ────────────────────────────────────────────────────────────
  const downloadRows = useCallback(async (rows) => {
    // The staged file keeps its original temp name; what the user sees in the list is
    // what the download is called.
    const items = rows
      .filter((r) => r.staged)
      .map((r) => ({ ...r.staged, suggestedName: outputNameFor(r, settingsRef.current, formatsRef.current) }))
    if (!items.length) {
      setNotice('Convert those images first — there is nothing to download yet.')
      return
    }

    setPhase('saving')
    const destination = await api.chooseDestination({
      count: items.length,
      suggestedName: items[0].suggestedName,
      format: items[0].format,
      defaultDir: settingsRef.current.output.lastDir || rows[0]?.dir || null,
    })
    if (!destination) {
      setPhase('idle')
      return
    }

    const res = await api.saveOutputs(items, destination, { overwrite: settingsRef.current.output.overwrite })
    if (!res.ok) {
      setNotice(res.error)
      setPhase('idle')
      return
    }

    const byInput = new Map(res.results.map((r) => [rowId(r.inputPath), r]))
    setFiles((prev) =>
      prev.map((f) => {
        const r = byInput.get(f.id)
        if (!r) return f
        return r.ok
          ? { ...f, status: 'saved', outputPath: r.outputPath, error: null }
          : { ...f, status: 'error', error: r.error }
      })
    )
    setSettings((prev) => ({ ...prev, output: { ...prev.output, lastDir: destination.dir } }))
    setPhase('idle')

    const failed = res.results.filter((r) => !r.ok).length
    setNotice(failed ? `${failed} of ${items.length} could not be written.` : '')
  }, [])

  const downloadOne = useCallback((id) => {
    const row = files.find((f) => f.id === id)
    if (row) downloadRows([row])
  }, [files, downloadRows])

  // ── summary ────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const done = files.filter((f) => f.staged)
    const failed = files.filter((f) => f.status === 'error').length
    return {
      count: done.length,
      failed,
      inBytes: done.reduce((n, f) => n + f.staged.inBytes, 0),
      outBytes: done.reduce((n, f) => n + f.staged.outBytes, 0),
    }
  }, [files])

  if (!api) {
    return (
      <div className="boot-error">
        <h1>YMI Image Toolkit</h1>
        <p>This app must run inside its Electron shell — the image pipeline lives in the desktop process.</p>
        <p>Run <code>npm run dev</code> (not the bare Vite URL), or launch the installed app.</p>
      </div>
    )
  }

  if (!settings || !defaults) {
    return <div className="boot-error"><p>Starting…</p></div>
  }

  const selectedDownloadable = selectedRows.filter((f) => f.staged).length
  const actionLabel =
    phase === 'converting' ? 'Converting…'
      : phase === 'saving' ? 'Choosing…'
        : convertible.length ? `Convert ${convertible.length} selected`
          : 'Convert'

  return (
    <div
      className={`app${dragOver ? ' is-dragover' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={handleDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>Image Toolkit</h1>
        </div>
        <div className="topbar-right">
          <div className="topbar-actions">
            <button type="button" className="small" onClick={handleAddFiles} disabled={busy}>Add images</button>
            <button type="button" className="small" onClick={handleAddFolder} disabled={busy}>Add folder</button>
            <button type="button" className="ghost small" onClick={clearAll} disabled={busy || !files.length}>Clear</button>
          </div>
          <WindowControls />
        </div>
      </header>

      <main className="body">
        <div className="list-pane">
          {files.length > 0 && (
            <SelectionBar
              total={files.length}
              selectedCount={selected.size}
              allSelected={selected.size > 0 && selected.size === files.length}
              downloadableCount={selectedDownloadable}
              disabled={busy}
              onToggleAll={toggleSelectAll}
              onDownload={() => downloadRows(selectedRows)}
              onRemove={() => dropRows([...selected])}
              onClear={() => setSelected(new Set())}
            />
          )}

          {notice ? <div className="notice">{notice}</div> : null}

          {files.length === 0 ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true" />
              <h2>Drop images or folders here</h2>
              <p>PNG · JPEG · WebP · AVIF · TIFF in — PNG · JPEG · WebP out.</p>
              <button type="button" onClick={handleAddFiles}>Add images</button>
            </div>
          ) : (
            <ul className="rows">
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  selected={selected.has(file.id)}
                  outputStem={outputStemFor(file, settings)}
                  outputExt={outputExtFor(file, settings, defaults.outputFormats)}
                  disabled={busy}
                  onRename={renameRow}
                  onToggleSelect={toggleSelect}
                  onRemove={(id) => dropRows([id])}
                  onDownload={downloadOne}
                  onReveal={(p) => api.revealPath(p)}
                />
              ))}
            </ul>
          )}
        </div>

        <SettingsPanel
          settings={settings}
          outputFormats={defaults.outputFormats}
          disabled={busy}
          onChange={setSettings}
        />
      </main>

      <footer className="actionbar">
        <div className="summary">
          {summary.count > 0 && (
            <>
              <strong>{summary.count}</strong> converted
              <span className="dot">·</span>
              {formatBytes(summary.inBytes)} → {formatBytes(summary.outBytes)}
              <span className={`delta ${summary.outBytes <= summary.inBytes ? 'good' : 'bad'}`}>
                {summary.inBytes ? `${Math.round(((summary.outBytes - summary.inBytes) / summary.inBytes) * 100)}%` : ''}
              </span>
            </>
          )}
          {unsavedCount > 0 && <span className="pending-note">{unsavedCount} not downloaded — temporary until you do</span>}
          {summary.failed > 0 && <span className="err">{summary.failed} failed</span>}
        </div>
        <div className="actionbar-buttons">
          {phase === 'converting' && <button type="button" className="ghost" onClick={cancelConversion}>Cancel</button>}
          <button
            type="button"
            className="primary"
            disabled={busy || convertible.length === 0}
            title={convertible.length ? undefined : 'Select images in the list first'}
            onClick={startConversion}
          >
            {actionLabel}
          </button>
        </div>
      </footer>
    </div>
  )
}
