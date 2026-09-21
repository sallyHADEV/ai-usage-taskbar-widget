import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import https from 'node:https'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage } from '../common/types.js'

export class ClaudeLocalClient {
  private static cachedUsage?: AccountUsage
  private static lastFetchTime: number = 0

  public static async fetchUsage(account: AccountConfig): Promise<AccountUsage> {
    const now = Date.now()
    // 15초 캐싱
    if (this.cachedUsage && (now - this.lastFetchTime < 15000)) {
      return { ...this.cachedUsage, id: account.id, name: account.name }
    }

    const homeDir = os.homedir()
    const credsPath = path.join(homeDir, '.claude', '.credentials.json')

    if (!fs.existsSync(credsPath)) {
      return this.getFallback(account, 'Claude 로그인 세션 파일 없음 (~/.claude)')
    }

    try {
      const raw = fs.readFileSync(credsPath, 'utf-8')
      const creds = JSON.parse(raw)
      const oauth = creds.claudeAiOauth

      if (!oauth || !oauth.accessToken) {
        return this.getFallback(account, 'Claude OAuth 토큰 누락')
      }

      const token = oauth.accessToken
      const subscriptionType = oauth.subscriptionType || 'Pro'

      const usageData = await this.queryAnthropicUsage(token)
      if (!usageData || !usageData.five_hour) {
        return this.getFallback(account, 'Anthropic 사용량 응답 오류')
      }

      const fiveHour = usageData.five_hour
      const sevenDay = usageData.seven_day || {}

      const primaryPercent = Math.round(Number(fiveHour.utilization) || 0)
      const weeklyPercent = Math.round(Number(sevenDay.utilization) || 0)

      const primaryResetTime = fiveHour.resets_at
      const weeklyResetTime = sevenDay.resets_at

      const primaryCountdown = primaryResetTime ? formatCountdown(primaryResetTime) : '--'
      const weeklyCountdown = weeklyResetTime ? formatCountdown(weeklyResetTime) : '--'

      const result: AccountUsage = {
        id: account.id,
        name: account.name || 'Claude Code',
        provider: 'claude',
        iconLetter: 'C',
        brandColor: '#D97757',
        tier: `${subscriptionType.toUpperCase()} (실시간 세션)`,
        status: 'ready',
        primaryQuota: {
          remainingFraction: (100 - primaryPercent) / 100,
          percentLeft: 100 - primaryPercent,
          percentUsed: primaryPercent,
          resetTime: primaryResetTime,
          resetCountdown: primaryCountdown,
          isExhausted: primaryPercent >= 100
        },
        weeklyQuota: {
          remainingFraction: (100 - weeklyPercent) / 100,
          percentLeft: 100 - weeklyPercent,
          percentUsed: weeklyPercent,
          resetTime: weeklyResetTime,
          resetCountdown: weeklyCountdown,
          isExhausted: weeklyPercent >= 100
        },
        updatedAt: new Date().toISOString()
      }

      this.cachedUsage = result
      this.lastFetchTime = now
      return result
    } catch (err) {
      console.error('[ClaudeLocalClient] Error fetching usage:', err)
      return this.getFallback(account, err instanceof Error ? err.message : String(err))
    }
  }

  private static queryAnthropicUsage(accessToken: string): Promise<any> {
    return new Promise((resolve) => {
      const req = https.request(
        'https://api.anthropic.com/api/oauth/usage',
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'claude-code/0.2.29',
            'Accept': 'application/json'
          },
          timeout: 4000
        },
        (res) => {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => {
            try {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                const json = JSON.parse(data)
                resolve(json)
                return
              }
            } catch {}
            resolve(null)
          })
        }
      )

      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })

      req.end()
    })
  }

  // 조회 실패는 항상 error. customMock(프리셋 숫자)으로 정상값을 위장하지 않는다 — 사용량 모니터에서 가짜 수치는 오답보다 나쁘다
  private static getFallback(account: AccountConfig, reason: string): AccountUsage {
    return {
      id: account.id,
      name: account.name || 'Claude Code',
      provider: 'claude',
      iconLetter: 'C',
      brandColor: '#D97757',
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
