import type { AccountUsage, WidgetConfig } from '../common/types.js'

export const DEFAULT_API_ENDPOINT = 'http://localhost:8080/api/usage'

export interface UsagePushItem {
  service: string
  has_s: boolean
  s: number
  sr: string
  w: number
  wr: string
}

export interface UsagePushPayload {
  screen: number
  items: UsagePushItem[]
}

/** 소모량(%) 기준. 실측값이 없는 계정(조회 중/에러/미인증)은 0 / '--' 더미로 보낸다 */
export function buildUsagePayload(usages: AccountUsage[], screen: number): UsagePushPayload {
  return {
    screen,
    items: usages.map((u) => {
      const hasS = !u.isWeeklyOnly
      if (u.status !== 'ready' && u.status !== 'stale') {
        return { service: u.provider, has_s: hasS, s: 0, sr: '--', w: 0, wr: '--' }
      }
      // weekly-only 계정은 primaryQuota 가 곧 주간 쿼터다
      const weekly = u.isWeeklyOnly ? u.primaryQuota : u.weeklyQuota
      return {
        service: u.provider,
        has_s: hasS,
        s: hasS ? Math.round(u.primaryQuota.percentUsed) : 0,
        sr: hasS ? u.primaryQuota.resetCountdown : '--',
        w: weekly ? Math.round(weekly.percentUsed) : 0,
        wr: weekly?.resetCountdown ?? '--'
      }
    })
  }
}

export async function pushUsage(usages: AccountUsage[], cfg: WidgetConfig): Promise<void> {
  if (!cfg.apiPushEnabled) return
  const endpoint = cfg.apiEndpoint || DEFAULT_API_ENDPOINT
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildUsagePayload(usages, cfg.apiScreen ?? 1)),
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) console.warn(`[UsagePush] ${endpoint} -> HTTP ${res.status}`)
  } catch (err) {
    console.warn(`[UsagePush] ${endpoint} failed:`, err instanceof Error ? err.message : err)
  }
}
