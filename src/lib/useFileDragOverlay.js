import { useEffect, useState } from 'react'

// A drag that is still over the window keeps firing `dragover` -- the spec runs the drag
// loop every ~350ms even when the pointer is completely still. So "we stopped hearing
// dragover" is a reliable signal that the drag is gone, whatever the reason.
const DRAG_IDLE_MS = 500

function isFileDrag(event) {
  const types = event.dataTransfer?.types
  // Ignore text/selection drags (e.g. dragging inside the rename field) -- only real files.
  return types ? Array.prototype.includes.call(types, 'Files') : false
}

function pointerLeftWindow(event) {
  return (
    event.clientX <= 0 ||
    event.clientY <= 0 ||
    event.clientX >= window.innerWidth ||
    event.clientY >= window.innerHeight
  )
}

/**
 * Whether a file drag is currently over the window.
 *
 * The state is owned by ONE rule: the overlay is on while `dragover` keeps arriving, and a
 * watchdog turns it off once that stops. Per-element dragenter/dragleave bookkeeping is
 * deliberately not used -- dragging across child elements and then out of the window leaves
 * the final `dragleave` on a child, which is exactly how the overlay used to get stuck on.
 * The viewport check below is only an accelerator so leaving feels instant; correctness
 * comes from the watchdog, so the overlay cannot survive a drag that has gone away.
 */
export function useFileDragOverlay() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let timer = 0

    const hide = () => {
      window.clearTimeout(timer)
      timer = 0
      setActive(false)
    }

    const handleDragOver = (event) => {
      if (!isFileDrag(event)) return
      // Required, or the browser refuses the drop and navigates to the file instead.
      event.preventDefault()
      setActive(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(hide, DRAG_IDLE_MS)
    }

    const handleDragLeave = (event) => {
      if (pointerLeftWindow(event)) hide()
    }

    const handleDrop = (event) => {
      if (isFileDrag(event)) event.preventDefault()
      hide()
    }

    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    window.addEventListener('dragend', hide)
    // A drag can end while the window is not focused (dropped on another app).
    window.addEventListener('blur', hide)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('dragend', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])

  return active
}
