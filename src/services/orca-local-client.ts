import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage } from '../common/types.js'

interface OrcaRuntimeMetadata {
  runtimeId?: string
  pid?: number
  transports?: Array<{
    kind: string
    endpoint: string
  }>
  authToken?: string
  startedAt?: number
}

interface OrcaRateLimitWindow {
  usedPercent: number
  windowMinutes: number
  resetsAt: number | null
  resetDescription: string | null
}

interface OrcaAccountsListResult {
  claude?: {
    accounts?: Array<{
      id: string
      email: string
    }>
    activeAccountId?: string | null
  }
  codex?: {
    accounts?: Array<any>
    systemDefault?: {
      hasAuth: boolean
      authKind: string
      email: string
      workspaceLabel: string
    }
  }
  rateLimits?: {
    claude?: {
      provider: string
      session?: OrcaRateLimitWindow | null
      weekly?: OrcaRateLimitWindow | null
      status: string
      error?: string | null
    }
    codex?: {
      provider: string
      session?: OrcaRateLimitWindow | null
      weekly?: OrcaRateLimitWindow | null
      rateLimitResetCredits?: {
        availableCount: number
      }
      status: string
      error?: string | null
    }
  }
}

export class OrcaLocalClient {
  private static cachedData?: {
    timestamp: number
    result: OrcaAccountsListResult
  }

  /**
   * Orca 실행 런타임의 네임드 파이프에 직접 연결하여 accounts.list RPC를 호출합니다.
   */
  public static async queryOrcaAccountsList(timeoutMs = 3000): Promise<OrcaAccountsListResult | null> {
    const now = Date.now()
    if (this.cachedData && (now - this.cachedData.timestamp < 10000)) {
      return this.cachedData.result
    }

    const appData = process.env.APPDATA || ''
    const runtimeJsonPath = path.join(appData, 'orca', 'orca-runtime.json')

    if (!fs.existsSync(runtimeJsonPath)) {
      return null
    }

    let metadata: OrcaRuntimeMetadata
    try {
      metadata = JSON.parse(fs.readFileSync(runtimeJsonPath, 'utf-8'))
    } catch {
      return null
    }

    const pipeTransport = metadata.transports?.find(t => t.kind === 'named-pipe')
    if (!pipeTransport || !pipeTransport.endpoint) {
      return null
    }

    return new Promise((resolve) => {
      let isSettled = false
      const socket = net.createConnection(pipeTransport.endpoint)
      const requestId = crypto.randomUUID()
      let buffer = ''

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true
          socket.destroy()
          resolve(null)
        }
      }, timeoutMs)

