import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { IPC_CHANNELS } from '../common/ipc-events.js'
import type { AccountConfig, AppState, WidgetConfig } from '../common/types.js'
import { AccountStore } from '../services/account-store.js'
import { QuotaManager } from '../services/quota-manager.js'
import { calculatePopupPosition, calculateWidgetPosition, getTaskbarInfo } from './taskbar-position.js'
import { LocalAppDetector } from '../services/local-app-detector.js'
import { TaskbarDocker } from './taskbar-docker.js'
import { CodexAppServerClient } from '../services/codex-app-server-client.js'
import { detectLang, setLang, t } from '../common/i18n.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

setLang(detectLang(app.getLocale()))

function getPreloadPath(): string {
  const cjsPath = path.join(__dirname, 'preload.cjs')
  if (fs.existsSync(cjsPath)) return cjsPath
  return path.join(__dirname, 'preload.js')
}

// 일관된 userData 경로 유지 (개발/프로덕션 동일 설정 공유)
app.name = 'ai-usage-taskbar-widget'

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

// 백그라운드 스로틀링 해제 (작업표시줄 상시 모니터링)
app.commandLine.appendSwitch('disable-renderer-backgrounding')

let widgetWindow: BrowserWindow | null = null
let popupWindow: BrowserWindow | null = null
let tray: Tray | null = null
let accountStore: AccountStore
let quotaManager: QuotaManager

let currentWidgetWidth = 520
let currentWidgetHeight = 36
const POPUP_WIDTH = 380
const POPUP_HEIGHT = 440

let isPopupLocked = false // 클릭으로 열었거나 팝업 조작 중일 때 자동 닫힘 방지
let widgetManuallyHidden = false // 트레이 메뉴로 사용자가 직접 숨긴 경우 (전체화면 감지로 되살리지 않음)
let widgetHiddenForFullscreen = false
let popupHideTimer: NodeJS.Timeout | null = null
let popupRevealTimer: NodeJS.Timeout | null = null
let lastDockedWidgetClickAt = 0
const DOUBLE_CLICK_WINDOW_MS = 500

function getAppState(): AppState {
  return {
    config: accountStore.getConfig(),
    accounts: accountStore.getAccounts(),
    usages: quotaManager.getUsages(),
    isRefreshing: false,
    lastRefreshedAt: new Date().toISOString()
  }
}

function broadcastState() {
  const state = getAppState()
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send(IPC_CHANNELS.STATE_CHANGED, state)
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send(IPC_CHANNELS.STATE_CHANGED, state)
  }
}

function applyWindowTopmost(config: WidgetConfig) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return

  if (config.placementMode === 'floating') {
    // 플로팅 모드는 Electron의 네이티브 alwaysOnTop 제어
    const isAlwaysTop = config.alwaysOnTop !== false
    if (isAlwaysTop) {
      widgetWindow.setAlwaysOnTop(true, 'screen-saver', 9999)
      TaskbarDocker.startStayTop(widgetWindow, config)
    } else {
      widgetWindow.setAlwaysOnTop(false)
      TaskbarDocker.stopStayTop()
    }
  } else {
    // [중요 원칙]: 작업표시줄 child HWND 도킹 모드에서는 setAlwaysOnTop 및 staytop을 일절 사용하지 않음
    TaskbarDocker.stopStayTop()
    widgetWindow.setAlwaysOnTop(false)
  }
}

const FLOATING_WIDGET_HEIGHT = 36

// 레이아웃(dock/undock/setBounds)은 동시 실행 시 서로의 HWND 상태를 덮어쓰므로 직렬 큐로 실행
let layoutQueue: Promise<void> = Promise.resolve()
let dockRepairPending = false

function updateWidgetBounds(): Promise<void> {
  layoutQueue = layoutQueue
    .then(layoutWidget)
    .catch((err) => console.error('[Main] Widget layout failed:', err))
  return layoutQueue
}

