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
   * 현재 포그라운드 창이 모니터 전체를 덮는 전체화면 상태인지 확인 (게임/영상 전체화면 시 위젯 자동 숨김용)
   */
  public static checkForegroundFullscreen(): Promise<boolean> {
    return new Promise((resolve) => {
      const exe = this.getDockerPath()
      if (!fs.existsSync(exe)) {
        resolve(false)
        return
      }

      try {
        const proc = spawn(exe, ['isfgfullscreen'], { windowsHide: true })
        let output = ''
        proc.stdout?.on('data', (chunk) => { output += chunk.toString() })
        proc.on('error', () => resolve(false))
        proc.on('close', () => resolve(output.trim() === '1'))
      } catch {
        resolve(false)
      }
    })
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
