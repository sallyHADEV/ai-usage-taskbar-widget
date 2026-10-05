import fs from 'node:fs'
import path from 'node:path'
import { createDecipheriv } from 'node:crypto'
import { spawn } from 'node:child_process'
import { formatCountdown } from '../common/time-utils.js'
import type { AccountConfig, AccountUsage, QuotaInfo } from '../common/types.js'

export function findClaudeDataDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = []
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'Claude'))
  if (env.LOCALAPPDATA) {
    const packages = path.join(env.LOCALAPPDATA, 'Packages')
    try {
      for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
        if (entry.isDirectory() && (/^Claude_/i.test(entry.name) || (/Claude/i.test(entry.name) && /Anthropic/i.test(entry.name)))) {
          dirs.push(path.join(packages, entry.name, 'LocalCache', 'Roaming', 'Claude'))
        }
      }
    } catch { /* Store installation is optional. */ }
  }
  return [...new Set(dirs)]
}

// Only the DPAPI-wrapped encryption key crosses stdin. No credentials in argv,
// temporary files, stderr, or application logs. Windows PowerShell ships with Windows.
function unprotectKey(wrapped: Buffer): Promise<Buffer> {
  const script = `$ErrorActionPreference='Stop'; try {
    Add-Type -AssemblyName System.Security
    $wrapped=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    $key=[Security.Cryptography.ProtectedData]::Unprotect($wrapped,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($key))
    [Array]::Clear($key,0,$key.Length)
  } catch { exit 1 }`
  const executable = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 5000, stdio: ['pipe', 'pipe', 'ignore']
    })
    let output = ''
    let settled = false
    const fail = () => {
      if (!settled) {
        settled = true
        reject(new Error('Claude 앱 암호화 키 복호화 실패'))
      }
    }
    child.on('error', fail)
    child.stdin.on('error', fail)
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      if (output.length > 1024) { child.kill(); fail() }
    })
    child.on('close', code => {
      if (settled) return
      const key = Buffer.from(output.trim(), 'base64')
      output = ''
      if (code === 0 && key.length === 32) {
        settled = true
        resolve(key)
      } else {
        key.fill(0)
        fail()
      }
    })
    child.stdin.end(wrapped.toString('base64'))
  })
}

