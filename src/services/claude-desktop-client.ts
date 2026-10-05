import fs from 'node:fs'
import path from 'node:path'
import type { AccountConfig, AccountUsage, QuotaInfo } from '../common/types.js'
import { findClaudeDataDirs, fetchClaudeDesktopLiveUsage, ClaudeRateLimitError } from './claude-desktop-oauth.js'
import { formatCountdown } from '../common/time-utils.js'

const MAX_SAMPLE_AGE_MS = 60 * 60 * 1000
const LIVE_MIN_INTERVAL_MS = 2 * 60 * 1000

export function refreshCountdowns(usage: AccountUsage): AccountUsage {
  const refresh = (q?: QuotaInfo) => q && { ...q, resetCountdown: q.resetTime ? formatCountdown(q.resetTime) : q.resetCountdown }
  return { ...usage, primaryQuota: refresh(usage.primaryQuota)!, weeklyQuota: refresh(usage.weeklyQuota) }
}

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
  private static pending?: Promise<AccountUsage>
  private static lastAttempt = 0
  private static lastResult?: AccountUsage

  public static getUsageHistoryPath(): string | null {
    return findClaudeDataDirs().map(dir => path.join(dir, 'plan-usage-history.json'))
      .find(file => fs.existsSync(file)) || null
  }

  public static async fetchLiveOrHistory(account: AccountConfig): Promise<AccountUsage> {
    if (this.pending) return { ...await this.pending, id: account.id, name: account.name }
    if (this.lastResult && Date.now() - this.lastAttempt < 15000) {
      return { ...this.lastResult, id: account.id, name: account.name }
    }
    this.lastAttempt = Date.now()
    this.pending = this.fetchLiveThrottled(account)
    try {
      this.lastResult = await this.pending
      return this.lastResult
    } finally { this.pending = undefined }
  }

  // 사용량 API는 요청 제한(429)이 빡빡하다. 성공 후에는 LIVE_MIN_INTERVAL_MS, 429 후에는 Retry-After 동안
  // 다시 부르지 않고 마지막 실측값(리셋 카운트다운만 갱신)을 보여 준다. 실측값이 없을 때만 앱 기록으로 폴백
  private static lastLive?: AccountUsage
  private static lastLiveAt = 0
  private static liveBlockedUntil = 0

  private static async fetchLiveThrottled(account: AccountConfig): Promise<AccountUsage> {
    const now = Date.now()
    const canCall = now >= this.liveBlockedUntil && (!this.lastLive || now - this.lastLiveAt >= LIVE_MIN_INTERVAL_MS)
    if (canCall) {
      try {
        this.lastLive = await fetchClaudeDesktopLiveUsage(account)
        this.lastLiveAt = Date.now()
        return this.lastLive
      } catch (err) {
        if (err instanceof ClaudeRateLimitError) this.liveBlockedUntil = Date.now() + err.retryAfterMs
        console.warn('[ClaudeDesktopClient]', err instanceof Error ? err.message : String(err))
      }
    }
    if (this.lastLive && Date.now() - this.lastLiveAt < MAX_SAMPLE_AGE_MS) {
      return { ...refreshCountdowns(this.lastLive), id: account.id, name: account.name }
    }
    return this.fetchUsage(account)
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
