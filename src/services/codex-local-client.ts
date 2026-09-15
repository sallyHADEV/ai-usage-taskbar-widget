import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage } from '../common/types.js'
import { CodexAppServerClient } from './codex-app-server-client.js'
import { OrcaLocalClient } from './orca-local-client.js'

export class CodexLocalClient {
  private static cachedUsage?: AccountUsage
  private static lastFetchTime: number = 0

  public static async fetchUsage(account: AccountConfig): Promise<AccountUsage> {
    // 0. 공식 codex app-server JSON-RPC 세션 직결 (codex-pulse 방식 - 최우선)
    try {
      const appServerUsage = await CodexAppServerClient.fetchUsage(account)
      if (appServerUsage) {
        this.cachedUsage = appServerUsage
        this.lastFetchTime = Date.now()
        return appServerUsage
      }
    } catch (err) {
      console.warn('[CodexLocalClient] Codex app-server connection failed, falling back to Orca/local files:', err)
    }

    // 1. Orca 로컬 세션 네임드 파이프 직결 조회 시도 (2순위)
    try {
      const orcaUsage = await OrcaLocalClient.fetchCodexUsage(account)
      if (orcaUsage) {
        this.cachedUsage = orcaUsage
        this.lastFetchTime = Date.now()
        return orcaUsage
      }
    } catch (err) {
      console.warn('[CodexLocalClient] Orca direct connection failed, falling back to local files:', err)
    }

    const now = Date.now()
    if (this.cachedUsage && (now - this.lastFetchTime < 15000)) {
      return { ...this.cachedUsage, id: account.id, name: account.name }
    }

    // 1. Auth 파일 탐색
    const homeDir = os.homedir()
    const appData = process.env.APPDATA || ''
    const candidateAuthPaths = [
      path.join(appData, 'orca', 'codex-runtime-home', 'home', 'auth.json'),
      path.join(homeDir, '.codex', 'auth.json')
    ]

    let authData: any = null
    for (const p of candidateAuthPaths) {
      if (fs.existsSync(p)) {
        try {
          authData = JSON.parse(fs.readFileSync(p, 'utf-8'))
          break
        } catch {}
      }
    }

    if (!authData) {
      return this.getFallback(account, 'Codex 세션 파일 없음 (~/.codex/auth.json)')
    }

    // 2. 계정 정보 파싱 (JWT id_token / access_token에서 사용자 정보 추출)
    let email = ''
    let plan = 'Plus'

    const idToken = authData.tokens?.id_token || authData.tokens?.access_token
    if (idToken) {
      try {
        const parts = idToken.split('.')
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'))
          email = payload.email || payload['https://api.openai.com/profile']?.email || ''
          const authInfo = payload['https://api.openai.com/auth'] || {}
          if (authInfo.chatgpt_plan_type) {
            plan = authInfo.chatgpt_plan_type === 'plus' ? 'ChatGPT Plus' : authInfo.chatgpt_plan_type.toUpperCase()
          }
        }
      } catch {}
    }

    // 3. SQLite 세션 토큰 사용량 계산
    const candidateSqlitePaths = [
      path.join(appData, 'orca', 'codex-runtime-home', 'home', 'state_5.sqlite'),
      path.join(homeDir, '.codex', 'state_5.sqlite')
    ]

    let sessionPercent = 0
    let weeklyPercent = 0
    let resetCountdown = '--'
    let latestModel = 'gpt-5.6-terra'

