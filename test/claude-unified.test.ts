import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchClaudeUsage } from '../src/services/claude-usage-client.js'
import { mergeClaudeAccounts } from '../src/services/claude-account-migration.js'
import type { AccountConfig, AccountUsage } from '../src/common/types.js'

const account: AccountConfig = {
  id: 'local-claude-code', name: 'Claude Code', provider: 'claude', enabled: true
}

function usage(status: AccountUsage['status'], source: AccountUsage['dataSource']): AccountUsage {
  return {
    id: account.id, name: account.name, provider: 'claude', iconLetter: 'C', brandColor: '#D97757',
    status, dataSource: source, errorMessage: status === 'error' ? '조회 실패' : undefined,
    primaryQuota: { remainingFraction: 0.5, percentLeft: 50, percentUsed: 50, resetCountdown: '--' },
    updatedAt: new Date().toISOString()
  }
}

test('CLI 사용량 조회가 성공하면 앱 기록은 읽지 않는다', async () => {
  const result = await fetchClaudeUsage(account, {
    cli: async () => usage('ready', 'claude-cli'),
    desktop: () => { throw new Error('앱 기록을 읽으면 안 됨') }
  })
  assert.equal(result.dataSource, 'claude-cli')
})

test('CLI 조회 실패 시 앱 기록을 단일 Claude 계정에 표시한다', async () => {
  const result = await fetchClaudeUsage(account, {
    cli: async () => usage('error', 'claude-cli'),
    desktop: () => usage('ready', 'claude-desktop')
  })
  assert.equal(result.id, 'local-claude-code')
  assert.equal(result.status, 'ready')
  assert.equal(result.dataSource, 'claude-desktop')
})

test('CLI 예외 발생 시에도 오래된 앱 기록으로 폴백한다', async () => {
  const result = await fetchClaudeUsage(account, {
    cli: async () => { throw new Error('네트워크 오류') },
    desktop: () => usage('stale', 'claude-desktop')
  })
  assert.equal(result.status, 'stale')
})

test('두 소스가 모두 실패하면 정상 사용량처럼 표시하지 않는다', async () => {
  const result = await fetchClaudeUsage(account, {
    cli: async () => usage('error', 'claude-cli'),
    desktop: () => usage('error', 'claude-desktop')
  })
  assert.equal(result.status, 'error')
  assert.match(result.errorMessage || '', /CLI:.*Claude 앱:/)
})

test('기존 CLI와 데스크톱 항목을 하나로 합치고 활성 상태를 보존한다', () => {
  const merged = mergeClaudeAccounts([
    { ...account, enabled: false },
    { ...account, id: 'local-claude-desktop', name: 'Claude Desktop', enabled: true }
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 'local-claude-code')
  assert.equal(merged[0].enabled, true)
})

test('데스크톱 항목만 있던 설정도 단일 Claude 항목으로 옮긴다', () => {
  const merged = mergeClaudeAccounts([
    { ...account, id: 'local-claude-desktop', name: 'Claude Desktop', enabled: false }
  ])
  assert.deepEqual(merged.map(({ id, name, enabled }) => ({ id, name, enabled })), [
    { id: 'local-claude-code', name: 'Claude Code', enabled: false }
  ])
})
