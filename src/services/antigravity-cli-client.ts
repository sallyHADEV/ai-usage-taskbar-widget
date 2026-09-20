import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage, ModelQuotaDetail, QuotaInfo } from '../common/types.js'

type AgyErrorCode =
  | 'ANTIGRAVITY_CLI_NOT_FOUND'
  | 'ANTIGRAVITY_NOT_AUTHENTICATED'
  | 'ANTIGRAVITY_CLI_TIMEOUT'
  | 'ANTIGRAVITY_QUOTA_PARSE_ERROR'
  | 'ANTIGRAVITY_QUOTA_UNAVAILABLE'

const ERROR_TEXT: Record<AgyErrorCode, string> = {
  ANTIGRAVITY_CLI_NOT_FOUND: 'agy CLI를 찾을 수 없습니다',
  ANTIGRAVITY_NOT_AUTHENTICATED: 'agy CLI 로그인이 필요합니다',
  ANTIGRAVITY_CLI_TIMEOUT: 'agy CLI 응답 시간 초과',
  ANTIGRAVITY_QUOTA_PARSE_ERROR: 'agy CLI 응답을 해석하지 못했습니다',
  ANTIGRAVITY_QUOTA_UNAVAILABLE: '사용량 정보를 받지 못했습니다'
}

class AgyError extends Error {
  constructor(public code: AgyErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

// `agy -p "/usage" --output-format json` 의 실측 구조 (CLI 1.2.7). remaining_fraction/reset_time 은 snake_case
interface AgyBucket {
  id?: string
  name?: string
  window?: string // 'weekly' | '5h'
  remaining_fraction?: number
  reset_time?: string
}
interface AgyGroup {
  name?: string
  buckets?: AgyBucket[]
}
interface AgyUsageResponse {
  status?: string
  response?: string
  command?: { data?: { groups?: AgyGroup[] } }
}

const CLI_TIMEOUT_MS = 15000

export class AntigravityCliClient {
  private static cachedPath?: string

  /** PATH → %LOCALAPPDATA%\agy\bin 순으로 agy.exe 탐색 */
  private static findAgy(): string | null {
    if (this.cachedPath && fs.existsSync(this.cachedPath)) return this.cachedPath
    const dirs = (process.env.PATH || '').split(path.delimiter)
    dirs.push(path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin'))
    for (const dir of dirs) {
      if (!dir) continue
      const candidate = path.join(dir, 'agy.exe')
      if (fs.existsSync(candidate)) {
        this.cachedPath = candidate
        return candidate
      }
    }
    return null
  }

  /** 읽기 전용 슬래시 명령: 에이전트 턴/쿼터 소비/대화 생성 없이 JSON만 반환 (CLI >= 1.1.11) */
  private static runUsage(agyPath: string): Promise<AgyUsageResponse> {
    return new Promise((resolve, reject) => {
      execFile(
        agyPath,
        ['-p', '/usage', '--output-format', 'json'],
        { windowsHide: true, shell: false, timeout: CLI_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            const e = error as NodeJS.ErrnoException & { killed?: boolean }
            if (e.code === 'ENOENT') return reject(new AgyError('ANTIGRAVITY_CLI_NOT_FOUND'))
            if (e.killed) return reject(new AgyError('ANTIGRAVITY_CLI_TIMEOUT'))
            const text = `${stdout}\n${stderr}`
            // ponytail: 로그아웃 시 실제 출력은 미확인(세션이 홈 디렉터리 밖에 저장돼 재현 불가) — 문구 기반 추정
            if (/auth|log ?in|sign ?in|credential|unauthenticated/i.test(text)) {
              return reject(new AgyError('ANTIGRAVITY_NOT_AUTHENTICATED'))
            }
            return reject(new AgyError('ANTIGRAVITY_QUOTA_UNAVAILABLE', (stderr || e.message).trim().slice(0, 200)))
          }
          try {
            resolve(JSON.parse(stdout) as AgyUsageResponse)
          } catch (parseErr) {
            reject(new AgyError('ANTIGRAVITY_QUOTA_PARSE_ERROR', (parseErr as Error).message))
          }
        }
      )
    })
  }

  private static quotaOf(fraction: number, resetTime?: string): QuotaInfo {
    return {
      remainingFraction: fraction,
      percentLeft: Math.round(fraction * 100),
      percentUsed: Math.round((1 - fraction) * 100),
      resetTime,
      resetCountdown: formatCountdown(resetTime),
      isExhausted: fraction <= 0.01
    }
  }

  /** agy JSON → 기존 내부 AccountUsage (UI는 agy의 원본 구조를 모른다) */
  private static toUsage(account: AccountConfig, res: AgyUsageResponse): AccountUsage {
    if (res.status && res.status !== 'SUCCESS') {
      const text = res.response || ''
      throw new AgyError(/auth|log ?in|sign ?in|credential/i.test(text) ? 'ANTIGRAVITY_NOT_AUTHENTICATED' : 'ANTIGRAVITY_QUOTA_UNAVAILABLE', text.slice(0, 200))
    }
    const groups = res.command?.data?.groups
    if (!Array.isArray(groups) || !groups.some(g => g.buckets?.length)) {
      throw new AgyError('ANTIGRAVITY_QUOTA_UNAVAILABLE')
    }

    // 헤드라인: 모든 그룹의 버킷 중 가장 빠듯한 값 (5시간 / 주간)
    let primary: AgyBucket | undefined
    let weekly: AgyBucket | undefined
    const models: ModelQuotaDetail[] = []
    const frac = (b: AgyBucket) => b.remaining_fraction ?? 1

    for (const g of groups) {
      let tightest: AgyBucket | undefined
      for (const b of g.buckets ?? []) {
        if (!tightest || frac(b) < frac(tightest)) tightest = b
        if (b.window === 'weekly' && (!weekly || frac(b) < frac(weekly))) weekly = b
        else if (b.window === '5h' && (!primary || frac(b) < frac(primary))) primary = b
      }
      if (tightest) {
        models.push({
          modelId: g.name || 'group',
          displayName: g.name || 'Antigravity',
          quota: this.quotaOf(frac(tightest), tightest.reset_time)
        })
      }
    }

    return {
      id: account.id,
      name: account.name || 'Antigravity',
      provider: 'antigravity',
      iconLetter: 'A',
      brandColor: '#2563EB',
      tier: 'Antigravity CLI',
      status: 'ready',
      primaryQuota: this.quotaOf(primary ? frac(primary) : 1, primary?.reset_time),
      weeklyQuota: this.quotaOf(weekly ? frac(weekly) : 1, weekly?.reset_time),
      models,
      updatedAt: new Date().toISOString()
    }
  }

  public static async fetchUsage(account: AccountConfig): Promise<AccountUsage> {
    try {
      const agyPath = this.findAgy()
      if (!agyPath) throw new AgyError('ANTIGRAVITY_CLI_NOT_FOUND')
      return this.toUsage(account, await this.runUsage(agyPath))
    } catch (e) {
      const code: AgyErrorCode = e instanceof AgyError ? e.code : 'ANTIGRAVITY_QUOTA_UNAVAILABLE'
      console.warn('[AntigravityCli]', e instanceof Error ? e.message : e)
      return {
        id: account.id,
        name: account.name || 'Antigravity',
        provider: 'antigravity',
        iconLetter: 'A',
        brandColor: '#2563EB',
        status: 'error',
        errorMessage: `${ERROR_TEXT[code]} (${code})`,
        primaryQuota: this.quotaOf(1),
        weeklyQuota: this.quotaOf(1),
        updatedAt: new Date().toISOString()
      }
    }
  }
}