    for (const dbPath of candidateSqlitePaths) {
      if (fs.existsSync(dbPath)) {
        try {
          // Dynamic import of node:sqlite
          const sqliteModule = await import('node:sqlite')
          if (sqliteModule && sqliteModule.DatabaseSync) {
            const db = new sqliteModule.DatabaseSync(dbPath, { readOnly: true })
            try {
              // 최근 3시간 (세션 한도)
              const row3 = db.prepare(`
                SELECT 
                  COUNT(*) as cnt, 
                  COALESCE(SUM(tokens_used), 0) as tokens,
                  MAX(updated_at) as last_updated
                FROM threads 
                WHERE updated_at >= unixepoch() - 10800
              `).get() as any

              // 최근 7일 (주간 누적)
              const row7 = db.prepare(`
                SELECT COALESCE(SUM(tokens_used), 0) as tokens
                FROM threads 
                WHERE updated_at >= unixepoch() - 604800
              `).get() as any

              // 최근 모델
              const latest = db.prepare(`
                SELECT model, updated_at
                FROM threads 
                ORDER BY updated_at DESC 
                LIMIT 1
              `).get() as any

              if (latest?.model) {
                latestModel = latest.model
              }

              const tokens3h = Number(row3?.tokens) || 0
              const tokens7d = Number(row7?.tokens) || 0

              // Plus 기준: 3시간 당 약 200,000 토큰 세션 예산
              sessionPercent = Math.min(100, Math.max(0, Math.round((tokens3h / 200000) * 100)))
              // 주간 약 2,000,000 토큰 예산
              weeklyPercent = Math.min(100, Math.max(0, Math.round((tokens7d / 2000000) * 100)))

              if (row3?.last_updated) {
                const resetMs = (Number(row3.last_updated) + 10800) * 1000
                const diffMs = resetMs - Date.now()
                if (diffMs > 0) {
                  const hours = Math.floor(diffMs / 3600000)
                  const mins = Math.floor((diffMs % 3600000) / 60000)
                  resetCountdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
                }
              }
            } finally {
              try {
                db.close()
              } catch {}
            }
            break
          }
        } catch (e) {
          console.warn('[CodexLocalClient] SQLite read error:', e)
        }
      }
    }

    const isPro = plan.toLowerCase().includes('pro')
    const isWeeklyOnly = isPro

    const result: AccountUsage = {
      id: account.id,
      name: account.name || 'Codex CLI',
      provider: 'codex',
      iconLetter: 'X',
      brandColor: '#6366F1',
      email: email || undefined,
      tier: `${plan} (로컬 세션)`,
      status: 'ready',
      isWeeklyOnly,
      primaryQuota: {
        remainingFraction: (100 - (isWeeklyOnly ? weeklyPercent : sessionPercent)) / 100,
        percentLeft: 100 - (isWeeklyOnly ? weeklyPercent : sessionPercent),
        percentUsed: isWeeklyOnly ? weeklyPercent : sessionPercent,
        resetCountdown: isWeeklyOnly ? '--' : resetCountdown,
        isExhausted: (isWeeklyOnly ? weeklyPercent : sessionPercent) >= 100
      },
      weeklyQuota: {
        remainingFraction: (100 - weeklyPercent) / 100,
        percentLeft: 100 - weeklyPercent,
        percentUsed: weeklyPercent,
        resetCountdown: '--',
        isExhausted: weeklyPercent >= 100
      },
      models: [
        {
          modelId: latestModel,
          displayName: isWeeklyOnly ? `${latestModel} (1주일)` : latestModel,
          quota: {
            remainingFraction: (100 - (isWeeklyOnly ? weeklyPercent : sessionPercent)) / 100,
            percentLeft: 100 - (isWeeklyOnly ? weeklyPercent : sessionPercent),
            percentUsed: isWeeklyOnly ? weeklyPercent : sessionPercent,
            resetCountdown: isWeeklyOnly ? '--' : resetCountdown,
            isExhausted: (isWeeklyOnly ? weeklyPercent : sessionPercent) >= 100
          }
        }
      ],
      updatedAt: new Date().toISOString()
    }

    this.cachedUsage = result
    this.lastFetchTime = now
    return result
  }

  private static getFallback(account: AccountConfig, reason: string): AccountUsage {
    if (account.customMock) {
      return {
        id: account.id,
        name: account.name,
        provider: 'codex',
        iconLetter: 'X',
        brandColor: '#6366F1',
        status: 'ready',
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
      name: account.name || 'Codex CLI',
      provider: 'codex',
      iconLetter: 'X',
      brandColor: '#6366F1',
      status: 'error',
      errorMessage: reason,
      primaryQuota: {
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
