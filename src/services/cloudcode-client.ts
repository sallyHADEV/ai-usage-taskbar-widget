import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { GoogleOAuthService } from './google-oauth.js'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage, ModelQuotaDetail, QuotaInfo } from '../common/types.js'

const BASE_URL = 'https://cloudcode-pa.googleapis.com'
const USER_AGENT = 'antigravity'

interface FetchAvailableModelsResponse {
  models?: Record<string, {
    displayName?: string
    model?: string
    label?: string
    quotaInfo?: {
      remainingFraction?: number
      resetTime?: string
      isExhausted?: boolean
    }
  }>
}

export class CloudCodeClient {
  public static async fetchAccountUsage(account: AccountConfig): Promise<AccountUsage> {
    if (!account.tokens) {
      // ~/.gemini/oauth_creds.json 탐색
      const geminiCredsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json')
      if (fs.existsSync(geminiCredsPath)) {
        try {
          const raw = fs.readFileSync(geminiCredsPath, 'utf-8')
          const creds = JSON.parse(raw)
          if (creds.access_token || creds.refresh_token) {
            account.tokens = {
              accessToken: creds.access_token || '',
              refreshToken: creds.refresh_token || '',
              expiresAt: creds.expiry_date ? Number(creds.expiry_date) : 0
            }
          }
        } catch (e) {
          console.warn('[CloudCode] Error reading ~/.gemini/oauth_creds.json:', e)
        }
      }
    }

    if (!account.tokens) {
      throw new Error('Account has no authentication tokens')
    }

    let accessToken = account.tokens.accessToken
    const now = Date.now()

    // 토큰 만료 1분 전이면 자동 갱신
    if (account.tokens.expiresAt && account.tokens.expiresAt - now < 60000 && account.tokens.refreshToken) {
      try {
        const refreshed = await GoogleOAuthService.refreshAccessToken(account.tokens.refreshToken)
        accessToken = refreshed.access_token
        account.tokens.accessToken = refreshed.access_token
        account.tokens.expiresAt = Date.now() + refreshed.expires_in * 1000
      } catch (err) {
        console.warn(`[CloudCode] Token refresh failed for ${account.name}:`, err)
      }
    }

    let projectId = account.tokens.projectId
    let tierName = 'Standard'

    // 1. loadCodeAssist 호출
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
      console.warn('[CloudCode] loadCodeAssist error:', e)
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
      const errText = await modelsRes.text()
      throw new Error(`fetchAvailableModels failed (${modelsRes.status}): ${errText}`)
    }

    const data = (await modelsRes.json()) as FetchAvailableModelsResponse
    const rawModels = data.models || {}

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
      const frac = info.quotaInfo?.remainingFraction ?? 1.0
      const reset = info.quotaInfo?.resetTime
      const isExhausted = info.quotaInfo?.isExhausted ?? false

      const modelQuota: QuotaInfo = {
        remainingFraction: frac,
        percentLeft: Math.round(frac * 100),
        percentUsed: Math.round((1.0 - frac) * 100),
        resetTime: reset,
        resetCountdown: formatCountdown(reset),
        isExhausted
      }

      const displayName = info.displayName || info.label || key

      // 최고 버전 제미나이 모델 탐색
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

      // 대표 모델(Gemini Flash / Pro 등) 선정
      if (key.toLowerCase().includes('flash') || key.toLowerCase().includes('gemini-2.5-flash')) {
        primaryFraction = frac
        primaryResetTime = reset
      } else if (key.toLowerCase().includes('pro') || key.toLowerCase().includes('gemini-2.5-pro')) {
        weeklyFraction = frac
        weeklyResetTime = reset
      }
    }

    const modelList: ModelQuotaDetail[] = bestGeminiModel ? [bestGeminiModel] : []

    // 기본값 설정
    if (modelList.length > 0 && primaryFraction === 1.0) {
      primaryFraction = modelList[0].quota.remainingFraction
      primaryResetTime = modelList[0].quota.resetTime
    }

    const primaryPercentUsed = Math.round((1.0 - primaryFraction) * 100)
    const weeklyPercentUsed = Math.round((1.0 - weeklyFraction) * 100)

    const primaryQuota: QuotaInfo = {
      remainingFraction: primaryFraction,
      percentLeft: Math.round(primaryFraction * 100),
      percentUsed: primaryPercentUsed,
      resetTime: primaryResetTime,
      resetCountdown: formatCountdown(primaryResetTime),
      isExhausted: primaryFraction <= 0.01
    }

    const weeklyQuota: QuotaInfo = {
      remainingFraction: weeklyFraction,
      percentLeft: Math.round(weeklyFraction * 100),
      percentUsed: weeklyPercentUsed,
      resetTime: weeklyResetTime,
      resetCountdown: formatCountdown(weeklyResetTime),
      isExhausted: weeklyFraction <= 0.01
    }

    return {
      id: account.id,
      name: account.name,
      provider: 'google',
      iconLetter: 'G',
      brandColor: '#4285F4',
      email: account.tokens.email,
      tier: tierName,
      projectId,
      status: 'ready',
      primaryQuota,
      weeklyQuota,
      models: modelList,
      updatedAt: new Date().toISOString()
    }
  }
}
