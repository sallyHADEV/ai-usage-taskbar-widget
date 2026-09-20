import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

interface ProcessDetectionResult {
  pid: number
  csrfToken?: string
  ports: number[]
}

export class LocalLspClient {
  private static cachedResult?: ProcessDetectionResult
  private static lastDetectTime = 0
  private static readonly DETECT_CACHE_TTL = 30000 // 30초 캐시

  public static async detectProcess(force = false): Promise<ProcessDetectionResult | null> {
    const now = Date.now()
    if (!force && this.cachedResult && (now - this.lastDetectTime < this.DETECT_CACHE_TTL)) {
      return this.cachedResult
    }

    try {
      // 1. Get-Process로 초고속 PID 추출 (~50ms)
      // language_server* 로 Antigravity Desktop(language_server) 및 Antigravity IDE(language_server_windows_x64) 모두 감지
      const { stdout: pidOut } = await execAsync(
        'powershell -NoProfile -Command "try { (Get-Process language_server* -ErrorAction SilentlyContinue).Id } catch {}"',
        { timeout: 2500, windowsHide: true }
      )

      const pids = pidOut.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      if (pids.length === 0) {
        this.cachedResult = undefined
        return null
      }

      let bestProc: ProcessDetectionResult | null = null

      // 2. 감지된 PID들 중 유효한 LSP 프로세스 선별 (--enable_lsp 우선)
      for (const pidStr of pids) {
        const pid = parseInt(pidStr, 10)
        if (!pid) continue

        try {
          const { stdout: cmdOut } = await execAsync(
            `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine"`,
            { timeout: 2500, windowsHide: true }
          )

          const cmdLine = cmdOut.trim()
          const csrfMatch = cmdLine.match(/--csrf_token\s+([a-zA-Z0-9-]+)/i) || cmdLine.match(/--csrf_token=([a-zA-Z0-9-]+)/i)
          const csrfToken = csrfMatch ? csrfMatch[1] : undefined
          const isEnableLsp = cmdLine.includes('--enable_lsp')

          // 3. netstat으로 해당 PID의 127.0.0.1 LISTENING 포트 탐색
          const { stdout: netOut } = await execAsync(`netstat -ano | findstr ${pid}`, { timeout: 2500, windowsHide: true })
          const ports: number[] = []
          for (const line of netOut.split('\n')) {
            if (line.includes('LISTENING')) {
              const m = line.match(/127\.0\.0\.1:(\d+)/)
              if (m) {
                ports.push(parseInt(m[1], 10))
              }
            }
          }

          const uniquePorts = [...new Set(ports)]
          if (uniquePorts.length > 0) {
            const procInfo: ProcessDetectionResult = { pid, csrfToken, ports: uniquePorts }
            if (isEnableLsp) {
              bestProc = procInfo
              break
            } else if (!bestProc) {
              bestProc = procInfo
            }
          }
        } catch {}
      }

      if (bestProc) {
        this.cachedResult = bestProc
        this.lastDetectTime = now
        return bestProc
      }

      this.cachedResult = undefined
      return null
    } catch (e) {
      console.warn('[LocalLspClient] Fast process detection error:', e)
      return this.cachedResult || null
    }
  }
}
