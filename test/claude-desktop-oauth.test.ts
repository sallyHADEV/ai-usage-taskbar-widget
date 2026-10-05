import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCipheriv, randomBytes } from 'node:crypto'
import { decryptClaudeCache, selectClaudeDesktopToken, parseClaudeDesktopLiveUsage, findClaudeDataDirs, parseRetryAfterMs } from '../src/services/claude-desktop-oauth.js'
import { refreshCountdowns } from '../src/services/claude-desktop-client.js'

const account = { id: 'test', name: 'Claude', provider: 'claude' as const, enabled: true }
const now = Date.now()
const scopeKey = (id: string) => `acct:${id}|client:org:https://api.anthropic.com:user:inference user:profile user:sessions:claude_code`

test('활성 계정의 만료되지 않은 조회 권한 토큰만 선택한다', () => {
  const cache = {
    [scopeKey('other')]: { token: 'fixture-other', expiresAt: now + 20000 },
    [scopeKey('active')]: { token: 'fixture-active', expiresAt: now + 10000 },
    'acct:active|client:org:https://api.anthropic.com:user:inference': { token: 'fixture-no-scope', expiresAt: now + 30000 }
  }
  assert.equal(selectClaudeDesktopToken(cache, 'ACTIVE', now).token, 'fixture-active')
  assert.throws(() => selectClaudeDesktopToken(cache, 'missing', now))
  assert.throws(() => selectClaudeDesktopToken(cache, 'active', now + 10000))
  assert.throws(() => selectClaudeDesktopToken(cache, undefined, now))
  assert.throws(() => selectClaudeDesktopToken({ [scopeKey('active').replace('api.anthropic.com', 'example.com')]: cache[scopeKey('active')] }, 'active', now))
})

test('AES-GCM 캐시를 복호화하고 변조나 잘못된 키를 거부한다', () => {
  const key = randomBytes(32), nonce = randomBytes(12)
  const expected = { [scopeKey('active')]: { token: 'fixture-only', expiresAt: now + 10000 } }
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(expected)), cipher.final()])
  const blob = Buffer.concat([Buffer.from('v10'), nonce, encrypted, cipher.getAuthTag()])
  assert.deepEqual(decryptClaudeCache(blob.toString('base64'), key), expected)
  assert.throws(() => decryptClaudeCache(blob.toString('base64'), randomBytes(32)))
  blob[15] ^= 1
  assert.throws(() => decryptClaudeCache(blob.toString('base64'), key))
  assert.throws(() => decryptClaudeCache(Buffer.from('v20invalid').toString('base64'), key))
})

test('실시간 사용률 및 리셋 시각을 파싱하며 잘못된 응답을 거부한다', () => {
  const reset = new Date(Date.now() + 3600000).toISOString()
  const usage = parseClaudeDesktopLiveUsage({ five_hour: { utilization: 15, resets_at: reset }, seven_day: { utilization: 20, resets_at: null } }, account)
  assert.equal(usage.primaryQuota.percentUsed, 15)
  assert.equal(usage.dataSource, 'claude-desktop-live')
  assert.equal(usage.primaryQuota.resetTime, reset)
  assert.notEqual(usage.primaryQuota.resetCountdown, '--')
  assert.equal(usage.weeklyQuota?.resetCountdown, '--')
  for (const bad of [undefined, {}, { five_hour: { utilization: '15' } }, { five_hour: { utilization: 101 } }, { five_hour: { utilization: 15, resets_at: 'bad-date' } }]) {
    assert.throws(() => parseClaudeDesktopLiveUsage(bad, account))
  }
})

test('Retry-After 헤더를 초·날짜로 해석하고 없으면 5분 쉰다', () => {
  assert.equal(parseRetryAfterMs('97', now), 97000)
  assert.equal(parseRetryAfterMs(new Date(now + 60000).toUTCString(), now) > 55000, true)
  assert.equal(parseRetryAfterMs(null, now), 300000)
  assert.equal(parseRetryAfterMs('garbage', now), 300000)
})

test('캐시된 실측값은 리셋 카운트다운만 다시 계산한다', () => {
  const reset = new Date(Date.now() + 2 * 3600000 + 60000).toISOString()
  const usage = parseClaudeDesktopLiveUsage({ five_hour: { utilization: 15, resets_at: reset } }, account)
  const stale = { ...usage, primaryQuota: { ...usage.primaryQuota, resetCountdown: 'old' } }
  assert.equal(refreshCountdowns(stale).primaryQuota.resetCountdown, '2h 01m')
})

test('환경변수로 일반 설치와 Store 패키지 데이터 경로를 탐색한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-path-test-'))
  try {
    fs.mkdirSync(path.join(root, 'Packages', 'Claude_fixture', 'LocalCache', 'Roaming', 'Claude'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Packages', 'AnthropicPBC.Claude_fixture', 'LocalCache', 'Roaming', 'Claude'), { recursive: true })
    fs.mkdirSync(path.join(root, 'Packages', 'Other_fixture'))
    assert.deepEqual(
      findClaudeDataDirs({ APPDATA: path.join(root, 'Roaming'), LOCALAPPDATA: root }).sort(),
      [
        path.join(root, 'Roaming', 'Claude'),
        path.join(root, 'Packages', 'Claude_fixture', 'LocalCache', 'Roaming', 'Claude'),
        path.join(root, 'Packages', 'AnthropicPBC.Claude_fixture', 'LocalCache', 'Roaming', 'Claude')
      ].sort()
    )
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
