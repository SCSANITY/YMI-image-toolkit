'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('promptLab', {
  pathForFile(file) {
    try { return webUtils.getPathForFile(file) || null } catch { return null }
  },
  boot: () => ipcRenderer.invoke('prompt-lab:boot'),
  apiKeyStatus: () => ipcRenderer.invoke('prompt-lab:api-key-status'),
  saveApiKey: (value) => ipcRenderer.invoke('prompt-lab:save-api-key', value),
  removeApiKey: () => ipcRenderer.invoke('prompt-lab:remove-api-key'),
  pickImages: () => ipcRenderer.invoke('prompt-lab:pick-images'),
  pickMask: () => ipcRenderer.invoke('prompt-lab:pick-mask'),
  pickOutputRoot: (current) => ipcRenderer.invoke('prompt-lab:pick-output-root', current),
  inspectImage: (filePath, options) => ipcRenderer.invoke('prompt-lab:inspect-image', filePath, options),
  validate: (request) => ipcRenderer.invoke('prompt-lab:validate', request),
  execute: (request) => ipcRenderer.invoke('prompt-lab:execute', request),
  listHistory: () => ipcRenderer.invoke('prompt-lab:list-history'),
  exportConfig: (config) => ipcRenderer.invoke('prompt-lab:export-config', config),
  importConfig: () => ipcRenderer.invoke('prompt-lab:import-config'),
  openRunFolder: (runId) => ipcRenderer.invoke('prompt-lab:open-run-folder', runId),
})
