import { CloudCodeClient } from './cloudcode-client.js'
import { LocalLspClient } from './local-lsp-client.js'
import { AntigravityCloudClient } from './antigravity-cloud-client.js'
import { ClaudeLocalClient } from './claude-local-client.js'
import { CodexLocalClient } from './codex-local-client.js'
import { AccountStore } from './account-store.js'
import type { AccountConfig, AccountUsage } from '../common/types.js'

export class QuotaManager {
  private usages: Map<string, AccountUsage> = new Map()
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

  private createInitialUsage(acc: AccountConfig): AccountUsage {
    if (acc.customMock) {
      return {
        id: acc.id,
        name: acc.name,
        provider: acc.provider,
        iconLetter: acc.customMock.iconLetter || acc.name.charAt(0).toUpperCase(),
        brandColor: acc.customMock.brandColor || '#3B82F6',
        status: 'ready',
        primaryQuota: {
          remainingFraction: (100 - acc.customMock.primaryPercent) / 100,
          percentLeft: 100 - acc.customMock.primaryPercent,
          percentUsed: acc.customMock.primaryPercent,
          resetCountdown: acc.customMock.primaryReset,
          isExhausted: acc.customMock.primaryPercent >= 100
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
              usage = await LocalLspClient.fetchLocalUsage(acc)
              // IDE 미실행(목업 모드 또는 에러) 시에만 AntigravityCloudClient로 실시간 클라우드 세션 조회 시도
              if (!usage || usage.status === 'error' || usage.tier?.includes('목업') || usage.tier?.includes('로컬 대기')) {
                try {
                  const cloudUsage = await AntigravityCloudClient.fetchUsage(acc)
                  if (cloudUsage && cloudUsage.status === 'ready') {
                    usage = cloudUsage
                  }
                } catch (cloudErr) {
                  console.warn('[QuotaManager] AntigravityCloudClient fallback error:', cloudErr)
                }
              }
            } else if (acc.provider === 'claude') {
              usage = await ClaudeLocalClient.fetchUsage(acc)
            } else if (acc.provider === 'codex') {
              usage = await CodexLocalClient.fetchUsage(acc)
            } else if (acc.tokens || acc.provider === 'google') {
              try {
                usage = await CloudCodeClient.fetchAccountUsage(acc)
              } catch (err) {
                console.warn(`[QuotaManager] CloudCodeClient error for ${acc.name}:`, err)
              }
            }

            // 실시간 조회가 실패했거나 미지원 계정인 경우에만 customMock 폴백 사용
            if (!usage || usage.status === 'error') {
              if (acc.customMock) {
                const mockUsage = this.createInitialUsage(acc)
                if (usage?.errorMessage) {
                  mockUsage.tier = `${mockUsage.tier || '목업'} (로컬 대기)`
                }
                usage = mockUsage
              } else if (!usage) {
                usage = this.createInitialUsage(acc)
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
