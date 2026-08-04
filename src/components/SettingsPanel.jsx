import React from 'react'

const FORMAT_LABELS = { webp: 'WebP', png: 'PNG', jpeg: 'JPEG' }
const EFFORT_OPTIONS = [
  { value: 2, label: 'Fast' },
  { value: 4, label: 'Balanced' },
  { value: 6, label: 'Best' },
]
const PERCENT_PRESETS = [25, 50, 75, 150, 200]

function Section({ title, hint, children }) {
  return (
    <section className="panel-section">
      <h3>{title}</h3>
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  )
}

/** iOS-style segmented control: the selected chip is a lifted glass pill. */
function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'is-active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Slider({ label, value, min, max, step = 1, disabled, onChange }) {
  return (
    <label className={`slider-row${disabled ? ' is-disabled' : ''}`}>
      <span className="slider-head">
        <span>{label}</span>
        <span className="slider-value">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        {label}
        {hint ? <em>{hint}</em> : null}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track"><span className="switch-knob" /></span>
      </span>
    </label>
  )
}

export default function SettingsPanel({ settings, outputFormats, disabled, onChange }) {
  // Patches go through the updater form: two changes landing in one React batch must
  // both survive, and building them off the `settings` prop would let the second
  // overwrite the first from a stale render closure.
  const set = (patch) => onChange((prev) => ({ ...prev, ...patch }))
  const setResize = (patch) => onChange((prev) => ({ ...prev, resize: { ...prev.resize, ...patch } }))
  const setOutput = (patch) => onChange((prev) => ({ ...prev, output: { ...prev.output, ...patch } }))

  const targetKeepsAlpha = outputFormats[settings.format]?.alpha !== false
  const qualityDisabled =
    (settings.format === 'webp' && settings.lossless) ||
    (settings.format === 'png' && !settings.pngPalette)

  return (
    <aside className={`settings${disabled ? ' is-busy' : ''}`}>
      <Section title="Output format">
        <Segmented
          value={settings.format}
          options={Object.keys(outputFormats).map((k) => ({ value: k, label: FORMAT_LABELS[k] || k }))}
          onChange={(format) => set({ format })}
        />
      </Section>

      <Section title="Quality">
        <Slider
          label="Quality"
          value={settings.quality}
          min={1}
          max={100}
          disabled={qualityDisabled}
          onChange={(quality) => set({ quality })}
        />
        {settings.format === 'webp' && (
          <>
            <Toggle
              label="Lossless"
              hint="Exact pixels, much larger files"
              checked={settings.lossless}
              onChange={(lossless) => set({ lossless })}
            />
            <div className="stack">
              <span className="stack-label">Encoder effort</span>
              <Segmented
                value={settings.effort}
                options={EFFORT_OPTIONS}
                onChange={(effort) => set({ effort })}
              />
            </div>
          </>
        )}
        {settings.format === 'png' && (
          <Toggle
            label="8-bit palette"
            hint="Much smaller PNGs, slight colour loss"
            checked={settings.pngPalette}
            onChange={(pngPalette) => set({ pngPalette })}
          />
        )}
        {settings.format === 'png' && !settings.pngPalette && (
          <p className="hint">PNG is lossless — quality only applies to palette mode.</p>
        )}
      </Section>

      <Section title="Resize">
        <Segmented
          value={settings.resize.mode}
          options={[
            { value: 'none', label: 'None' },
            { value: 'percent', label: 'Percent' },
            { value: 'fit', label: 'Fit within' },
          ]}
          onChange={(mode) => setResize({ mode })}
        />

        {settings.resize.mode === 'percent' && (
          <>
            <label className="field">
              <span>Scale</span>
              <span className="suffixed">
                <input
                  type="number"
                  min={1}
                  max={800}
                  value={settings.resize.percent}
                  onChange={(e) => setResize({ percent: Number(e.target.value) })}
                />
                <em>%</em>
              </span>
            </label>
            <div className="chips">
              {PERCENT_PRESETS.map((p) => (
                <button key={p} type="button" className={settings.resize.percent === p ? 'is-active' : ''} onClick={() => setResize({ percent: p })}>
                  {p}%
                </button>
              ))}
            </div>
          </>
        )}

        {settings.resize.mode === 'fit' && (
          <>
            <div className="field-grid">
              <label className="field">
                <span>Max width</span>
                <input
                  type="number"
                  min={0}
                  value={settings.resize.width ?? ''}
                  placeholder="auto"
                  onChange={(e) => setResize({ width: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Max height</span>
                <input
                  type="number"
                  min={0}
                  value={settings.resize.height ?? ''}
                  placeholder="auto"
                  onChange={(e) => setResize({ height: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </label>
            </div>
            <Toggle
              label="Allow upscaling"
              hint="Off = images smaller than the box are left alone"
              checked={settings.resize.allowUpscale}
              onChange={(allowUpscale) => setResize({ allowUpscale })}
            />
          </>
        )}
        {settings.resize.mode !== 'none' && <p className="hint">Lanczos 3 resampling; aspect ratio is always preserved.</p>}
      </Section>

      {!targetKeepsAlpha && (
        <Section title="Transparency" hint={`${FORMAT_LABELS[settings.format]} has no alpha channel — transparent pixels are flattened onto this colour.`}>
          <label className="field">
            <span>Background</span>
            <span className="suffixed">
              <input type="color" value={settings.flattenColor} onChange={(e) => set({ flattenColor: e.target.value })} />
              <em>{settings.flattenColor}</em>
            </span>
          </label>
        </Section>
      )}

      <Section title="Metadata">
        <Toggle
          label="Keep EXIF"
          hint="Off = stripped for the web. The ICC colour profile is kept either way."
          checked={settings.keepMetadata}
          onChange={(keepMetadata) => set({ keepMetadata })}
        />
      </Section>

      <Section title="Saving" hint="Converted images are held temporarily until you download them, and are deleted when the app closes.">
        <label className="field">
          <span>Name suffix</span>
          <input
            type="text"
            value={settings.output.suffix}
            placeholder="e.g. -web"
            onChange={(e) => setOutput({ suffix: e.target.value })}
          />
        </label>
        <Toggle
          label="Replace existing"
          hint="Multi-image downloads only. Off = a -1, -2… counter is appended"
          checked={settings.output.overwrite}
          onChange={(overwrite) => setOutput({ overwrite })}
        />
        <p className="hint">Source files are never overwritten.</p>
      </Section>
    </aside>
  )
}
