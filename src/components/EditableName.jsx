import React, { useEffect, useRef, useState } from 'react'

/**
 * Click the name to rename the output. The extension is not editable — it belongs to the
 * output format, not to the name. Enter or clicking away commits, Escape reverts.
 */
export default function EditableName({ stem, ext, disabled, title, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(stem)
  const inputRef = useRef(null)
  // Escape unmounts the input, and an unmount can still fire blur — this keeps the
  // blur-commit from undoing the cancel.
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  if (!editing) {
    return (
      <div className="row-name" title={title}>
        <button
          type="button"
          className="name-btn"
          disabled={disabled}
          onClick={() => { cancelledRef.current = false; setDraft(stem); setEditing(true) }}
        >
          <span className="name-stem">{stem}</span>
          <span className="name-ext">.{ext}</span>
          <svg className="name-pencil" viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.4 1.9l2.7 2.7L4.9 11.8 1.7 12.3l.5-3.2z" />
          </svg>
        </button>
      </div>
    )
  }

  const commit = () => {
    setEditing(false)
    if (cancelledRef.current) return
    onCommit(draft)
  }

  return (
    <div className="row-name is-editing">
      <input
        ref={inputRef}
        type="text"
        className="name-input"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; setEditing(false) }
        }}
      />
      <span className="name-ext">.{ext}</span>
    </div>
  )
}