async function layoutWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const config = accountStore.getConfig()
  const isFloating = config.placementMode === 'floating'

  // Chromium viewport와 HWND 크기를 실제 위젯 크기로 동기화
  widgetWindow.setContentSize(currentWidgetWidth, currentWidgetHeight, false)

  if (isFloating) {
    dockRepairPending = false
    TaskbarDocker.stopDockWatcher()
    TaskbarDocker.applyBounds(widgetWindow, config, currentWidgetWidth, currentWidgetHeight)
    return
  }

  // 네이티브 작업표시줄 도킹 실행 (실제 위젯 높이 currentWidgetHeight 전달)
  const res = await TaskbarDocker.dockWindow(widgetWindow, config, currentWidgetWidth, currentWidgetHeight)
  if (res.success) {
    dockRepairPending = false
    TaskbarDocker.startDockWatcher(
      widgetWindow,
      () => handleDockedWidgetClick(),
      () => {
        console.log('[Main] Explorer restart or dock lost detected, re-docking widget...')
        dockRepairPending = true
        updateWidgetBounds()
      }
    )
  } else if (dockRepairPending) {
    // Explorer 재시작 직후에는 작업표시줄이 아직 없을 수 있으므로 복구 중일 때만 재시도
    setTimeout(() => updateWidgetBounds(), 3000)
  }
}

function createWidgetWindow() {
  const config = accountStore.getConfig()
  const isFloating = config.placementMode === 'floating'
  const { x, y } = TaskbarDocker.calculatePosition(config, currentWidgetWidth, currentWidgetHeight)

  console.log(`[Widget] Creating widget window at (${x}, ${y}) size ${currentWidgetWidth}x${currentWidgetHeight} mode=${config.placementMode || 'docked'}`)

  widgetWindow = new BrowserWindow({
    x,
    y,
    width: currentWidgetWidth,
    height: currentWidgetHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: isFloating && (config.alwaysOnTop !== false),
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true, // 마우스 클릭 이벤트가 정상적으로 DOM에 전달되도록 true 유지
    show: false,
    title: '', // 불필요한 시스템 타이틀 노출 원천 차단
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  if (isFloating && config.alwaysOnTop !== false) {
    widgetWindow.setAlwaysOnTop(true, 'screen-saver', 9999)
  }
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  widgetWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[WidgetWindow] Load failed:', code, desc, url)
  })

  widgetWindow.webContents.on('console-message', (_e, _level, msg) => {
    console.log('[WidgetWindow Console]:', msg)
  })

  widgetWindow.once('ready-to-show', async () => {
    widgetWindow?.showInactive()
    await updateWidgetBounds()
    if (widgetWindow) {
      applyWindowTopmost(accountStore.getConfig())
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    widgetWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#view=widget`)
  } else {
    widgetWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'view=widget', query: { view: 'widget' } })
  }

  widgetWindow.on('closed', () => {
    widgetWindow = null
  })
}

async function positionPopupWindow() {
  if (!popupWindow || popupWindow.isDestroyed()) return
  const config = accountStore.getConfig()

  let widgetX: number
  let widgetY: number
  let widgetW: number

  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (config.placementMode !== 'floating') {
      // docked 모드에서는 widgetWindow.getBounds()가 taskbar client 상대좌표이므로
      // TaskbarDock.exe getscreenrect로 화면 절대 좌표를 정확히 획득
      const screenRect = await TaskbarDocker.getWidgetScreenRect(widgetWindow)
      if (screenRect) {
        widgetX = screenRect.x
        widgetY = screenRect.y
        widgetW = screenRect.width
      } else {
        const bounds = widgetWindow.getBounds()
        widgetX = bounds.x
        widgetY = bounds.y
        widgetW = bounds.width
      }
    } else {
      const bounds = widgetWindow.getBounds()
      widgetX = bounds.x
      widgetY = bounds.y
      widgetW = bounds.width
    }
  } else {
    const pos = calculateWidgetPosition(config, currentWidgetWidth, currentWidgetHeight)
    widgetX = pos.x
    widgetY = pos.y
    widgetW = currentWidgetWidth
  }

  const popupPos = calculatePopupPosition(widgetX, widgetW, POPUP_WIDTH, POPUP_HEIGHT, widgetY)

  popupWindow.setBounds({
    x: popupPos.x,
    y: popupPos.y,
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT
  })
}

