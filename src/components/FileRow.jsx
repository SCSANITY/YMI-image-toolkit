import React from 'react'
import Checkbox from './Checkbox.jsx'
import { formatBytes, formatDelta, deltaPercent } from '../lib/format.js'

const STATUS_LABEL = {
  probing: 'Reading',
  ready: 'Ready',
  queued: 'Queued',
  working: 'Converting',
  converted: 'Converted',
  saved: 'Downloaded',
  error: 'Failed',
}

export default function FileRow({ file, selected, onToggleSelect, onRemove, onDownload, onReveal, disabled }) {
  const out = file.staged
  const pct = out ? deltaPercent(out.inBytes, out.outBytes) : 0

  return (
    <li className={`row row--${file.status}${selected ? ' is-selected' : ''}`}>
      <Checkbox checked={selected} disabled={disabled} onChange={() => onToggleSelect(file.id)} label={`Select ${file.name}`} />

      <div className="row-thumb">
        {file.thumb ? <img src={file.thumb} alt="" /> : <div className="thumb-placeholder" />}
      </div>

      <div className="row-main">
        <div className="row-name" title={file.path}>{file.name}</div>
        <div className="row-meta">
          {file.status === 'probing' ? (
            <span>reading…</span>
          ) : file.error && !out ? (
            <span className="err">{file.error}</span>
          ) : (
            <>
              <span>{file.width}×{file.height}</span>
              <span className="dot">·</span>
              <span className="tag">{(file.format || '').toUpperCase()}</span>
              {file.hasAlpha ? <span className="tag tag--alpha">alpha</span> : null}
              {file.pages > 1 ? <span className="tag tag--warn">{file.pages} frames · first only</span> : null}
              <span className="dot">·</span>
              <span>{formatBytes(file.bytes)}</span>
            </>
          )}
        </div>
        {out && (
          <div className="row-result">
            <span className="arrow">→</span>
            <span>{out.width}×{out.height}</span>
            <span className="dot">·</span>
            <span className="tag tag--out">{out.format.toUpperCase()}</span>
            <span className="dot">·</span>
            <span>{formatBytes(out.outBytes)}</span>
            <span className={`delta ${pct <= 0 ? 'good' : 'bad'}`}>{formatDelta(out.inBytes, out.outBytes)}</span>
            {file.outputPath && (
              <button type="button" className="link" onClick={() => onReveal(file.outputPath)} title={file.outputPath}>
                Show in folder
              </button>
            )}
          </div>
        )}
        {file.status === 'error' && file.error && <div className="row-result err">{file.error}</div>}
      </div>

      <div className="row-actions">
        <span className={`status status--${file.status}`}>{STATUS_LABEL[file.status] || file.status}</span>
        {out && (
          <button type="button" className="small download" disabled={disabled} onClick={() => onDownload(file.id)}>
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 1.8v7.4M4 6.4L7 9.4l3-3M2.2 11.6h9.6" />
            </svg>
            Download
          </button>
        )}
        <button type="button" className="icon-btn" disabled={disabled} onClick={() => onRemove(file.id)} aria-label="Remove">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
    </li>
  )
}
