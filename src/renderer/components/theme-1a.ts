import { parseUsageColor } from '../../common/time-utils.js'
import type { AccountUsage, WidgetConfig } from '../../common/types.js'
import { renderAiIcon } from './ai-icons.js'

export function renderTheme1a(account: AccountUsage, config: WidgetConfig): string {
  const primaryLeft = account.primaryQuota.percentLeft
  const weeklyLeft = account.weeklyQuota?.percentLeft ?? 100
  const primaryUsed = account.primaryQuota.percentUsed
  const weeklyUsed = account.weeklyQuota?.percentUsed ?? 0

  const primaryColor = parseUsageColor(primaryUsed, config.colorByUsage, account.brandColor)
  const weeklyColor = parseUsageColor(weeklyUsed, config.colorByUsage, '#9CA3AF')

  const primaryReset = account.primaryQuota.resetCountdown || '--'
  const weeklyReset = account.weeklyQuota?.resetCountdown || '--'

  const primaryDisplay = config.showUsedPercent ? primaryUsed : primaryLeft
  const weeklyDisplay = config.showUsedPercent ? weeklyUsed : weeklyLeft
  const unitLabel = config.showUsedPercent ? '소모' : '남음'

  const iconHtml = renderAiIcon(account.provider, account.name, config.iconStyle, 18)
  const showWeekly = config.showWeeklyLimit !== false && !!account.weeklyQuota
  const tooltip = showWeekly
    ? `${account.name} | 5시간: ${primaryDisplay}% ${unitLabel} (${primaryReset}) | 주간: ${weeklyDisplay}% ${unitLabel} (${weeklyReset})`
    : `${account.name} | ${primaryDisplay}% ${unitLabel} (${primaryReset})`

  return `
    <div class="account-item" data-account-id="${account.id}" title="${tooltip}">
      ${iconHtml}
      <div class="theme-1a">
        <div class="row">
          <span class="label">5H</span>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${primaryDisplay}%; background-color: ${primaryColor};"></div>
          </div>
          <span class="percent" style="color: ${primaryColor}">${primaryDisplay}%</span>
          <span class="reset-time">${primaryReset}</span>
        </div>
        ${showWeekly ? `
        <div class="row">
          <span class="label">WK</span>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${weeklyDisplay}%; background-color: ${weeklyColor};"></div>
          </div>
          <span class="percent" style="color: ${weeklyColor}">${weeklyDisplay}%</span>
          <span class="reset-time">${weeklyReset}</span>
        </div>` : ''}
      </div>
    </div>
  `
}
