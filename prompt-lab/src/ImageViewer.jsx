import React, { useEffect, useRef, useState } from 'react'

export default function ImageViewer({ image, onClose }) {
  const dialog = useRef(null)
  const viewport = useRef(null)
  const drag = useRef(null)
  const [zoom, setZoom] = useState(null)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current.showModal()
    return () => { previous?.focus() }
  }, [])
  const fit = () => {
    const area = viewport.current
    return Math.min(1, (area.clientWidth - 32) / image.width, (area.clientHeight - 32) / image.height)
  }
  const changeZoom = (factor) => setZoom(Math.min(4, Math.max(0.1, (zoom ?? fit()) * factor)))
  return <dialog ref={dialog} className="image-viewer" onCancel={(event) => { event.preventDefault(); onClose() }} aria-label="Original image viewer">
    <div className="viewer-toolbar"><strong>{image.file} · {image.width}×{image.height}</strong><div className="row-actions">
      <button onClick={() => changeZoom(1 / 1.25)} aria-label="Zoom out">−</button>
      <span>{zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
      <button onClick={() => changeZoom(1.25)} aria-label="Zoom in">+</button>
      <button onClick={() => setZoom(null)}>Fit</button><button onClick={() => setZoom(1)}>100%</button>
      <button onClick={onClose} autoFocus>Close</button>
    </div></div>
    <div ref={viewport} className="viewer-viewport" onPointerDown={(event) => {
      if (event.button !== 0) return
      const area = viewport.current
      drag.current = { x: event.clientX, y: event.clientY, left: area.scrollLeft, top: area.scrollTop }
      area.setPointerCapture(event.pointerId)
    }} onPointerMove={(event) => {
      if (!drag.current) return
      viewport.current.scrollLeft = drag.current.left - event.clientX + drag.current.x
      viewport.current.scrollTop = drag.current.top - event.clientY + drag.current.y
    }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <div className={`viewer-image-space ${zoom === null ? 'fit' : ''}`}>
        <img src={image.url} alt="Original generated output" draggable={false}
          style={zoom === null ? undefined : { width: image.width * zoom, height: image.height * zoom }} />
      </div>
    </div>
    <p className="viewer-help">Original file · Zoom to inspect details · Drag to pan · Esc to close</p>
  </dialog>
}
