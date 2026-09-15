import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { app } from 'electron'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage, ModelQuotaDetail } from '../common/types.js'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: NodeJS.Timeout
}

export class CodexAppServerClient {
  private static childProcess: ChildProcess | null = null
  private static rl: readline.Interface | null = null
  private static nextId = 1
  private static pendingRequests = new Map<number, PendingRequest>()
  private static isInitialized = false
  private static cachedUsage?: AccountUsage
  private static lastFetchTime = 0
  private static executablePath: string | null = null

  /**
   * 로컬에 설치된 codex.exe 바이너리 탐색
   * (Codex Desktop, VSCode/Windsurf 확장 프로그램, PATH 등)
   */
  public static findCodexExecutable(): string | null {
    if (this.executablePath && fs.existsSync(this.executablePath)) {
      return this.executablePath
    }

    // 1. 환경변수 우선 확인
    if (process.env.CODEX_EXECUTABLE && fs.existsSync(process.env.CODEX_EXECUTABLE)) {
      this.executablePath = process.env.CODEX_EXECUTABLE
      return this.executablePath
    }

    const candidates: string[] = []

    // 2. Windows LocalAppData의 OpenAI Codex Desktop 바이너리 탐색
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const codexBinDir = path.join(localAppData, 'OpenAI', 'Codex', 'bin')
    if (fs.existsSync(codexBinDir)) {
      try {
        const subdirs = fs.readdirSync(codexBinDir)
        for (const sub of subdirs) {
          const exePath = path.join(codexBinDir, sub, 'codex.exe')
          if (fs.existsSync(exePath)) {
            candidates.push(exePath)
          }
        }
      } catch {}
    }

    // 3. VS Code / Windsurf 확장 프로그램 경로 탐색
    const homeDir = os.homedir()
    const extDirs = [
      path.join(homeDir, '.vscode', 'extensions'),
      path.join(homeDir, '.windsurf', 'extensions')
    ]
    for (const extDir of extDirs) {
      if (fs.existsSync(extDir)) {
        try {
          const subdirs = fs.readdirSync(extDir)
          for (const sub of subdirs) {
            if (sub.startsWith('openai.chatgpt-')) {
              const exePath = path.join(extDir, sub, 'bin', 'windows-x86_64', 'codex.exe')
              if (fs.existsSync(exePath)) {
                candidates.push(exePath)
              }
            }
          }
        } catch {}
      }
    }

    // 4. 가장 최근에 수정된 바이너리 선택
    if (candidates.length > 0) {
      let newestPath = candidates[0]
      let newestMtime = 0
      for (const p of candidates) {
        try {
          const stat = fs.statSync(p)
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs
            newestPath = p
          }
        } catch {}
      }
      this.executablePath = newestPath
      return newestPath
    }

