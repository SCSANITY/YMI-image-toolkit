'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('promptLab', {
  pathForFile(file) {
    try { return webUtils.getPathForFile(file) || null } catch { return null }
  },
  boot: () => ipcRenderer.invoke('prompt-lab:boot'),
  pickImages: () => ipcRenderer.invoke('prompt-lab:pick-images'),
  pickMask: () => ipcRenderer.invoke('prompt-lab:pick-mask'),
  pickOutputRoot: (current) => ipcRenderer.invoke('prompt-lab:pick-output-root', current),
  inspectImage: (filePath, options) => ipcRenderer.invoke('prompt-lab:inspect-image', filePath, options),
  validate: (request) => ipcRenderer.invoke('prompt-lab:validate', request),
  execute: (request) => ipcRenderer.invoke('prompt-lab:execute', request),
  exportConfig: (config) => ipcRenderer.invoke('prompt-lab:export-config', config),
  importConfig: () => ipcRenderer.invoke('prompt-lab:import-config'),
  revealPath: (target) => ipcRenderer.invoke('prompt-lab:reveal-path', target),
  openPath: (target) => ipcRenderer.invoke('prompt-lab:open-path', target),
})
