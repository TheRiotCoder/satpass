const { contextBridge, ipcRenderer } = require("electron");
// No arbitrary IPC, URLs or shell commands are exposed to the renderer.
contextBridge.exposeInMainWorld("satpassDesktop", Object.freeze({
  requestLocation: () => ipcRenderer.invoke("satpass:request-location")
}));
