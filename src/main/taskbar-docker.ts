import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { app, screen, type BrowserWindow } from 'electron'
import type { WidgetConfig } from '../common/types.js'
import { calculateWidgetPosition, getTaskbarInfo } from './taskbar-position.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class TaskbarDocker {
  private static dockerExePath: string | null = null
  private static stayTopProcess: ChildProcess | null = null
  private static fsWatchProcess: ChildProcess | null = null

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
   * 포커스를 잃어도 작업표시줄 뒤로 숨지 않도록 네이티브 HWND_TOPMOST & NOACTIVATE 상시 유지
   */
  public static startStayTop(win: BrowserWindow): void {
    if (!win || win.isDestroyed()) return
    this.stopStayTop()

    const exe = this.getDockerPath()
    if (!fs.existsSync(exe)) {
      console.warn('[TaskbarDocker] Docker executable not found for staytop:', exe)
      return
    }

    const hwnd = this.getHwnd(win)
    console.log(`[TaskbarDocker] Starting bulletproof staytop for HWND ${hwnd}...`)

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
   * 전체화면(게임/영상) 감지를 위한 상주 워처 프로세스 1개만 기동 (짧은 주기로 매번 새 프로세스를
   * spawn하면 .NET 프로세스 기동 비용 때문에 시스템 전역에 커서 busy 현상이 생겨 상주 방식으로 변경)
   * 상태가 바뀔 때만 stdout에 "1"/"0" 한 줄이 오므로 그때만 콜백 호출
   */
  public static startFullscreenWatcher(onChange: (isFullscreen: boolean) => void): void {
    this.stopFullscreenWatcher()

    const exe = this.getDockerPath()
    if (!fs.existsSync(exe)) {
      console.warn('[TaskbarDocker] Docker executable not found for fswatch:', exe)
      return
    }

    try {
      this.fsWatchProcess = spawn(exe, ['fswatch', '1000'], { windowsHide: true })
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
   * 화면 및 작업표시줄 기준 절대 좌표 계산 (정확한 좌/우측 정렬 보장)
   */
  public static calculatePosition(
    config: WidgetConfig,
    width: number,
    height: number
  ): { x: number; y: number } {
    return calculateWidgetPosition(config, width, height)
  }

  /**
   * 위젯 위치 및 크기 즉각 적용
   */
  public static applyBounds(
    win: BrowserWindow,
    config: WidgetConfig,
    width: number,
    height: number
  ): void {
    if (!win || win.isDestroyed()) return
    const { x, y } = this.calculatePosition(config, width, height)
    win.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    })
  }
}
