import { AntigravityCliClient } from './antigravity-cli-client.js'
import { fetchClaudeUsage } from './claude-usage-client.js'
import { CodexLocalClient } from './codex-local-client.js'
import { AccountStore } from './account-store.js'
import type { AccountConfig, AccountUsage } from '../common/types.js'

export class QuotaManager {
  private usages: Map<string, AccountUsage> = new Map()
  // ponytail: 메모리 캐시만 (앱 재시작 시 소실), 필요하면 userData에 JSON 저장
  private lastGood: Map<string, AccountUsage> = new Map()
  private timer: NodeJS.Timeout | null = null
  private isRefreshing: boolean = false
  private onStateChangeListeners: Array<(usages: AccountUsage[]) => void> = []

  constructor(private accountStore: AccountStore) {}

  public addListener(listener: (usages: AccountUsage[]) => void) {
    this.onStateChangeListeners.push(listener)
  }

  private notify() {
    const list = this.getUsages()
    for (const listener of this.onStateChangeListeners) {
      try {
        listener(list)
      } catch (err) {
        console.error('[QuotaManager] Listener error', err)
      }
    }
  }

  public getUsages(): AccountUsage[] {
    const accounts = this.accountStore.getAccounts().filter(a => a.enabled)
    const result: AccountUsage[] = []

    for (const acc of accounts) {
      const existing = this.usages.get(acc.id)
      if (existing) {
        result.push(existing)
      } else {
        result.push(this.createInitialUsage(acc))
      }
    }
    return result
  }

  /**
   * customMock 이 정직한 데이터 소스인 계정인지.
   * 사용자가 직접 수치를 입력해 만든 custom 계정에서만 참이고,
   * 실계정(claude/codex/antigravity/google)의 프리셋 숫자는 실측을 대신할 수 없다.
   */
  private static isManualAccount(
    acc: AccountConfig
  ): acc is AccountConfig & { customMock: NonNullable<AccountConfig['customMock']> } {
    return acc.provider === 'custom' && !!acc.customMock
  }

  private createInitialUsage(acc: AccountConfig): AccountUsage {
    if (QuotaManager.isManualAccount(acc)) {
      const isWeeklyOnly = !!acc.customMock.isWeeklyOnly
      const primaryPct = isWeeklyOnly ? acc.customMock.weeklyPercent : acc.customMock.primaryPercent
      const primaryReset = isWeeklyOnly ? acc.customMock.weeklyReset : acc.customMock.primaryReset

      return {
        id: acc.id,
        name: acc.name,
        provider: acc.provider,
        iconLetter: acc.customMock.iconLetter || acc.name.charAt(0).toUpperCase(),
        brandColor: acc.customMock.brandColor || '#3B82F6',
        status: 'ready',
        isEstimated: true, // 사용자가 손으로 넣은 값이지 실측이 아니다
        isWeeklyOnly,
        primaryQuota: {
          remainingFraction: (100 - primaryPct) / 100,
          percentLeft: 100 - primaryPct,
          percentUsed: primaryPct,
          resetCountdown: primaryReset,
          isExhausted: primaryPct >= 100
        },
        weeklyQuota: {
          remainingFraction: (100 - acc.customMock.weeklyPercent) / 100,
          percentLeft: 100 - acc.customMock.weeklyPercent,
          percentUsed: acc.customMock.weeklyPercent,
          resetCountdown: acc.customMock.weeklyReset,
          isExhausted: acc.customMock.weeklyPercent >= 100
        },
        updatedAt: new Date().toISOString()
      }
    }

    return {
      id: acc.id,
      name: acc.name,
      provider: acc.provider,
      iconLetter: acc.name.charAt(0).toUpperCase(),
      brandColor: '#4285F4',
      status: 'loading',
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

  public async refreshAll(): Promise<AccountUsage[]> {
    if (this.isRefreshing) return this.getUsages()
    this.isRefreshing = true

    try {
      const accounts = this.accountStore.getAccounts().filter(a => a.enabled)
      const activeIds = new Set(accounts.map(a => a.id))

      // 비활성화되거나 제거된 계정 캐시 정리 (메모리 누수 방지)
      for (const id of this.usages.keys()) {
        if (!activeIds.has(id)) {
          this.usages.delete(id)
        }
      }

      await Promise.allSettled(
        accounts.map(async (acc) => {
          try {
            let usage: AccountUsage | null = null

            // 실시간 로컬/API 세션 우선 조회
            if (acc.provider === 'antigravity' || acc.isLocalIde) {
              // agy CLI가 기존 로그인 세션으로 조회 (RPC 포트/CSRF/토큰을 다루지 않음)
              usage = await AntigravityCliClient.fetchUsage(acc)
              // 목업 대신 정직한 상태: 마지막 실측값(시각 유지) 또는 에러 안내
              if (usage.status === 'ready') {
                this.lastGood.set(acc.id, usage)
              } else {
                const last = this.lastGood.get(acc.id)
                // status/updatedAt 을 그대로 두면 끊긴 갱신이 정상값으로 보인다. stale 로 낮추고 실측 시각은 유지
                if (last) {
                  usage = {
                    ...last,
                    status: 'stale',
                    errorMessage: usage.errorMessage,
                    tier: `${last.tier ?? ''} (마지막 실측)`.trim()
                  }
                }
              }
              this.usages.set(acc.id, usage)
              return
            } else if (acc.provider === 'claude') {
              usage = await fetchClaudeUsage(acc)
            } else if (acc.provider === 'codex') {
              usage = await CodexLocalClient.fetchUsage(acc)
            } else if (QuotaManager.isManualAccount(acc)) {
              // 실시간 조회 대상이 아닌 수동 입력 계정: 입력값이 곧 데이터
              usage = this.createInitialUsage(acc)
            } else {
              // 실시간 조회 클라이언트가 없는 provider (예: google). 프리셋 숫자로 채우지 않는다
              usage = {
                ...this.createInitialUsage(acc),
                status: 'error',
                errorMessage: `${acc.provider} 실시간 쿼터 조회를 지원하지 않습니다`
              }
            }

            this.usages.set(acc.id, usage)
          } catch (err) {
            console.error(`[QuotaManager] Error fetching usage for ${acc.name}:`, err)
            const fallback = this.usages.get(acc.id) || this.createInitialUsage(acc)
            fallback.status = 'error'
            fallback.errorMessage = err instanceof Error ? err.message : String(err)
            this.usages.set(acc.id, fallback)
          }
        })
      )
    } finally {
      this.isRefreshing = false
      this.notify()
    }

    return this.getUsages()
  }

  public startPolling(intervalSec: number, immediate = true) {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const safeInterval = Math.max(10, intervalSec) * 1000
    this.timer = setInterval(() => {
      this.refreshAll().catch(e => console.warn('[QuotaManager] Polling error', e))
    }, safeInterval)

    if (immediate) {
      this.refreshAll().catch(e => console.warn('[QuotaManager] Initial refresh error', e))
    }
  }

  public stopPolling() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
