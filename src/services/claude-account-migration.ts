import type { AccountConfig } from '../common/types.js'

const CLI_ID = 'local-claude-code'
const DESKTOP_ID = 'local-claude-desktop'

/** 예전 데스크톱 전용 항목을 Claude 단일 표시기로 합친다. */
export function mergeClaudeAccounts(accounts: AccountConfig[]): AccountConfig[] {
  const desktop = accounts.find(a => a.id === DESKTOP_ID && a.provider === 'claude')
  if (!desktop) return accounts

  const cli = accounts.find(a => a.id === CLI_ID && a.provider === 'claude')
  if (!cli) {
    return accounts.map(a => a === desktop
      ? { ...a, id: CLI_ID, name: 'Claude Code' }
      : a).filter(a => a.id !== DESKTOP_ID)
  }

  return accounts
    .filter(a => a.id !== DESKTOP_ID)
    .map(a => a === cli ? { ...a, enabled: cli.enabled || desktop.enabled } : a)
}
