import { exec } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import { promisify } from 'node:util'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage, ModelQuotaDetail } from '../common/types.js'

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
  private static workingPort?: number
  private static workingIsHttps = false

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
        this.workingPort = undefined
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
      this.workingPort = undefined
      return null
    } catch (e) {
      console.warn('[LocalLspClient] Fast process detection error:', e)
      return this.cachedResult || null
    }
  }

  private static async requestLsp(port: number, method = 'GetUserStatus', csrfToken?: string, isHttps = false): Promise<any> {
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        metadata: {
          ideName: 'antigravity',
          extensionName: 'antigravity',
          locale: 'ko'
        }
      })

      const client = isHttps ? https : http
      const req = client.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/exa.language_server_pb.LanguageServerService/${method}`,
          method: 'POST',
          rejectUnauthorized: false,
          headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            ...(csrfToken ? { 'X-Codeium-Csrf-Token': csrfToken } : {})
          },
          timeout: 2500
        },
        (res) => {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => {
            if (res.statusCode !== 200) {
              resolve(null)
              return
            }
            try {
              const json = JSON.parse(data)
              if (method === 'GetUserStatus' && json.userStatus) {
                resolve(json.userStatus)
                return
              }
              if (method === 'RetrieveUserQuotaSummary' && json.response) {
                resolve(json.response)
                return
              }
              resolve(json)
            } catch {
              resolve(null)
            }
          })
        }
      )

      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })

      req.write(payload)
      req.end()
    })
  }

  public static async fetchLocalUsage(account: AccountConfig): Promise<AccountUsage> {
    let proc: ProcessDetectionResult | null | undefined = this.cachedResult
    let userStatus: any = null
    let activePort = this.workingPort
    let activeIsHttps = this.workingIsHttps

    // 🚀 [최적화]: 기존에 성공했던 활성 포트가 있다면, 무거운 PowerShell 프로세스 탐색 없이 초경량 헬스체크 우선 시도 (~5ms)
    if (activePort && proc) {
      userStatus = await this.requestLsp(activePort, 'GetUserStatus', proc.csrfToken, activeIsHttps)
      if (!userStatus || !userStatus.email) {
        activeIsHttps = !activeIsHttps
        userStatus = await this.requestLsp(activePort, 'GetUserStatus', proc.csrfToken, activeIsHttps)
      }
      if (userStatus && userStatus.email) {
        this.workingIsHttps = activeIsHttps
      } else {
        activePort = undefined
        this.workingPort = undefined
        userStatus = null
      }
    }

    // 포트가 없거나 기존 연결이 끊긴 경우에만 프로세스 탐색 수행
    if (!userStatus || !activePort) {
      proc = await this.detectProcess(true)
      if (!proc || proc.ports.length === 0) {
        return this.getFallbackUsage(account, 'Antigravity 미실행')
      }

      // 포트 목록 순회 시도
      for (const p of proc.ports) {
        userStatus = await this.requestLsp(p, 'GetUserStatus', proc.csrfToken, false)
        if (userStatus && userStatus.email) {
          activePort = p
          activeIsHttps = false
          this.workingPort = p
          this.workingIsHttps = false
          break
        }
        userStatus = await this.requestLsp(p, 'GetUserStatus', proc.csrfToken, true)
        if (userStatus && userStatus.email) {
          activePort = p
          activeIsHttps = true
          this.workingPort = p
          this.workingIsHttps = true
          break
        }
      }
    }

    if (!userStatus || !activePort || !proc) {
      return this.getFallbackUsage(account, 'Antigravity 연결 대기 중')
    }

    const email = userStatus.email
    const planName = userStatus.planStatus?.planInfo?.planName || 'Pro'

    // 실제 네이티브 Antigravity가 호출하는 RetrieveUserQuotaSummary 조회
    let quotaSummary: any = null
    try {
      quotaSummary = await this.requestLsp(activePort, 'RetrieveUserQuotaSummary', proc.csrfToken, activeIsHttps)
    } catch {}

    const modelList: ModelQuotaDetail[] = []
    let primaryFraction = 1.0
    let primaryResetTime: string | undefined
    let weeklyFraction = 1.0
    let weeklyResetTime: string | undefined

    if (quotaSummary && Array.isArray(quotaSummary.groups)) {
      // 1. 전체 그룹(Gemini, Claude/GPT 등)의 버킷을 모두 훑어 가장 빠듯한(remainingFraction 최소) 값을 헤드라인으로 사용
      // Gemini 그룹만 보면 Claude/GPT 쿼터 소진이 위젯에 반영되지 않는 문제가 있었음
      for (const g of quotaSummary.groups) {
        if (!Array.isArray(g.buckets)) continue
        for (const b of g.buckets) {
          const isWeekly = b.window === 'weekly' || b.bucketId?.toLowerCase().includes('weekly') || b.displayName?.toLowerCase().includes('weekly')
          const is5h = b.window === '5h' || b.bucketId?.toLowerCase().includes('5h') || b.displayName?.toLowerCase().includes('five')
          const frac = typeof b.remainingFraction === 'number' ? b.remainingFraction : 1.0

          if (isWeekly && frac < weeklyFraction) {
            weeklyFraction = frac
            weeklyResetTime = b.resetTime
          } else if (is5h && frac < primaryFraction) {
            primaryFraction = frac
            primaryResetTime = b.resetTime
          }
        }
      }

      // 2. 안티그래비티 모델 목록: 가장 높은 버전 제미나이 모델 1개만 선별 등록
      const configs = userStatus.cascadeModelConfigData?.clientModelConfigs || []
      let bestGeminiModel: ModelQuotaDetail | null = null
      let bestScore = -1

      for (const m of configs) {
        const modelId = m.modelOrAlias?.model || 'model'
        const label = m.label || modelId
        const frac = typeof m.quotaInfo?.remainingFraction === 'number' ? m.quotaInfo.remainingFraction : 1.0
        const reset = m.quotaInfo?.resetTime

        const match = label.match(/gemini[\s\-_]*([0-9]+)(?:\.([0-9]+))?/i)
        if (match) {
          const major = parseInt(match[1], 10)
          const minor = match[2] ? parseInt(match[2], 10) : 0
          const isPro = label.toLowerCase().includes('pro')
          const isHigh = label.toLowerCase().includes('high')
          const score = major * 1000 + minor * 10 + (isPro ? 4 : isHigh ? 3 : 1)

          if (score > bestScore) {
            bestScore = score
            bestGeminiModel = {
              modelId,
              displayName: label,
              quota: {
                remainingFraction: frac,
                percentLeft: Math.round(frac * 100),
                percentUsed: Math.round((1.0 - frac) * 100),
                resetTime: reset,
                resetCountdown: formatCountdown(reset),
                isExhausted: frac <= 0.01
              }
            }
          }
        }
      }

      if (bestGeminiModel) {
        modelList.push(bestGeminiModel)
      } else {
        // config가 없을 경우 Gemini 대표 버킷 1개만 추가
        const geminiBucket = quotaSummary.groups.find((g: any) => g.displayName?.includes('Gemini'))?.buckets?.[0]
        if (geminiBucket) {
          const frac = typeof geminiBucket.remainingFraction === 'number' ? geminiBucket.remainingFraction : 1.0
          modelList.push({
            modelId: geminiBucket.bucketId || 'gemini-model',
            displayName: 'Gemini (대표 모델)',
            quota: {
              remainingFraction: frac,
              percentLeft: Math.round(frac * 100),
              percentUsed: Math.round((1.0 - frac) * 100),
              resetTime: geminiBucket.resetTime,
              resetCountdown: formatCountdown(geminiBucket.resetTime),
              isExhausted: frac <= 0.01
            }
          })
        }
      }
    }

    const primaryPercentUsed = Math.round((1.0 - primaryFraction) * 100)
    const weeklyPercentUsed = Math.round((1.0 - weeklyFraction) * 100)

    return {
      id: account.id,
      name: account.name || 'Antigravity IDE',
      provider: 'antigravity',
      iconLetter: 'A',
      brandColor: '#2563EB',
      email,
      tier: `${planName} (로컬 감지)`,
      status: 'ready',
      primaryQuota: {
        remainingFraction: primaryFraction,
        percentLeft: Math.round(primaryFraction * 100),
        percentUsed: primaryPercentUsed,
        resetTime: primaryResetTime,
        resetCountdown: formatCountdown(primaryResetTime),
        isExhausted: primaryFraction <= 0.01
      },
      weeklyQuota: {
        remainingFraction: weeklyFraction,
        percentLeft: Math.round(weeklyFraction * 100),
        percentUsed: weeklyPercentUsed,
        resetTime: weeklyResetTime,
        resetCountdown: formatCountdown(weeklyResetTime),
        isExhausted: weeklyFraction <= 0.01
      },
      models: modelList,
      updatedAt: new Date().toISOString()
    }
  }

  private static getFallbackUsage(account: AccountConfig, reason: string): AccountUsage {
    if (account.customMock) {
      return {
        id: account.id,
        name: account.name || 'Antigravity IDE',
        provider: 'antigravity',
        iconLetter: 'A',
        brandColor: '#2563EB',
        status: 'ready',
        tier: 'Pro (목업 모드)',
        primaryQuota: {
          remainingFraction: (100 - account.customMock.primaryPercent) / 100,
          percentLeft: 100 - account.customMock.primaryPercent,
          percentUsed: account.customMock.primaryPercent,
          resetCountdown: account.customMock.primaryReset,
          isExhausted: false
        },
        weeklyQuota: {
          remainingFraction: (100 - account.customMock.weeklyPercent) / 100,
          percentLeft: 100 - account.customMock.weeklyPercent,
          percentUsed: account.customMock.weeklyPercent,
          resetCountdown: account.customMock.weeklyReset,
          isExhausted: false
        },
        updatedAt: new Date().toISOString()
      }
    }

    return {
      id: account.id,
      name: account.name || 'Antigravity IDE',
      provider: 'antigravity',
      iconLetter: 'A',
      brandColor: '#2563EB',
      status: 'error',
      errorMessage: reason,
      primaryQuota: {
        remainingFraction: 1.0,
        percentLeft: 100,
        percentUsed: 0,
        resetCountdown: '--',
        isExhausted: false
      },
      weeklyQuota: {
        remainingFraction: 1.0,
        percentLeft: 100,
        percentUsed: 0,
        resetCountdown: '--',
        isExhausted: false
      },
      updatedAt: new Date().toISOString()
    }
  }
}
