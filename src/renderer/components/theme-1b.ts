import { parseUsageColor } from '../../common/time-utils.js'
import type { AccountUsage, WidgetConfig } from '../../common/types.js'
import { renderAiIcon } from './ai-icons.js'

function renderSegments(percent: number, activeColor: string, totalSegments = 10): string {
  const activeCount = Math.round((percent / 100) * totalSegments)
  let html = '<div class="segment-meter">'
  for (let i = 0; i < totalSegments; i++) {
    const isActive = i < activeCount
    const style = isActive ? `background-color: ${activeColor};` : ''
    html += `<span class="segment ${isActive ? 'active' : ''}" style="${style}"></span>`
  }
  html += '</div>'
  return html
}

export function renderTheme1b(account: AccountUsage, config: WidgetConfig): string {
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

  const iconHtml = renderAiIcon(account.provider, account.name, config.iconStyle, 18)
  const showWeekly = config.showWeeklyLimit !== false && !!account.weeklyQuota
  const tooltip = showWeekly
    ? `${account.name} | 5시간: ${primaryDisplay}% ${unitLabel} (${primaryReset}) | 주간: ${weeklyDisplay}% ${unitLabel} (${weeklyReset})`
    : `${account.name} | ${primaryDisplay}% ${unitLabel} (${primaryReset})`

  return `
    <div class="account-item" data-account-id="${account.id}" title="${tooltip}">
      ${iconHtml}
      <div class="theme-1b">
        <div class="data-stack">
          <div class="row">
            <span class="percent-mono" style="color: ${primaryColor};">${primaryDisplay}%</span>
            ${renderSegments(primaryDisplay, primaryColor, 10)}
            <span class="reset-mono">${primaryReset}</span>
          </div>
          ${showWeekly ? `
          <div class="row">
            <span class="percent-mono" style="color: ${weeklyColor};">${weeklyDisplay}%</span>
            ${renderSegments(weeklyDisplay, weeklyColor, 10)}
            <span class="reset-mono">${weeklyReset}</span>
          </div>` : ''}
        </div>
      </div>
    </div>
  `
}