function createPopupWindow() {
  const config = accountStore.getConfig()
  const widgetPos = calculateWidgetPosition(config, currentWidgetWidth, currentWidgetHeight)
  const actualWidgetY = (widgetWindow && !widgetWindow.isDestroyed()) ? widgetWindow.getBounds().y : widgetPos.y
  const popupPos = calculatePopupPosition(widgetPos.x, currentWidgetWidth, POPUP_WIDTH, POPUP_HEIGHT, actualWidgetY)

  popupWindow = new BrowserWindow({
    x: popupPos.x,
    y: popupPos.y,
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    title: '', // 불필요한 타이틀 제거
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  popupWindow.setAlwaysOnTop(true, 'screen-saver', 9999)

  if (process.env.VITE_DEV_SERVER_URL) {
    popupWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#view=popup`)
  } else {
    popupWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'view=popup', query: { view: 'popup' } })
  }

  popupWindow.on('blur', () => {
    if (!isPopupLocked) {
      scheduleHidePopup(600)
    }
  })

  popupWindow.on('closed', () => {
    popupWindow = null
  })
}

async function showPopup(focus = false, lock = false) {
  cancelHidePopup()
  if (lock) {
    isPopupLocked = true
  }

  if (!popupWindow || popupWindow.isDestroyed()) {
    createPopupWindow()
  }
  if (!popupWindow) return
  const isAlreadyVisible = popupWindow.isVisible()

  if (!isAlreadyVisible) {
    // 팝업이 닫혀 있다가 새로 열릴 때만 위젯의 현재 위치를 기준으로 좌표를 결정하여 띄움 (뜬 후에는 자리 고정)
    await positionPopupWindow()

    // 숨긴 창을 다시 show하면 숨기기 직전의 마지막 프레임(완전히 열린 팝업)이 잠깐 보인 뒤
    // 등장 애니메이션이 처음부터 재생되어 두 번 열리는 것처럼 보임. 투명하게 띄워두고
    // 렌더러가 애니메이션 첫 프레임을 그렸다고 알려오면(POPUP_READY) 불투명으로 전환한다.
    popupWindow.setOpacity(0)
    if (popupRevealTimer) clearTimeout(popupRevealTimer)
    popupRevealTimer = setTimeout(revealPopup, 300) // 렌더러 응답이 없어도 팝업이 안 보이는 일은 없도록

    if (focus) {
      popupWindow.show()
      popupWindow.focus()
    } else {
      popupWindow.showInactive()
    }
    popupWindow.webContents.send(IPC_CHANNELS.POPUP_OPENED, getAppState())
  } else if (focus) {
    popupWindow.focus()
  }
}

function revealPopup() {
  if (popupRevealTimer) {
    clearTimeout(popupRevealTimer)
    popupRevealTimer = null
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.setOpacity(1)
  }
}

function scheduleHidePopup(delayMs = 400) {
  if (isPopupLocked) {
    return
  }
  cancelHidePopup()
  popupHideTimer = setTimeout(() => {
    if (!isPopupLocked) {
      hidePopup(true)
    }
    popupHideTimer = null
  }, delayMs)
}

function cancelHidePopup() {
  if (popupHideTimer) {
    clearTimeout(popupHideTimer)
    popupHideTimer = null
  }
}

function hidePopup(force = false) {
  if (!force && isPopupLocked) {
    return
  }
  isPopupLocked = false
  cancelHidePopup()
  if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
    popupWindow.hide()
  }
}

