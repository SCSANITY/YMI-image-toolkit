import React, { useEffect, useState } from 'react'

const api = window.imageToolkit

/** The window is frameless, so these are the title bar. Kept out of the drag region. */
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => api?.onWindowState?.(({ maximized: m }) => setMaximized(m)), [])

  return (
    <div className="window-controls">
      <button type="button" className="win-btn" onClick={() => api.minimizeWindow()} aria-label="Minimise">
        <svg viewBox="0 0 12 12" width="11" height="11"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
      </button>
      <button type="button" className="win-btn" onClick={() => api.toggleMaximizeWindow()} aria-label={maximized ? 'Restore' : 'Maximise'}>
        {maximized ? (
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="2" y="3.6" width="6" height="6" rx="1.4" />
            <path d="M4.2 3.6V3a1.4 1.4 0 011.4-1.4H9A1.4 1.4 0 0110.4 3v3.4A1.4 1.4 0 019 7.8h-.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.6" />
          </svg>
        )}
      </button>
      <button type="button" className="win-btn win-btn--close" onClick={() => api.closeWindow()} aria-label="Close">
        <svg viewBox="0 0 12 12" width="11" height="11"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}