export function decryptClaudeCache(encoded: string, key: Buffer): unknown {
  const blob = Buffer.from(encoded, 'base64')
  if (blob.length < 31 || !['v10', 'v11'].includes(blob.subarray(0, 3).toString())) {
    throw new Error('지원하지 않는 Claude 앱 OAuth 암호화 형식')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(3, 15))
  decipher.setAuthTag(blob.subarray(-16))
  const partial = decipher.update(blob.subarray(15, -16))
  let plain: Buffer | undefined
  try {
    plain = Buffer.concat([partial, decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  } finally { partial.fill(0); plain?.fill(0) }
}

interface DesktopToken { token: string; expiresAt: number; subscriptionType?: string }

export function selectClaudeDesktopToken(cache: unknown, activeAccount: unknown, now = Date.now()): DesktopToken {
  if (!cache || typeof cache !== 'object' || typeof activeAccount !== 'string' || !activeAccount) {
    throw new Error('Claude 앱 활성 계정 또는 OAuth 캐시 없음')
  }
  const candidates: DesktopToken[] = []
  for (const [key, raw] of Object.entries(cache)) {
    const match = /^acct:([^|]+)\|(.+)$/.exec(key)
    if (!match || match[1].toLowerCase() !== activeAccount.toLowerCase()) continue
    // Do not send tokens from overridden development hosts or unrelated scopes.
    const hostIdx = match[2].indexOf(':https://api.anthropic.com:')
    if (hostIdx === -1) continue
    const scopes = match[2].substring(hostIdx + ':https://api.anthropic.com:'.length).split(' ')
    if (!scopes.includes('user:sessions:claude_code')) continue
    const entry = raw as Partial<DesktopToken> | null
    if (!entry || typeof entry.token !== 'string' || !entry.token ||
        typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) continue
    candidates.push(entry as DesktopToken)
  }
  candidates.sort((a, b) => b.expiresAt - a.expiresAt)
  if (!candidates.length) throw new Error('Claude 앱 사용량 조회 세션 없음 또는 만료됨')
  return candidates[0]
}

export function parseClaudeDesktopLiveUsage(raw: unknown, account: AccountConfig, tier?: string): AccountUsage {
  function quota(value: unknown): QuotaInfo {
    const v = value as { utilization?: unknown; resets_at?: unknown } | null
    if (!v || typeof v.utilization !== 'number' || !Number.isFinite(v.utilization) ||
        v.utilization < 0 || v.utilization > 100 ||
        (v.resets_at != null && (typeof v.resets_at !== 'string' || !Number.isFinite(Date.parse(v.resets_at))))) {
      throw new Error('Claude 앱 사용량 응답 형식 오류')
    }
    const used = Math.round(v.utilization)
    const resetTime = typeof v.resets_at === 'string' ? v.resets_at : undefined
    return { percentUsed: used, percentLeft: 100 - used, remainingFraction: (100 - used) / 100,
      resetTime, resetCountdown: formatCountdown(resetTime), isExhausted: v.utilization >= 100 }
  }
  const data = raw as { five_hour?: unknown; seven_day?: unknown } | null
  if (!data) throw new Error('Claude 앱 사용량 응답 없음')
  return {
    id: account.id, name: account.name || 'Claude Code', provider: 'claude', iconLetter: 'C',
    brandColor: '#D97757', tier: `${tier?.toUpperCase() || 'Claude'} (앱 실시간 세션)`,
    dataSource: 'claude-desktop-live', status: 'ready', primaryQuota: quota(data.five_hour),
    weeklyQuota: data.seven_day == null ? undefined : quota(data.seven_day), updatedAt: new Date().toISOString()
  }
}

const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000

export class ClaudeRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Claude 사용량 API 요청 제한 (HTTP 429, ${Math.ceil(retryAfterMs / 1000)}초 후 재시도)`)
  }
}

// Retry-After는 초 단위 숫자 또는 HTTP 날짜. 없거나 이상하면 5분 쉰다
export function parseRetryAfterMs(header: string | null, now = Date.now()): number {
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000
    const date = Date.parse(header)
    if (Number.isFinite(date) && date > now) return date - now
  }
  return DEFAULT_RATE_LIMIT_BACKOFF_MS
}

export async function fetchClaudeDesktopLiveUsage(account: AccountConfig): Promise<AccountUsage> {
  if (process.platform !== 'win32') throw new Error('Claude 앱 OAuth 조회는 Windows에서 지원됩니다')
  const failures: string[] = []
  for (const dir of findClaudeDataDirs()) {
    if (!fs.existsSync(path.join(dir, 'config.json')) || !fs.existsSync(path.join(dir, 'Local State'))) continue
    // 실패 사유는 단계 이름만 남긴다. 예외 메시지에는 복호화된 내용 일부가 섞일 수 있어 그대로 쓰지 않는다
    let step = '설정 파일 읽기'
    try {
      const config = JSON.parse(await fs.promises.readFile(path.join(dir, 'config.json'), 'utf8'))
      if (typeof config['oauth:tokenCacheV2'] !== 'string') { failures.push('tokenCacheV2 없음'); continue }
      const state = JSON.parse(await fs.promises.readFile(path.join(dir, 'Local State'), 'utf8'))
      if (typeof state.os_crypt?.encrypted_key !== 'string') { failures.push('encrypted_key 없음'); continue }
      const wrapped = Buffer.from(state.os_crypt.encrypted_key, 'base64')
      if (wrapped.subarray(0, 5).toString() !== 'DPAPI') { failures.push('DPAPI 접두사 없음'); continue }
      step = 'DPAPI 키 복호화'
      const key = await unprotectKey(wrapped.subarray(5))
      step = 'OAuth 캐시 복호화'
      let cache: unknown
      try { cache = decryptClaudeCache(config['oauth:tokenCacheV2'], key) }
      finally { key.fill(0) }
      step = '토큰 선택'

      let activeAccount = typeof config.lastKnownAccountUuid === 'string' && config.lastKnownAccountUuid
        ? config.lastKnownAccountUuid
        : (typeof config.activeAccountId === 'string' ? config.activeAccountId : undefined)

      if (!activeAccount && cache && typeof cache === 'object') {
        const accountIds = new Set(
          Object.keys(cache)
            .map(k => /^acct:([^|]+)\|/.exec(k)?.[1])
            .filter((id): id is string => Boolean(id))
        )
        if (accountIds.size === 1) {
          activeAccount = [...accountIds][0]
        }
      }

      const credential = selectClaudeDesktopToken(cache, activeAccount)
      step = '사용량 API 호출'
      const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { Authorization: `Bearer ${credential.token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
        signal: AbortSignal.timeout(5000), redirect: 'error'
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        if (response.status === 429) throw new ClaudeRateLimitError(parseRetryAfterMs(response.headers.get('retry-after')))
        failures.push(`사용량 API HTTP ${response.status}`)
        continue
      }
      step = '사용량 응답 파싱'
      return parseClaudeDesktopLiveUsage(await response.json(), account, credential.subscriptionType)
    } catch (err) {
      if (err instanceof ClaudeRateLimitError) throw err
      failures.push(`${step} 실패`)
    }
  }
  throw new Error(`Claude 앱 실시간 세션 조회 실패: ${failures.join(', ') || '데이터 폴더 없음'}`)
}
