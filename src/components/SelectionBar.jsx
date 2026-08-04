import React from 'react'
import Checkbox from './Checkbox.jsx'

/**
 * Sits above the list. The select-all control is always there once files exist; the
 * actions only appear once something is selected, so the bar stays quiet by default.
 */
export default function SelectionBar({ total, selectedCount, allSelected, downloadableCount, disabled, onToggleAll, onDownload, onRemove, onClear }) {
  return (
    <div className={`selection-bar${selectedCount ? ' is-active' : ''}`}>
      <Checkbox
        checked={allSelected}
        indeterminate={selectedCount > 0 && !allSelected}
        disabled={disabled}
        onChange={onToggleAll}
        label="Select all"
      />
      <span className="selection-count">
        {selectedCount ? `${selectedCount} selected` : `${total} image${total === 1 ? '' : 's'}`}
      </span>

      {selectedCount > 0 && (
        <div className="selection-actions">
          <button type="button" className="small" disabled={disabled || !downloadableCount} onClick={onDownload}>
            Download{downloadableCount ? ` ${downloadableCount}` : ''}
          </button>
          <button type="button" className="small danger" disabled={disabled} onClick={onRemove}>Remove</button>
          <button type="button" className="ghost small" disabled={disabled} onClick={onClear}>Deselect</button>
        </div>
      )}
    </div>
  )
}
