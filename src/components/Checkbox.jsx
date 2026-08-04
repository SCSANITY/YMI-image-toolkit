import React, { useEffect, useRef } from 'react'

/** iOS-style round checkbox. `indeterminate` is a DOM-only property, hence the ref. */
export default function Checkbox({ checked, indeterminate = false, disabled, onChange, label }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label className="checkbox" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="checkbox-box">
        <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
          <path className="tick" d="M3 7.3l2.7 2.7L11 4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path className="dash" d="M3.6 7h6.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    </label>
  )
}
