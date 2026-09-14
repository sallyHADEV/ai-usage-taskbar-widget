import { parseUsageColor } from '../../common/time-utils.js'
import type { AccountUsage, WidgetConfig } from '../../common/types.js'
import { renderAiIcon } from './ai-icons.js'

export function renderTheme1d(account: AccountUsage, config: WidgetConfig): string {
  const isMono = config.iconStyle === 'monochrome'
  const primaryLeft = account.primaryQuota.percentLeft
  const weeklyLeft = account.weeklyQuota?.percentLeft ?? 100
  const primaryUsed = account.primaryQuota.percentUsed
  const weeklyUsed = account.weeklyQuota?.percentUsed ?? 0

  const primaryColor = isMono ? '#D1D5DB' : parseUsageColor(primaryUsed, config.colorByUsage, account.brandColor)
  const weeklyColor = isMono ? '#9CA3AF' : parseUsageColor(weeklyUsed, config.colorByUsage, '#9CA3AF')

  const primaryReset = account.primaryQuota.resetCountdown || '--'
  const weeklyReset = account.weeklyQuota?.resetCountdown || '--'

  const primaryDisplay = config.showUsedPercent ? primaryUsed : primaryLeft
  const weeklyDisplay = config.showUsedPercent ? weeklyUsed : weeklyLeft
  const unitLabel = config.showUsedPercent ? '소모' : '남음'

  const iconHtml = renderAiIcon(account.provider, account.name, config.iconStyle, 15)
  const tooltip = `${account.name} | 5시간: ${primaryDisplay}% ${unitLabel} (${primaryReset}) | 주간: ${weeklyDisplay}% ${unitLabel} (${weeklyReset})`

  return `
    <div class="account-item" data-account-id="${account.id}" title="${tooltip}">
      <div class="theme-1d">
        <div class="top-line">
          ${iconHtml}
          <strong class="quota-val" style="color: ${primaryColor};">${primaryDisplay}%</strong>
          <span class="quota-time">${primaryReset}</span>
        </div>
        <div class="sub-line">
          <span class="quota-val-sub" style="color: ${weeklyColor};">${weeklyDisplay}%</span>
          <span class="quota-time-sub">${weeklyReset}</span>
        </div>
        <div class="stack-bar-track">
          <div class="stack-bar-fill" style="width: ${primaryDisplay}%; background-color: ${primaryColor};"></div>
        </div>
      </div>
    </div>
  `
}
