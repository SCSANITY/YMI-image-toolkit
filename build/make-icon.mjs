/**
 * Rasterise build/icon.svg into the PNG + multi-size ICO electron-builder needs.
 * Run after editing the SVG:  node build/make-icon.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const here = path.dirname(fileURLToPath(import.meta.url))
const svg = await readFile(path.join(here, 'icon.svg'))

// electron-builder wants a >=256px PNG for non-Windows targets and the installer graphics.
await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(path.join(here, 'icon.png'))

// Render each ICO size from the vector rather than downscaling one bitmap, so 16px stays crisp.
const sizes = [16, 24, 32, 48, 64, 128, 256]
const frames = await Promise.all(
  sizes.map((s) => sharp(svg, { density: Math.max(96, s * 3) }).resize(s, s).png().toBuffer())
)
await writeFile(path.join(here, 'icon.ico'), await pngToIco(frames))

console.log(`icon.png + icon.ico written (${sizes.join(', ')})`)
