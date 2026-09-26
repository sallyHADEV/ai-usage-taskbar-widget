import assert from 'node:assert/strict'
import test from 'node:test'
import { parseClaudeDesktopUsage } from '../src/services/claude-desktop-client.js'
import type { AccountConfig } from '../src/common/types.js'

const account: AccountConfig = {
  id: 'local-claude-code',
  name: 'Claude Code',
  provider: 'claude',
  enabled: true
}

test('Claude 앱 기록의 가장 최근 샘플을 5시간·7일 사용률로 읽는다', () => {
  const now = Date.UTC(2026, 8, 26, 2, 30)
  const usage = parseClaudeDesktopUsage({ version: 2, samples: [
    { t: now - 60_000, u: { fh: 12.7, sd: 40.3 } },
    { t: now - 120_000, u: { fh: 8, sd: 38 } }
  ] }, account, now)

  assert.equal(usage.status, 'ready')
  assert.equal(usage.dataSource, 'claude-desktop')
  assert.equal(usage.primaryQuota.percentUsed, 13)
  assert.equal(usage.weeklyQuota?.percentUsed, 40)
  assert.equal(usage.primaryQuota.percentUsed + usage.primaryQuota.percentLeft, 100)
  assert.equal(usage.primaryQuota.resetCountdown, '--')
  assert.equal(usage.updatedAt, new Date(now - 60_000).toISOString())
})

test('한 시간 넘게 갱신되지 않은 앱 기록은 오래된 값으로 표시한다', () => {
  const now = Date.UTC(2026, 8, 26, 2, 30)
  const usage = parseClaudeDesktopUsage({ samples: [
    { t: now - 61 * 60_000, u: { fh: 0, sd: 40 } }
  ] }, account, now)
  assert.equal(usage.status, 'stale')
  assert.equal(usage.primaryQuota.percentUsed, 0)
})

test('유효하지 않은 사용률을 정상값으로 표시하지 않는다', () => {
  const now = Date.UTC(2026, 8, 26, 2, 30)
  assert.throws(() => parseClaudeDesktopUsage({ samples: [
    { t: now - 1000, u: { fh: 150, sd: 40 } },
    { t: now - 2000, u: { fh: 0 } }
  ] }, account, now), /유효한 값이 없습니다/)
})
