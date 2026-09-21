import assert from 'node:assert/strict'
import test from 'node:test'
import { AntigravityCliClient } from '../src/services/antigravity-cli-client.js'
import type { AccountConfig } from '../src/common/types.js'

const account: AccountConfig = {
  id: 'local-antigravity',
  name: 'Antigravity',
  provider: 'antigravity',
  enabled: true
}

// toUsage 는 private static (타입 상의 제약일 뿐 런타임에는 일반 static)
const toUsage = (res: unknown) =>
  (AntigravityCliClient as unknown as { toUsage: (a: AccountConfig, r: unknown) => any }).toUsage(account, res)

const response = (buckets: unknown[]) => ({
  status: 'SUCCESS',
  command: { data: { groups: [{ name: 'Gemini', buckets }] } }
})

test('정상 응답을 퍼센트로 변환하고 남음+사용 합이 100', () => {
  const u = toUsage(response([
    { window: '5h', remaining_fraction: 0.25 },
    { window: 'weekly', remaining_fraction: 0.5 }
  ]))
  assert.equal(u.status, 'ready')
  assert.equal(u.primaryQuota.percentLeft, 25)
  assert.equal(u.primaryQuota.percentUsed, 75)
  assert.equal(u.weeklyQuota.percentLeft, 50)
  assert.equal(u.primaryQuota.percentLeft + u.primaryQuota.percentUsed, 100)
})

// 반올림으로 합이 101이 되던 회귀 방지 (0.005 -> left 1, used 는 99 여야 한다)
test('반올림 경계에서도 합이 100', () => {
  for (const f of [0.005, 0.015, 0.125, 0.335, 0.995]) {
    const u = toUsage(response([{ window: '5h', remaining_fraction: f }]))
    assert.equal(
      u.primaryQuota.percentLeft + u.primaryQuota.percentUsed,
      100,
      `fraction ${f} 에서 합이 100이 아님`
    )
  }
})

test('remaining_fraction 누락은 100% 남음이 아니라 파싱 에러', () => {
  assert.throws(
    () => toUsage(response([{ window: '5h' }, { window: 'weekly' }])),
    /ANTIGRAVITY_QUOTA_PARSE_ERROR/
  )
})

test('범위를 벗어난 값은 무시되고, 남는 버킷이 없으면 에러', () => {
  assert.throws(
    () => toUsage(response([{ window: '5h', remaining_fraction: 1.4 }])),
    /ANTIGRAVITY_QUOTA_PARSE_ERROR/
  )
})

test('5h 버킷이 없으면 가짜 100% 대신 주간 전용으로 처리', () => {
  const u = toUsage(response([{ window: 'weekly', remaining_fraction: 0.3 }]))
  assert.equal(u.isWeeklyOnly, true)
  assert.equal(u.primaryQuota.percentLeft, 30)
})

test('agy 가 실패 status 를 주면 에러', () => {
  assert.throws(() => toUsage({ status: 'ERROR', response: 'please sign in' }), /NOT_AUTHENTICATED/)
})
