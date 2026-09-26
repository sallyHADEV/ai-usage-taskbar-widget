import type { AccountConfig, AccountUsage } from '../common/types.js'
import { ClaudeLocalClient } from './claude-local-client.js'
import { ClaudeDesktopClient } from './claude-desktop-client.js'

type UsageSources = {
  cli: () => Promise<AccountUsage>
  desktop: () => AccountUsage
}

function sourceError(account: AccountConfig, reason: string): AccountUsage {
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

export async function fetchClaudeUsage(account: AccountConfig, sources: UsageSources = {
  cli: () => ClaudeLocalClient.fetchUsage(account),
  desktop: () => ClaudeDesktopClient.fetchUsage(account)
}): Promise<AccountUsage> {
  let cliUsage: AccountUsage
  try {
    cliUsage = await sources.cli()
  } catch (err) {
    cliUsage = sourceError(account, err instanceof Error ? err.message : String(err))
  }
  if (cliUsage.status === 'ready') return cliUsage

  let desktopUsage: AccountUsage
  try {
    desktopUsage = sources.desktop()
  } catch (err) {
    desktopUsage = sourceError(account, err instanceof Error ? err.message : String(err))
  }
  if (desktopUsage.status === 'ready' || desktopUsage.status === 'stale') return desktopUsage

  return sourceError(account,
    `CLI: ${cliUsage.errorMessage || '조회 실패'} · Claude 앱: ${desktopUsage.errorMessage || '기록 없음'}`)
}