    return null
  }

  /**
   * codex app-server 프로세스 실행 및 JSON-RPC 연결
   */
  private static async ensureConnected(): Promise<void> {
    if (this.childProcess && this.isInitialized && !this.childProcess.killed) {
      return
    }

    this.close()

    const executable = this.findCodexExecutable()
    if (!executable) {
      throw new Error('Codex 실행 파일(codex.exe)을 찾을 수 없습니다.')
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false

      try {
        this.childProcess = spawn(executable, ['app-server'], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore']
        })

        if (!this.childProcess.stdin || !this.childProcess.stdout) {
          this.close()
          return reject(new Error('Codex app-server stdio 파이프 열기 실패'))
        }

        this.rl = readline.createInterface({
          input: this.childProcess.stdout,
          crlfDelay: Infinity
        })

        this.rl.on('line', (line: string) => {
          this.handleLine(line)
        })

        this.childProcess.on('error', (err) => {
          console.warn('[CodexAppServer] Process error:', err)
          this.close()
          if (!settled) {
            settled = true
            reject(err)
          }
        })

        this.childProcess.on('exit', () => {
          this.close()
        })

        // 앱 종료 시 프로세스 확실한 정리
        if (app) {
          app.once('before-quit', () => this.close())
        }
        process.once('exit', () => this.close())

        // JSON-RPC 핸드셰이크: initialize -> initialized
        this.sendRequest('initialize', {
          clientInfo: {
            name: 'ai_usage_widget',
            title: 'AI Usage Widget',
            version: '1.0.0'
          },
          capabilities: {
            experimentalApi: true
          }
        }, 5000)
          .then(() => {
            this.sendNotification('initialized', {})
            this.isInitialized = true
            if (!settled) {
              settled = true
              resolve()
            }
          })
          .catch((err) => {
            this.close()
            if (!settled) {
              settled = true
              reject(err)
            }
          })
      } catch (err) {
        this.close()
        if (!settled) {
          settled = true
          reject(err)
        }
      }
    })
  }

  private static handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const msg = JSON.parse(trimmed)
      if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
        const req = this.pendingRequests.get(msg.id)!
        this.pendingRequests.delete(msg.id)
        clearTimeout(req.timer)

        if (msg.error) {
          req.reject(new Error(msg.error.message || 'Codex app-server error'))
        } else {
          req.resolve(msg.result)
        }
      }
    } catch {
      // JSON 파싱 무시 (로그 메시지 등)
    }
  }

  private static sendRequest<T = any>(method: string, params: any = {}, timeoutMs = 4000): Promise<T> {
    if (!this.childProcess?.stdin || this.childProcess.killed) {
      return Promise.reject(new Error('Codex app-server is not running'))
    }

    const id = this.nextId++
    const payload = JSON.stringify({ method, id, params }) + '\n'

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Codex app-server request '${method}' timed out (${timeoutMs}ms)`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer })

      try {
        this.childProcess!.stdin!.write(payload)
      } catch (err) {
        this.pendingRequests.delete(id)
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  private static sendNotification(method: string, params: any = {}): void {
    if (!this.childProcess?.stdin || this.childProcess.killed) return
    const payload = JSON.stringify({ method, params }) + '\n'
    try {
      this.childProcess.stdin.write(payload)
    } catch {}
  }

  public static close(): void {
    this.isInitialized = false
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer)
      req.reject(new Error('Codex app-server closed'))
    }
    this.pendingRequests.clear()

    if (this.rl) {
      try { this.rl.close() } catch {}
      this.rl = null
    }

    if (this.childProcess) {
      try {
        if (!this.childProcess.killed) {
          this.childProcess.kill('SIGTERM')
        }
      } catch {}
      this.childProcess = null
    }
  }

  /**
   * codex app-server를 통해 공식 실시간 사용량 조회
   */
  public static async fetchUsage(account: AccountConfig): Promise<AccountUsage | null> {
    const now = Date.now()
    // 10초 캐시
    if (this.cachedUsage && (now - this.lastFetchTime < 10000)) {
      return { ...this.cachedUsage, id: account.id, name: account.name }
    }

    await this.ensureConnected()

    // 1. 계정 정보 확인
    const accountRes = await this.sendRequest('account/read', { refreshToken: false }, 3500)
    const accountInfo = accountRes?.account
    if (!accountInfo) {
      throw new Error('Codex에 로그인되어 있지 않습니다.')
    }

    const email = accountInfo.email || ''
    const planTypeRaw = accountInfo.planType || accountInfo.type || 'Plus'
    const planName = this.formatPlanName(planTypeRaw)

    // 2. 실시간 한도(RateLimits) 조회
    const limitsRes = await this.sendRequest('account/rateLimits/read', {}, 3500)
    const rateLimits = limitsRes?.rateLimits || (limitsRes?.rateLimitsByLimitId && Object.values(limitsRes.rateLimitsByLimitId)[0])

    if (!rateLimits) {
      throw new Error('Codex 레이트리밋 정보가 비어 있습니다.')
    }

    const isPro = planTypeRaw.toLowerCase() === 'pro' || String(rateLimits.planType).toLowerCase() === 'pro'

    const primaryLimit = rateLimits.primary
    const secondaryLimit = rateLimits.secondary

    const primaryWindowMins = Number(primaryLimit?.windowDurationMins) || 0
    const secondaryWindowMins = Number(secondaryLimit?.windowDurationMins) || 0

    // Pro 플랜이거나, 5시간 세션 쿼터 없이 1주일(주간) 쿼터만 단독 제공되는 경우 판별
    const isWeeklyOnly = isPro ||
      (!primaryLimit && !!secondaryLimit) ||
      (primaryWindowMins >= 1440)

    const models: ModelQuotaDetail[] = []

    let sessionLeft = 100
    let sessionUsed = 0
    let sessionResetIso: string | undefined
    let sessionCountdown = '--'

    let weeklyLeft = 100
    let weeklyUsed = 0
    let weeklyResetIso: string | undefined
    let weeklyCountdown = '--'

    if (isWeeklyOnly) {
      // 주간 한도 데이터 소스 선택: primary가 주간(>=1440분)이면 primary 우선, 아니면 secondary
      const weeklySource = (primaryWindowMins >= 1440 ? primaryLimit : (secondaryLimit || primaryLimit)) || {}
      weeklyUsed = Math.min(100, Math.max(0, Math.round(Number(weeklySource.usedPercent) || 0)))
      weeklyLeft = Math.max(0, 100 - weeklyUsed)
      const weeklyResetSec = Number(weeklySource.resetsAt) || 0
      weeklyResetIso = weeklyResetSec > 0 ? new Date(weeklyResetSec * 1000).toISOString() : undefined
      weeklyCountdown = weeklyResetIso ? formatCountdown(weeklyResetIso) : '--'

      // Pro / 주간 단독 모드에서는 primaryQuota도 주간 데이터로 설정
      sessionUsed = weeklyUsed
      sessionLeft = weeklyLeft
      sessionResetIso = weeklyResetIso
      sessionCountdown = weeklyCountdown

      models.push({
        modelId: 'codex-weekly',
        displayName: 'Codex 주간 한도 (7일)',
        quota: {
          remainingFraction: weeklyLeft / 100,
          percentLeft: weeklyLeft,
          percentUsed: weeklyUsed,
          resetTime: weeklyResetIso,
          resetCountdown: weeklyCountdown,
          isExhausted: weeklyLeft <= 1
        }
      })
    } else {
      // Plus / 기존 5시간 세션 + 7일 주간 한도
      const pLimit = primaryLimit || {}
      sessionUsed = Math.min(100, Math.max(0, Math.round(Number(pLimit.usedPercent) || 0)))
      sessionLeft = Math.max(0, 100 - sessionUsed)
      const sessionResetSec = Number(pLimit.resetsAt) || 0
      sessionResetIso = sessionResetSec > 0 ? new Date(sessionResetSec * 1000).toISOString() : undefined
      sessionCountdown = sessionResetIso ? formatCountdown(sessionResetIso) : '--'

      const sLimit = secondaryLimit || {}
      weeklyUsed = Math.min(100, Math.max(0, Math.round(Number(sLimit.usedPercent) || 0)))
      weeklyLeft = Math.max(0, 100 - weeklyUsed)
      const weeklyResetSec = Number(sLimit.resetsAt) || 0
      weeklyResetIso = weeklyResetSec > 0 ? new Date(weeklyResetSec * 1000).toISOString() : undefined
      weeklyCountdown = weeklyResetIso ? formatCountdown(weeklyResetIso) : '--'

      models.push({
        modelId: 'codex-5h',
        displayName: 'Codex 세션 한도 (5시간)',
        quota: {
          remainingFraction: sessionLeft / 100,
          percentLeft: sessionLeft,
          percentUsed: sessionUsed,
          resetTime: sessionResetIso,
          resetCountdown: sessionCountdown,
          isExhausted: sessionLeft <= 1
        }
      })

      if (secondaryLimit && secondaryLimit.usedPercent !== undefined) {
        models.push({
          modelId: 'codex-weekly',
          displayName: 'Codex 주간 한도 (7일)',
          quota: {
            remainingFraction: weeklyLeft / 100,
            percentLeft: weeklyLeft,
            percentUsed: weeklyUsed,
            resetTime: weeklyResetIso,
            resetCountdown: weeklyCountdown,
            isExhausted: weeklyLeft <= 1
          }
        })
      }
    }

    const usage: AccountUsage = {
      id: account.id,
      name: account.name || 'Codex CLI',
      provider: 'codex',
      iconLetter: 'X',
      brandColor: '#6366F1',
      email,
      tier: `${planName} (공식 app-server)`,
      status: 'ready',
      isWeeklyOnly,
      primaryQuota: {
        remainingFraction: sessionLeft / 100,
        percentLeft: sessionLeft,
        percentUsed: sessionUsed,
        resetTime: sessionResetIso,
        resetCountdown: sessionCountdown,
        isExhausted: sessionLeft <= 1
      },
      weeklyQuota: {
        remainingFraction: weeklyLeft / 100,
        percentLeft: weeklyLeft,
        percentUsed: weeklyUsed,
        resetTime: weeklyResetIso,
        resetCountdown: weeklyCountdown,
        isExhausted: weeklyLeft <= 1
      },
      models,
      updatedAt: new Date().toISOString()
    }

    this.cachedUsage = usage
    this.lastFetchTime = now
    return usage
  }

  private static formatPlanName(raw: string): string {
    const lower = raw.toLowerCase()
    switch (lower) {
      case 'plus': return 'ChatGPT Plus'
      case 'pro': return 'ChatGPT Pro'
      case 'team': return 'ChatGPT Team'
      case 'enterprise': case 'ent26': return 'ChatGPT Enterprise'
      case 'free': return 'ChatGPT Free'
      default: return raw.charAt(0).toUpperCase() + raw.slice(1)
    }
  }
}
