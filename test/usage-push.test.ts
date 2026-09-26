import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUsagePayload } from '../src/services/usage-push.js'
import type { AccountUsage, QuotaInfo } from '../src/common/types.js'

const q = (used: number, reset: string): QuotaInfo => ({
  remainingFraction: (100 - used) / 100, percentLeft: 100 - used, percentUsed: used, resetCountdown: reset
})

const base = { name: 'x', iconLetter: 'X', brandColor: '#000', updatedAt: '' }

test('사용량을 API 페이로드로 변환한다', () => {
  const usages: AccountUsage[] = [
    { ...base, id: 'c', provider: 'claude', status: 'ready', primaryQuota: q(38, '13m'), weeklyQuota: q(75, '1d 14h') },
    { ...base, id: 'x', provider: 'codex', status: 'ready', isWeeklyOnly: true, primaryQuota: q(40, '3d 12h') },
    { ...base, id: 'a', provider: 'antigravity', status: 'error', primaryQuota: q(99, '1h') }
  ]
  assert.deepEqual(buildUsagePayload(usages, 2), {
    screen: 2,
    items: [
      { service: 'claude', has_s: true, s: 38, sr: '13m', w: 75, wr: '1d 14h' },
      { service: 'codex', has_s: false, s: 0, sr: '--', w: 40, wr: '3d 12h' },
      { service: 'antigravity', has_s: true, s: 0, sr: '--', w: 0, wr: '--' }
    ]
  })
})