function handleDockedWidgetClick() {
  const config = accountStore.getConfig()

  if (config.doubleClickToOpenPopup !== true) {
    lastDockedWidgetClickAt = 0
    void togglePopup()
    return
  }

  const now = Date.now()
  if (lastDockedWidgetClickAt > 0 && now - lastDockedWidgetClickAt <= DOUBLE_CLICK_WINDOW_MS) {
    lastDockedWidgetClickAt = 0
    void togglePopup()
  } else {
    lastDockedWidgetClickAt = now
  }
}

async function togglePopup() {
  cancelHidePopup()
  if (popupWindow && popupWindow.isVisible()) {
    hidePopup(true)
  } else {
    await showPopup(true, true) // 클릭으로 열 때는 닫기 버튼 누를 때까지 락 유지
  }
}

function getTrayIconImage(): Electron.NativeImage {
  const candidates = [
    path.join(__dirname, '../public/tray-icon.ico'),
    path.join(__dirname, '../public/tray-icon.png'),
    path.join(app.getAppPath(), 'public/tray-icon.ico'),
    path.join(app.getAppPath(), 'public/tray-icon.png'),
    path.join(process.resourcesPath, 'public/tray-icon.ico'),
    path.join(process.resourcesPath, 'public/tray-icon.png')
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }

  // fallback
  return nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA9SURBVDhPY/wPBAwUACZSDaBkwzCgZANiDGDFyAbA5EkaBt0AYgwkGQwDYAYzEaMZZQZgBmgwA9F/IGAAAGXvCflG0g+xAAAAAElFTkSuQmCC',
      'base64'
    )
  )
}

function applyAutoLaunch(enable: boolean) {
  try {
    if (!app.isPackaged) {
      // 개발 모드에서는 node_modules/electron/dist/electron.exe가 인자 없이 시작프로그램에 등록되어
      // 부팅 시 기본 Electron 환영 창이 뜨는 현상을 방지하기 위해 등록을 해제합니다.
      app.setLoginItemSettings({
        openAtLogin: false,
        path: process.execPath
      })
      updateTrayMenu()
      return
    }

    app.setLoginItemSettings({
      openAtLogin: enable,
      path: process.execPath,
      args: ['--hidden']
    })
    updateTrayMenu()
  } catch (err) {
    console.warn('[Main] Failed to setLoginItemSettings:', err)
  }
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return
  const config = accountStore.getConfig()
  const isAutoStart = app.isPackaged
    ? (app.getLoginItemSettings().openAtLogin ?? config.openAtLogin ?? true)
    : (config.openAtLogin ?? false)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('trayToggleWidget'),
      click: async () => {
        if (!widgetWindow) return
        if (widgetWindow.isVisible()) {
          widgetManuallyHidden = true
          widgetWindow.hide()
          hidePopup(true)
        } else {
          widgetManuallyHidden = false
          widgetHiddenForFullscreen = false
          widgetWindow.show()
          await updateWidgetBounds()
        }
      }
    },
    {
      label: t('trayOpenPopup'),
      click: () => {
        showPopup(true, true)
      }
    },
    { type: 'separator' },
    {
      label: t('trayAutoLaunch'),
      type: 'checkbox',
      checked: isAutoStart,
      click: (item) => {
        const nextConfig = { ...accountStore.getConfig(), openAtLogin: item.checked }
        accountStore.saveConfig(nextConfig)
        applyAutoLaunch(item.checked)
        broadcastState()
      }
    },
    {
      label: t('trayRefreshNow'),
      click: () => {
        quotaManager.refreshAll().then(() => broadcastState())
      }
    },
    { type: 'separator' },
    {
      label: t('trayQuit'),
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
}

function createTray() {
  const iconCanvas = getTrayIconImage()
  tray = new Tray(iconCanvas)
  tray.setToolTip(t('trayTooltip'))

  updateTrayMenu()

  tray.on('click', () => {
    togglePopup()
  })
}

function setupIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.GET_STATE, () => {
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_CONFIG, async (_event, patch: Partial<WidgetConfig>) => {
    const prevConfig = accountStore.getConfig()
    const nextConfig: WidgetConfig = { ...prevConfig, ...patch }
    accountStore.saveConfig(nextConfig)

    if (patch.doubleClickToOpenPopup !== undefined || patch.placementMode !== undefined) {
      lastDockedWidgetClickAt = 0
    }

    // 윈도우 시작 시 실행 설정 변경 시 적용
    if (patch.openAtLogin !== undefined && prevConfig.openAtLogin !== nextConfig.openAtLogin) {
      applyAutoLaunch(Boolean(nextConfig.openAtLogin))
    }

    // 갱신 주기 변경 시 폴링 인터벌 동적 재적용
    if (patch.refreshIntervalSec !== undefined && prevConfig.refreshIntervalSec !== nextConfig.refreshIntervalSec) {
      quotaManager.startPolling(nextConfig.refreshIntervalSec, false)
    }

    // 모드 전환 감지 (docked <-> floating)
    if (patch.placementMode !== undefined && prevConfig.placementMode !== nextConfig.placementMode && widgetWindow && !widgetWindow.isDestroyed()) {
      if (nextConfig.placementMode === 'floating') {
        currentWidgetHeight = FLOATING_WIDGET_HEIGHT
        TaskbarDocker.stopDockWatcher()
        await TaskbarDocker.undockWindow(widgetWindow)
      } else {
        TaskbarDocker.stopStayTop()
        widgetWindow.setAlwaysOnTop(false)
      }
    }

    await updateWidgetBounds()
    applyWindowTopmost(nextConfig)
    // [불변 원칙]: 팝업창은 최초 등장 시점에만 위젯 위치 기준으로 좌표를 설정합니다.
    // 사용자가 팝업창을 열고 조작(슬라이더 등)하는 동안에는 팝업 위치가 이동하면 안 되므로
    // 설정 변경(UPDATE_CONFIG) 시 positionPopupWindow()를 절대 호출하지 않습니다.
    broadcastState()
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.REFRESH_QUOTA, async () => {
    await quotaManager.refreshAll()
    broadcastState()
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.ADD_CUSTOM_ACCOUNT, (_event, acc: Partial<AccountConfig>) => {
    const newAcc: AccountConfig = {
      id: acc.id || `custom-${Date.now()}`,
      name: acc.name || 'Custom Account',
      provider: acc.provider || 'custom',
      enabled: true,
      customMock: acc.customMock || {
        primaryPercent: 50,
        primaryReset: '2h 30m',
        weeklyPercent: 30,
        weeklyReset: '4d 12h',
        iconLetter: (acc.name || 'C').charAt(0).toUpperCase(),
        brandColor: '#3B82F6'
      }
    }
    accountStore.addAccount(newAcc)
    broadcastState()
    quotaManager.refreshAll().finally(() => broadcastState())
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.RESTORE_DETECTED_APP, (_event, appData: any) => {
    accountStore.restoreDetectedAccount(appData)
    broadcastState()
    quotaManager.refreshAll().finally(() => broadcastState())
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.RESET_DEFAULT_ACCOUNTS, () => {
    accountStore.resetToDefaultAccounts()
    broadcastState()
    quotaManager.refreshAll().finally(() => broadcastState())
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.TOGGLE_ACCOUNT, (_event, id: string, enabled: boolean) => {
    accountStore.toggleAccount(id, enabled)
    broadcastState()
    quotaManager.refreshAll().finally(() => broadcastState())
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.REMOVE_ACCOUNT, (_event, id: string) => {
    accountStore.removeAccount(id)
    broadcastState()
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.REORDER_ACCOUNT, (_event, id: string, direction: 'up' | 'down') => {
    accountStore.reorderAccount(id, direction)
    broadcastState()
    return getAppState()
  })

  ipcMain.handle(IPC_CHANNELS.SHOW_POPUP, async () => {
    await showPopup(false, false)
  })

  ipcMain.handle(IPC_CHANNELS.HIDE_POPUP, () => {
    hidePopup(true)
  })

  ipcMain.handle(IPC_CHANNELS.TOGGLE_POPUP, async () => {
    await togglePopup()
  })

  ipcMain.handle(IPC_CHANNELS.LOCK_POPUP, () => {
    isPopupLocked = true
    cancelHidePopup()
  })

  ipcMain.handle(IPC_CHANNELS.UNLOCK_POPUP, () => {
    isPopupLocked = false
  })

  ipcMain.handle(IPC_CHANNELS.RESIZE_WIDGET, async (_event, width: number, height: number) => {
    if (width > 0 && height > 0) {
      currentWidgetWidth = Math.round(width)
      currentWidgetHeight = Math.round(height)
      await updateWidgetBounds()
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_SETTINGS, async () => {
    await showPopup(true, true)
  })

  ipcMain.handle(IPC_CHANNELS.DETECT_LOCAL_APPS, async () => {
    return await LocalAppDetector.detectAll()
  })

  ipcMain.handle(IPC_CHANNELS.SCHEDULE_HIDE_POPUP, (_event, delayMs?: number) => {
    scheduleHidePopup(delayMs || 400)
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_HIDE_POPUP, () => {
    cancelHidePopup()
  })

  ipcMain.handle(IPC_CHANNELS.POPUP_READY, () => {
    revealPopup()
  })
}

app.whenReady().then(() => {
  accountStore = new AccountStore()
  quotaManager = new QuotaManager(accountStore)

  quotaManager.addListener(() => {
    broadcastState()
  })

  setupIpcHandlers()
  createWidgetWindow()
  createPopupWindow()
  createTray()
  applyAutoLaunch(accountStore.getConfig().openAtLogin ?? true)

  quotaManager.startPolling(accountStore.getConfig().refreshIntervalSec)

  setInterval(() => {
    if (widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()) {
      const cfg = accountStore.getConfig()
      if (cfg.placementMode === 'floating') {
        widgetWindow.moveTop()
      }
    }
  }, 2000)

  TaskbarDocker.startFullscreenWatcher(widgetWindow!, (isFullscreen) => {
    if (!widgetWindow || widgetWindow.isDestroyed() || widgetManuallyHidden) return
    const cfg = accountStore.getConfig()
    if (cfg.placementMode === 'floating') {
      if (isFullscreen && widgetWindow.isVisible()) {
        widgetHiddenForFullscreen = true
        widgetWindow.hide()
        hidePopup(true)
      } else if (!isFullscreen && widgetHiddenForFullscreen) {
        widgetHiddenForFullscreen = false
        widgetWindow.show()
        updateWidgetBounds()
      }
    }
  })

  // 디스플레이 해상도, 작업표시줄 크기 변화 또는 모니터 연결/해제 시 위젯 위치 재배치
  const onScreenChange = () => {
    updateWidgetBounds()
  }
  screen.on('display-metrics-changed', onScreenChange)
  screen.on('display-added', onScreenChange)
  screen.on('display-removed', onScreenChange)
})

app.on('window-all-closed', () => {
  // 트레이에 상주하므로 창이 닫혀도 앱 종료 방지
})

app.on('before-quit', () => {
  cancelHidePopup()
  if (quotaManager) {
    quotaManager.stopPolling()
  }
  TaskbarDocker.stopStayTop()
  TaskbarDocker.stopFullscreenWatcher()
  TaskbarDocker.stopDockWatcher()
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const cfg = accountStore.getConfig()
    if (cfg.placementMode !== 'floating') {
      TaskbarDocker.undockWindow(widgetWindow)
    }
  }
  CodexAppServerClient.close()
  if (tray) {
    try {
      tray.destroy()
    } catch {}
    tray = null
  }
})
