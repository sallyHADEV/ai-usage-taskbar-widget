import fs from 'node:fs'
import path from 'node:path'
import type { AccountConfig, AccountUsage, QuotaInfo } from '../common/types.js'

const MAX_SAMPLE_AGE_MS = 60 * 60 * 1000

interface UsageSample {
  t: number
  u: { fh: number; sd: number }
}

function isUsageSample(value: unknown): value is UsageSample {
  if (!value || typeof value !== 'object') return false
  const sample = value as Partial<UsageSample>
  const usage = sample.u
  return typeof sample.t === 'number' && Number.isFinite(sample.t) &&
    !!usage && typeof usage === 'object' &&
    typeof usage.fh === 'number' && Number.isFinite(usage.fh) && usage.fh >= 0 && usage.fh <= 100 &&
    typeof usage.sd === 'number' && Number.isFinite(usage.sd) && usage.sd >= 0 && usage.sd <= 100
}

export function parseClaudeDesktopUsage(raw: unknown, account: AccountConfig, now = Date.now()): AccountUsage {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { samples?: unknown }).samples)) {
    throw new Error('Claude 앱 사용량 기록 형식이 올바르지 않습니다')
  }

  const samples = (raw as { samples: unknown[] }).samples.filter(isUsageSample)
  const latest = samples.reduce<UsageSample | undefined>((best, sample) =>
    !best || sample.t > best.t ? sample : best, undefined)
  if (!latest || latest.t > now + 5 * 60 * 1000) {
    throw new Error('Claude 앱 사용량 기록에 유효한 값이 없습니다')
  }

  const quota = (used: number): QuotaInfo => {
    const percentUsed = Math.round(used)
    return {
      remainingFraction: (100 - percentUsed) / 100,
      percentLeft: 100 - percentUsed,
      percentUsed,
      resetCountdown: '--',
      isExhausted: percentUsed >= 100
    }
  }

  const stale = now - latest.t > MAX_SAMPLE_AGE_MS
  return {
    id: account.id,
    name: account.name || 'Claude Code',
    provider: 'claude',
    iconLetter: 'C',
    brandColor: '#D97757',
    tier: stale ? '앱 기록 (오래됨)' : '앱 기록',
    dataSource: 'claude-desktop',
    status: stale ? 'stale' : 'ready',
    primaryQuota: quota(latest.u.fh),
    weeklyQuota: quota(latest.u.sd),
    updatedAt: new Date(latest.t).toISOString()
  }
}

export class ClaudeDesktopClient {
  public static getUsageHistoryPath(): string | null {
    const appData = process.env.APPDATA
    return appData ? path.join(appData, 'Claude', 'plan-usage-history.json') : null
  }

  public static fetchUsage(account: AccountConfig): AccountUsage {
    const historyPath = this.getUsageHistoryPath()
    if (!historyPath || !fs.existsSync(historyPath)) {
      return this.error(account, 'Claude 앱 사용량 기록이 없습니다')
    }

    try {
      const raw = JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
      return parseClaudeDesktopUsage(raw, account)
    } catch (err) {
      return this.error(account, err instanceof Error ? err.message : String(err))
    }
  }

  private static error(account: AccountConfig, reason: string): AccountUsage {
    return {
      id: account.id,
      name: account.name || 'Claude Code',
      provider: 'claude',
      iconLetter: 'C',
      brandColor: '#D97757',
      status: 'error',
      errorMessage: reason,
      primaryQuota: { remainingFraction: 1, percentLeft: 100, percentUsed: 0, resetCountdown: '--' },
      updatedAt: new Date().toISOString()
    }
  }
}
