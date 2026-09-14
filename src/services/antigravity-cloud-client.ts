import fs from 'node:fs'
import path from 'node:path'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage, ModelQuotaDetail, QuotaInfo } from '../common/types.js'

const CLIENT_ID = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || ''
const CLIENT_SECRET = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || ''
const BASE_URL = 'https://cloudcode-pa.googleapis.com'
const USER_AGENT = 'antigravity'

interface CachedToken {
  accessToken: string
  expiresAt: number
}

interface AuthStatusProfile {
  email?: string
  name?: string
}

export class AntigravityCloudClient {
  private static cachedToken?: CachedToken
  private static cachedUsage?: AccountUsage
  private static lastFetchTime = 0

  /**
   * Antigravity state.vscdb 경로 탐색
   */
  private static findStateDbPath(): string | null {
    const appData = process.env.APPDATA || ''
    const candidateDirs = [
      path.join(appData, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
      path.join(appData, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
    ]

    for (const p of candidateDirs) {
      if (fs.existsSync(p)) {
        return p
      }
    }
    return null
  }

  /**
   * state.vscdb에서 저장된 프로필 및 리프레시 토큰 추출 (순수 fs 기반, node:sqlite 의존성 없음)
   */
  private static async extractSessionData(): Promise<{ refreshToken: string | null; profile: AuthStatusProfile }> {
    const dbPath = this.findStateDbPath()
    if (!dbPath) {
      return { refreshToken: null, profile: {} }
    }

    try {
      const buf = fs.readFileSync(dbPath)

      // 1. Refresh Token 추출 (Base64 블록 탐색)
      let refreshToken: string | null = null
      const tokenNeedle = 'antigravityUnifiedStateSync.oauthToken'
      let pos = 0
      while ((pos = buf.indexOf(tokenNeedle, pos)) !== -1) {
        const text = buf.slice(pos + tokenNeedle.length, pos + tokenNeedle.length + 1500).toString('latin1')
        const match = text.match(/[A-Za-z0-9+/=]{100,}/)
        if (match) {
          try {
            const b1 = Buffer.from(match[0], 'base64')
            const m2 = b1.toString('latin1').match(/[A-Za-z0-9+/=]{100,}/)
            if (m2) {
              const b2 = Buffer.from(m2[0], 'base64')
              const refMatch = b2.toString('latin1').match(/1\/\/[A-Za-z0-9_\-]+/)
              if (refMatch) {
                refreshToken = refMatch[0]
                break
              }
            }
          } catch {}
        }
        pos += tokenNeedle.length
      }

      // 2. Email / Name 추출
      const profile: AuthStatusProfile = {}
      const statusNeedle = 'antigravityAuthStatus'
      let sPos = 0
      while ((sPos = buf.indexOf(statusNeedle, sPos)) !== -1) {
        const sText = buf.slice(sPos + statusNeedle.length, sPos + statusNeedle.length + 3000).toString('utf8')
        const emailM = sText.match(/"email"\s*:\s*"([^"]+)"/)
        const nameM = sText.match(/"name"\s*:\s*"([^"]+)"/)
        if (emailM) profile.email = emailM[1]
        if (nameM) profile.name = nameM[1]
        if (profile.email) break
        sPos += statusNeedle.length
      }

      return { refreshToken, profile }
    } catch (err) {
      console.warn('[AntigravityCloudClient] Failed to read state.vscdb:', err)
      return { refreshToken: null, profile: {} }
    }
  }

