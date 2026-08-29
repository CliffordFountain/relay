import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/** One capturable source offered to the renderer's screen-share picker. */
interface ScreenShareSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnail: string; // data URL
  appIcon: string | null; // data URL, windows only
}

interface ScreenShareRequest {
  requestId: number;
  sources: ScreenShareSource[];
}

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('get-version'),
  minimize: () => ipcRenderer.invoke('minimize'),
  maximize: () => ipcRenderer.invoke('maximize'),
  close: () => ipcRenderer.invoke('close'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),
  onMaximizeChange: (callback: (maximized: boolean) => void) => {
    ipcRenderer.on('maximize-change', (_, maximized) => callback(maximized));
  },
  // Screen share: the main process asks the renderer to pick a source (screen or
  // window). onScreenShareRequest subscribes and returns an unsubscribe function;
  // pickScreenShareSource replies with the chosen id (or null to cancel).
  onScreenShareRequest: (callback: (request: ScreenShareRequest) => void) => {
    const listener = (_event: IpcRendererEvent, request: ScreenShareRequest) =>
      callback(request);
    ipcRenderer.on('screen-share:request', listener);
    return () => ipcRenderer.removeListener('screen-share:request', listener);
  },
  pickScreenShareSource: (requestId: number, sourceId: string | null) =>
    ipcRenderer.invoke('screen-share:pick', requestId, sourceId),
});