      socket.on('connect', () => {
        const payload = JSON.stringify({
          id: requestId,
          authToken: metadata.authToken,
          method: 'accounts.list',
          params: {}
        }) + '\n'
        socket.write(payload)
      })

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf-8')
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          if (!isSettled) {
            isSettled = true
            clearTimeout(timer)
            socket.end()

            try {
              const res = JSON.parse(line)
              if (res.ok && res.result) {
                this.cachedData = {
                  timestamp: Date.now(),
                  result: res.result
                }
                resolve(res.result)
                return
              }
            } catch {}
            resolve(null)
          }
        }
      })

      socket.on('error', () => {
        if (!isSettled) {
          isSettled = true
          clearTimeout(timer)
          resolve(null)
        }
      })

      socket.on('close', () => {
        if (!isSettled) {
          isSettled = true
          clearTimeout(timer)
          resolve(null)
        }
      })
    })
  }

  /**
   * Orca 세션으로부터 Codex 실시간 사용량을 추출합니다.
   */
  public static async fetchCodexUsage(account: AccountConfig): Promise<AccountUsage | null> {
    const data = await this.queryOrcaAccountsList()
    if (!data || !data.rateLimits?.codex || data.rateLimits.codex.status !== 'ok') {
      return null
    }

    const codex = data.rateLimits.codex
    const systemDefault = data.codex?.systemDefault
    const email = systemDefault?.email || undefined
    const plan = systemDefault?.workspaceLabel || 'Personal (Plus)'

    // 1. 5시간 세션 쿼터
    const sessionUsed = codex.session?.usedPercent ?? 0
    const sessionLeft = Math.max(0, 100 - sessionUsed)
    const sessionResetMs = codex.session?.resetsAt
    const sessionResetDesc = codex.session?.resetDescription
    const sessionCountdown = sessionResetMs
      ? formatCountdown(new Date(sessionResetMs).toISOString())
      : (sessionResetDesc || '--')

    // 2. 주간 쿼터
    const weeklyUsed = codex.weekly?.usedPercent ?? 0
    const weeklyLeft = Math.max(0, 100 - weeklyUsed)
    const weeklyResetMs = codex.weekly?.resetsAt
    const weeklyResetDesc = codex.weekly?.resetDescription
    const weeklyCountdown = weeklyResetMs
      ? formatCountdown(new Date(weeklyResetMs).toISOString())
      : (weeklyResetDesc || '--')

    return {
      id: account.id,
      name: account.name || 'Codex',
      provider: 'codex',
      iconLetter: 'X',
      brandColor: '#6366F1',
      email,
      tier: `${plan} (Orca 직결)`,
      status: 'ready',
      primaryQuota: {
        remainingFraction: sessionLeft / 100,
        percentLeft: sessionLeft,
        percentUsed: sessionUsed,
        resetTime: sessionResetMs ? new Date(sessionResetMs).toISOString() : undefined,
        resetCountdown: sessionCountdown,
        isExhausted: sessionLeft <= 1
      },
      weeklyQuota: {
        remainingFraction: weeklyLeft / 100,
        percentLeft: weeklyLeft,
        percentUsed: weeklyUsed,
        resetTime: weeklyResetMs ? new Date(weeklyResetMs).toISOString() : undefined,
        resetCountdown: weeklyCountdown,
        isExhausted: weeklyLeft <= 1
      },
      models: [
        {
          modelId: 'gpt-5.6-terra',
          displayName: 'Codex (5시간)',
          quota: {
            remainingFraction: sessionLeft / 100,
            percentLeft: sessionLeft,
            percentUsed: sessionUsed,
            resetTime: sessionResetMs ? new Date(sessionResetMs).toISOString() : undefined,
            resetCountdown: sessionCountdown,
            isExhausted: sessionLeft <= 1
          }
        },
        {
          modelId: 'gpt-5.6-terra-weekly',
          displayName: 'Codex (1주일)',
          quota: {
            remainingFraction: weeklyLeft / 100,
            percentLeft: weeklyLeft,
            percentUsed: weeklyUsed,
            resetTime: weeklyResetMs ? new Date(weeklyResetMs).toISOString() : undefined,
            resetCountdown: weeklyCountdown,
            isExhausted: weeklyLeft <= 1
          }
        }
      ],
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * Orca 세션으로부터 Claude 실시간 사용량을 추출합니다 (보조).
   */
  public static async fetchClaudeUsage(account: AccountConfig): Promise<AccountUsage | null> {
    const data = await this.queryOrcaAccountsList()
    if (!data || !data.rateLimits?.claude || data.rateLimits.claude.status !== 'ok') {
      return null
    }

    const claude = data.rateLimits.claude
    const email = data.claude?.accounts?.[0]?.email || undefined

    const sessionUsed = claude.session?.usedPercent ?? 0
    const sessionLeft = Math.max(0, 100 - sessionUsed)
    const sessionResetMs = claude.session?.resetsAt
    const sessionCountdown = sessionResetMs
      ? formatCountdown(new Date(sessionResetMs).toISOString())
      : (claude.session?.resetDescription || '--')

    const weeklyUsed = claude.weekly?.usedPercent ?? 0
    const weeklyLeft = Math.max(0, 100 - weeklyUsed)
    const weeklyResetMs = claude.weekly?.resetsAt
    const weeklyCountdown = weeklyResetMs
      ? formatCountdown(new Date(weeklyResetMs).toISOString())
      : (claude.weekly?.resetDescription || '--')

    return {
      id: account.id,
      name: account.name || 'Claude Code',
      provider: 'claude',
      iconLetter: 'C',
      brandColor: '#D97706',
      email,
      tier: 'Pro (Orca 직결)',
      status: 'ready',
      primaryQuota: {
        remainingFraction: sessionLeft / 100,
        percentLeft: sessionLeft,
        percentUsed: sessionUsed,
        resetTime: sessionResetMs ? new Date(sessionResetMs).toISOString() : undefined,
        resetCountdown: sessionCountdown,
        isExhausted: sessionLeft <= 1
      },
      weeklyQuota: {
        remainingFraction: weeklyLeft / 100,
        percentLeft: weeklyLeft,
        percentUsed: weeklyUsed,
        resetTime: weeklyResetMs ? new Date(weeklyResetMs).toISOString() : undefined,
        resetCountdown: weeklyCountdown,
        isExhausted: weeklyLeft <= 1
      },
      updatedAt: new Date().toISOString()
    }
  }
}