  /**
   * OAuth 엑세스 토큰 획득 및 자동 갱신
   */
  private static async getValidAccessToken(refreshToken: string): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && this.cachedToken.expiresAt - now > 60000) {
      return this.cachedToken.accessToken
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error('Google OAuth Client ID/Secret 환경변수가 설정되지 않았습니다 (ANTIGRAVITY_OAUTH_CLIENT_ID, ANTIGRAVITY_OAUTH_CLIENT_SECRET)')
    }

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Token refresh failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as { access_token: string; expires_in: number }
    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt: now + (data.expires_in || 3600) * 1000
    }

    return data.access_token
  }

  /**
   * Antigravity IDE가 꺼져 있을 때 클라우드 API를 통해 실시간 사용량 조회
   */
  public static async fetchUsage(account: AccountConfig): Promise<AccountUsage | null> {
    const now = Date.now()
    if (this.cachedUsage && now - this.lastFetchTime < 15000) {
      return { ...this.cachedUsage, id: account.id, name: account.name }
    }

    const { refreshToken, profile } = await this.extractSessionData()
    if (!refreshToken) {
      return null
    }

    const accessToken = await this.getValidAccessToken(refreshToken)

    // 1. loadCodeAssist 호출로 프로젝트 ID 및 Tier 조회
    let projectId: string | undefined
    let tierName = 'Antigravity Pro'

    try {
      const loadRes = await fetch(`${BASE_URL}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT
        },
        body: JSON.stringify({
          metadata: {
            ideType: 'ANTIGRAVITY',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI'
          }
        })
      })

      if (loadRes.ok) {
        const loadData = (await loadRes.json()) as any
        if (loadData.cloudaicompanionProject) {
          projectId = typeof loadData.cloudaicompanionProject === 'string'
            ? loadData.cloudaicompanionProject
            : loadData.cloudaicompanionProject.id || projectId
        }
        if (loadData.currentTier?.name) {
          tierName = loadData.currentTier.name
        }
      }
    } catch (e) {
      console.warn('[AntigravityCloudClient] loadCodeAssist error:', e)
    }

    // 2. fetchAvailableModels 호출
    const modelsRes = await fetch(`${BASE_URL}/v1internal:fetchAvailableModels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT
      },
      body: JSON.stringify(projectId ? { project: projectId } : {})
    })

    if (!modelsRes.ok) {
      throw new Error(`fetchAvailableModels failed (${modelsRes.status})`)
    }

    const modelsData = (await modelsRes.json()) as { models?: Record<string, any> }
    const rawModels = modelsData.models || {}

    let primaryFraction = 1.0
    let primaryResetTime: string | undefined
    let weeklyFraction = 1.0
    let weeklyResetTime: string | undefined

    let bestGeminiModel: ModelQuotaDetail | null = null
    let bestGeminiScore = -1
    let bestGeminiPriority = -1

    const extractGeminiVersion = (name: string): { major: number; minor: number } | null => {
      const match = name.match(/gemini[\s\-_]*([0-9]+)(?:\.([0-9]+))?/i)
      if (!match) return null
      return {
        major: parseInt(match[1], 10),
        minor: match[2] ? parseInt(match[2], 10) : 0
      }
    }

    const getTierPriority = (name: string): number => {
      const lower = name.toLowerCase()
      if (lower.includes('pro')) return 40
      if (lower.includes('high')) return 30
      if (lower.includes('thinking')) return 25
      if (lower.includes('medium')) return 20
      if (lower.includes('lite')) return 10
      return 15
    }

    for (const [key, info] of Object.entries(rawModels)) {
      const q = info.quotaInfo
      if (!q) continue

      const frac = typeof q.remainingFraction === 'number' ? q.remainingFraction : 1.0
      const reset = q.resetTime
      const isExhausted = q.isExhausted ?? frac <= 0.01

      const modelQuota: QuotaInfo = {
        remainingFraction: frac,
        percentLeft: Math.round(frac * 100),
        percentUsed: Math.round((1.0 - frac) * 100),
        resetTime: reset,
        resetCountdown: formatCountdown(reset),
        isExhausted
      }

      const displayName = info.displayName || info.label || key

      // 가장 높은 버전 제미나이 모델 1개 탐색
      const version = extractGeminiVersion(displayName) || extractGeminiVersion(key)
      if (version) {
        const score = version.major * 1000 + version.minor
        const priority = getTierPriority(displayName)
        if (score > bestGeminiScore || (score === bestGeminiScore && priority > bestGeminiPriority)) {
          bestGeminiScore = score
          bestGeminiPriority = priority
          bestGeminiModel = {
            modelId: key,
            displayName,
            quota: modelQuota
          }
        }
      }

      // 헤드라인 지표: 가장 쿼터 소진이 많은(frac 최소) 모델 선택
      if (frac < primaryFraction) {
        primaryFraction = frac
        primaryResetTime = reset
      }

      // Pro 또는 Claude 모델 쿼터 추적
      const k = key.toLowerCase()
      if ((k.includes('pro') || k.includes('claude')) && frac < weeklyFraction) {
        weeklyFraction = frac
        weeklyResetTime = reset
      }
    }

    // 안티그래비티 모델 목록은 가장 높은 버전 제미나이 모델 1개만 표시
    const modelList: ModelQuotaDetail[] = bestGeminiModel ? [bestGeminiModel] : []

    // 기본값 보정
    if (weeklyFraction === 1.0 && primaryFraction < 1.0) {
      weeklyFraction = primaryFraction
      weeklyResetTime = primaryResetTime
    }

    const primaryPercentUsed = Math.round((1.0 - primaryFraction) * 100)
    const weeklyPercentUsed = Math.round((1.0 - weeklyFraction) * 100)

    const usage: AccountUsage = {
      id: account.id,
      name: account.name || 'Antigravity IDE',
      provider: 'antigravity',
      iconLetter: 'A',
      brandColor: '#2563EB',
      email: profile.email || account.tokens?.email,
      tier: `${tierName} (클라우드 세션)`,
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

    this.cachedUsage = usage
    this.lastFetchTime = now
    return usage
  }
}
