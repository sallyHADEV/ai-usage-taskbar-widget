import { spawn, execFile, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { app, screen, type BrowserWindow } from 'electron'
import type { WidgetConfig } from '../common/types.js'
import { calculateWidgetPosition } from './taskbar-position.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface DockResult {
  success: boolean
  taskbarHwnd?: string
  widgetHwnd?: string
  clientRect?: { x: number; y: number; width: number; height: number }
  screenRect?: { x: number; y: number; width: number; height: number }
  dpi?: number
  rawOutput?: string
  error?: string
}

export class TaskbarDocker {
  private static dockerExePath: string | null = null
  private static stayTopProcess: ChildProcess | null = null
  private static fsWatchProcess: ChildProcess | null = null
  private static healthCheckTimer: NodeJS.Timeout | null = null
  private static lastTaskbarHwnd: string | null = null

  public static getDockerPath(): string {
    if (this.dockerExePath && fs.existsSync(this.dockerExePath)) return this.dockerExePath

    const candidates = [
      path.join(app.getAppPath(), 'native/TaskbarDock.exe'),
      path.join(process.resourcesPath || '', 'native/TaskbarDock.exe'),
      path.join(path.dirname(app.getPath('exe')), 'native/TaskbarDock.exe'),
      path.join(__dirname, '../../native/TaskbarDock.exe'),
      path.join(__dirname, '../native/TaskbarDock.exe')
    ]

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        this.dockerExePath = p
        return p
      }
    }

    this.dockerExePath = candidates[0]
    return this.dockerExePath
  }

  public static getHwnd(win: BrowserWindow): string {
    const handleBuf = win.getNativeWindowHandle()
    try {
      const hwndBig = handleBuf.readBigUInt64LE(0)
      return '0x' + hwndBig.toString(16)
    } catch {
      const hwndInt = handleBuf.readUInt32LE(0)
      return '0x' + hwndInt.toString(16)
    }
  }

  /**
   * Windows 작업표시줄(Shell_TrayWnd 또는 Shell_SecondaryTrayWnd)의 child HWND로 위젯 도킹
   */
  public static async dockWindow(
    win: BrowserWindow,
    config: WidgetConfig,
    width: number,
    height: number
  ): Promise<DockResult> {
    if (!win || win.isDestroyed()) {
      return { success: false, error: 'Window is destroyed or null' }
    }

    const exe = this.getDockerPath()
    if (!fs.existsSync(exe)) {
      console.warn('[TaskbarDocker] Docker executable not found:', exe)
      return { success: false, error: 'Executable not found' }
    }

    const hwnd = this.getHwnd(win)
    const align = config.alignment || 'right'
    const offset = config.offsetPx ?? 12
    const vOffset = config.verticalOffsetPx ?? 0

    // 대상 모니터 영역 추출
    const display = screen.getDisplayMatching(win.getBounds()) || screen.getPrimaryDisplay()
    const mon = display.bounds
    const monStr = `${mon.x},${mon.y},${mon.x + mon.width},${mon.y + mon.height}`

    const args = [
      'dock',
      hwnd,
      String(width),
      String(height),
      align,
      String(offset),
      String(vOffset),
      monStr
    ]

    console.log(`[TaskbarDocker] Docking HWND ${hwnd} with args:`, args.join(' '))

    try {
      const { stdout } = await execFileAsync(exe, args, { windowsHide: true })
      const out = stdout.trim()
      console.log(`[TaskbarDocker] Dock execution output:\n${out}`)

      if (out.includes('DOCKED_OK')) {
        // DOCKED_OK taskbar:0x... widget:0x... client:x,y,w,h screen:x,y,w,h dpi:...
        const taskbarMatch = out.match(/taskbar:(0x[0-9a-fA-F]+)/)
        const widgetMatch = out.match(/widget:(0x[0-9a-fA-F]+)/)
        const clientMatch = out.match(/client:([-\d]+),([-\d]+),([-\d]+),([-\d]+)/)
        const screenMatch = out.match(/screen:([-\d]+),([-\d]+),([-\d]+),([-\d]+)/)
        const dpiMatch = out.match(/dpi:(\d+)/)

        if (taskbarMatch) {
          this.lastTaskbarHwnd = taskbarMatch[1]
        }

        return {
          success: true,
          taskbarHwnd: taskbarMatch?.[1],
          widgetHwnd: widgetMatch?.[1] || hwnd,
          clientRect: clientMatch ? {
            x: parseInt(clientMatch[1], 10),
            y: parseInt(clientMatch[2], 10),
            width: parseInt(clientMatch[3], 10),
            height: parseInt(clientMatch[4], 10)
          } : undefined,
          screenRect: screenMatch ? {
            x: parseInt(screenMatch[1], 10),
            y: parseInt(screenMatch[2], 10),
            width: parseInt(screenMatch[3], 10),
            height: parseInt(screenMatch[4], 10)
          } : undefined,
          dpi: dpiMatch ? parseInt(dpiMatch[1], 10) : undefined,
          rawOutput: out
        }
      }

      return { success: false, error: out, rawOutput: out }
    } catch (err: any) {
      console.error('[TaskbarDocker] Dock execution failed:', err)
      return { success: false, error: err.message, rawOutput: err.stdout }
    }
  }

  /**
   * 작업표시줄에서 분리하여 독립 창으로 복원 (플로팅 전환 시 사용)
   */
  public static async undockWindow(win: BrowserWindow): Promise<boolean> {
    if (!win || win.isDestroyed()) return false

    const exe = this.getDockerPath()
    if (!fs.existsSync(exe)) return false

    const hwnd = this.getHwnd(win)
    try {
      const { stdout } = await execFileAsync(exe, ['undock', hwnd], { windowsHide: true })
      this.lastTaskbarHwnd = null
      return stdout.includes('UNDOCKED_OK')
    } catch (err) {
      console.warn('[TaskbarDocker] Undock failed:', err)
      return false
    }
  }

  /**
   * 도킹 상태 확인 (부모 HWND가 정상적으로 유지되고 있는지 체크)
   */
  public static async checkDockStatus(win: BrowserWindow): Promise<boolean> {
    if (!win || win.isDestroyed()) return false

    const exe = this.getDockerPath()
    if (!fs.existsSync(exe)) return false

    const hwnd = this.getHwnd(win)
    const args = ['checkdock', hwnd]
    if (this.lastTaskbarHwnd) {
      args.push(this.lastTaskbarHwnd)
    }

    try {
      const { stdout } = await execFileAsync(exe, args, { windowsHide: true })
      return stdout.includes('DOCK_HEALTHY')
    } catch {
      return false
    }
  }

  /**
   * 팝업 앵커링을 위한 위젯의 실제 화면 절대 좌표(GetWindowRect) 조회
   */
  public static async getWidgetScreenRect(
    win: BrowserWindow
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    if (!win || win.isDestroyed()) return null

    const exe = this.getDockerPath()
    if (!fs.existsSync(exe)) return win.getBounds()

    const hwnd = this.getHwnd(win)
    try {
      const { stdout } = await execFileAsync(exe, ['getscreenrect', hwnd], { windowsHide: true })
      const parts = stdout.trim().split(',')
      if (parts.length === 4) {
        return {
          x: parseInt(parts[0], 10),
          y: parseInt(parts[1], 10),
          width: parseInt(parts[2], 10),
          height: parseInt(parts[3], 10)
        }
      }
    } catch (err) {
      console.warn('[TaskbarDocker] getscreenrect failed, falling back to win.getBounds():', err)
    }

    return win.getBounds()
  }

  /**
   * 도킹 헬스체크 시작 (Explorer 재시작 또는 창 분실 시 복구 콜백 호출)
   */
  public static startDockHealthCheck(win: BrowserWindow, onRepair: () => void): void {
    this.stopDockHealthCheck()
    this.healthCheckTimer = setInterval(async () => {
      if (!win || win.isDestroyed()) {
        this.stopDockHealthCheck()
        return
      }

      const isHealthy = await this.checkDockStatus(win)
      if (!isHealthy) {
        console.warn('[TaskbarDocker] Dock health check failed. Triggering re-dock repair...')
        onRepair()
      }
    }, 2000)
  }

  public static stopDockHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * 플로팅 모드 전용: staytop 프로세스 기동 (도킹 모드에서는 절대 실행하지 않음)
   */
  public static startStayTop(win: BrowserWindow, config?: WidgetConfig): void {
    if (!win || win.isDestroyed()) return
    this.stopStayTop()

    // docked 모드인 경우 실행 거부
    if (config?.placementMode === 'docked') {
      console.log('[TaskbarDocker] Skipping staytop: widget is in native docked mode')
      return
    }

    const exe = this.getDockerPath()
    if (!fs.existsSync(exe)) {
      console.warn('[TaskbarDocker] Docker executable not found for staytop:', exe)
      return
    }

    const hwnd = this.getHwnd(win)
    console.log(`[TaskbarDocker] Starting floating staytop for HWND ${hwnd}...`)

    try {
      this.stayTopProcess = spawn(exe, ['staytop', hwnd, '600'], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true
      })

      this.stayTopProcess.on('error', (err) => {
        console.warn('[TaskbarDocker] staytop process error:', err)
      })

      win.once('closed', () => {
        this.stopStayTop()
      })
    } catch (err) {
      console.error('[TaskbarDocker] Failed to spawn staytop:', err)
    }
  }

  public static stopStayTop(): void {
    if (this.stayTopProcess) {
      try {
        this.stayTopProcess.kill()
      } catch {}
      this.stayTopProcess = null
    }
  }

  /**
   * 전체화면(게임/영상) 감지를 위한 상주 워처 프로세스 (플로팅 모드 전용)
   */
  public static startFullscreenWatcher(widgetWin: BrowserWindow, onChange: (isFullscreen: boolean) => void): void {
    this.stopFullscreenWatcher()

    const exe = this.getDockerPath()
    if (!fs.existsSync(exe)) {
      console.warn('[TaskbarDocker] Docker executable not found for fswatch:', exe)
      return
    }

    try {
      const hwnd = (widgetWin && !widgetWin.isDestroyed()) ? this.getHwnd(widgetWin) : '0'
      this.fsWatchProcess = spawn(exe, ['fswatch', '1000', hwnd], { windowsHide: true })
      let buffer = ''
      this.fsWatchProcess.stdout?.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line === '1' || line === '0') {
            onChange(line === '1')
          }
        }
      })
      this.fsWatchProcess.on('error', (err) => {
        console.warn('[TaskbarDocker] fswatch process error:', err)
      })
    } catch (err) {
      console.error('[TaskbarDocker] Failed to spawn fswatch:', err)
    }
  }

  public static stopFullscreenWatcher(): void {
    if (this.fsWatchProcess) {
      try {
        this.fsWatchProcess.kill()
      } catch {}
      this.fsWatchProcess = null
    }
  }

  /**
   * 화면 및 작업표시줄 기준 절대 좌표 계산 (플로팅 모드용)
   */
  public static calculatePosition(
    config: WidgetConfig,
    width: number,
    height: number
  ): { x: number; y: number } {
    return calculateWidgetPosition(config, width, height)
  }

  /**
   * 위젯 위치 및 크기 즉각 적용 (플로팅 모드 전용)
   */
  public static applyBounds(
    win: BrowserWindow,
    config: WidgetConfig,
    width: number,
    height: number
  ): void {
    if (!win || win.isDestroyed()) return
    // [중요] docked 모드에서는 Electron setBounds가 native docked HWND를 이동하거나 resize하지 못하도록 차단
    if (config.placementMode !== 'floating') return

    const { x, y } = this.calculatePosition(config, width, height)
    win.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    })
  }
}
