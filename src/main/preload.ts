import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../common/ipc-events.js'
import type { AccountConfig, AppState, WidgetConfig } from '../common/types.js'

export const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.GET_STATE),
  updateConfig: (patch: Partial<WidgetConfig>): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CONFIG, patch),
  refreshQuota: (): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_QUOTA),
  addCustomAccount: (account: Partial<AccountConfig>): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.ADD_CUSTOM_ACCOUNT, account),
  restoreDetectedApp: (app: any): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.RESTORE_DETECTED_APP, app),
  resetDefaultAccounts: (): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.RESET_DEFAULT_ACCOUNTS),
  toggleAccount: (id: string, enabled: boolean): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_ACCOUNT, id, enabled),
  removeAccount: (id: string): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_ACCOUNT, id),
  reorderAccount: (id: string, direction: 'up' | 'down'): Promise<AppState> => ipcRenderer.invoke(IPC_CHANNELS.REORDER_ACCOUNT, id, direction),
  showPopup: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SHOW_POPUP),
  hidePopup: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.HIDE_POPUP),
  togglePopup: (activation: 'single' | 'double' = 'single'): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_POPUP, activation),
  lockPopup: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.LOCK_POPUP),
  unlockPopup: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.UNLOCK_POPUP),
  resizeWidget: (width: number, height: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RESIZE_WIDGET, width, height),
  openSettings: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SETTINGS),
  detectLocalApps: (): Promise<any[]> => ipcRenderer.invoke(IPC_CHANNELS.DETECT_LOCAL_APPS),
  scheduleHidePopup: (delayMs?: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SCHEDULE_HIDE_POPUP, delayMs),
  cancelHidePopup: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_HIDE_POPUP),
  popupReady: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.POPUP_READY),
  onPopupOpened: (callback: (state: AppState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.POPUP_OPENED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.POPUP_OPENED, handler)
  },
  onStateChange: (callback: (state: AppState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.STATE_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.STATE_CHANGED, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: typeof api
  }
}
