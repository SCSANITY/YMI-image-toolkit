import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
  },
})
