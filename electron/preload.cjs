const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('imageToolkit', {
  /**
   * Electron 32+ removed `File.path`; this is the supported replacement and the only way
   * the renderer can learn the real disk path of a dropped file.
   */
  pathForFile(file) {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },
  getDefaults: () => ipcRenderer.invoke('get-defaults'),

  // Frameless window: the page draws the title bar, so it drives the window buttons too.
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-maximize-toggle'),
  closeWindow: () => ipcRenderer.send('window-close'),
  onWindowState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('window-state', listener)
    return () => ipcRenderer.removeListener('window-state', listener)
  },
  /** Lets the main process warn before closing with staged files still undownloaded. */
  setUnsavedCount: (count) => ipcRenderer.send('set-unsaved-count', count),

  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickDirectory: (title) => ipcRenderer.invoke('pick-directory', title),
  expandPaths: (paths) => ipcRenderer.invoke('expand-paths', paths),
  probeFile: (filePath) => ipcRenderer.invoke('probe-file', filePath),

  // Conversion lands in a temp staging area; downloading copies from there on demand.
  convertToStaging: (filePath, settings) => ipcRenderer.invoke('convert-to-staging', filePath, settings),
  chooseDestination: (request) => ipcRenderer.invoke('choose-destination', request),
  saveOutputs: (items, destination, options) => ipcRenderer.invoke('save-outputs', items, destination, options),
  discardStaged: (stagedPaths) => ipcRenderer.invoke('discard-staged', stagedPaths),

  revealPath: (target) => ipcRenderer.invoke('reveal-path', target),
  openPath: (target) => ipcRenderer.invoke('open-path', target),
})
