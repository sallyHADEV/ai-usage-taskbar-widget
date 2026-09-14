import { parseUsageColor } from '../../common/time-utils.js'
import type { AccountUsage, WidgetConfig } from '../../common/types.js'
import { renderAiIcon } from './ai-icons.js'
import { t } from '../../common/i18n.js'

function renderSegments(percent: number, activeColor: string, totalSegments = 10): string {
  const activeCount = Math.round((percent / 100) * totalSegments)
  const segWidth = 3.2
  const segHeight = 5.2
  const segGap = 1.6
  const rx = 0.8
  const totalWidth = 47
  const totalHeight = 6

  let rects = ''
  for (let i = 0; i < totalSegments; i++) {
    const isActive = i < activeCount
    const fill = isActive ? activeColor : 'rgba(255, 255, 255, 0.14)'
    const x = (i * (segWidth + segGap)).toFixed(1)
    rects += `<rect class="segment-rect" x="${x}" y="0.4" width="${segWidth}" height="${segHeight}" rx="${rx}" fill="${fill}" />`
  }

  return `<svg class="segment-meter-svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">${rects}</svg>`
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
  const unitLabel = config.showUsedPercent ? t('unitUsed') : t('unitLeft')

  const iconHtml = renderAiIcon(account.provider, account.name, config.iconStyle, 18)
  const showWeekly = config.showWeeklyLimit !== false && !!account.weeklyQuota
  const tooltip = showWeekly
    ? t('widgetTooltip', { name: account.name, p: primaryDisplay, pr: primaryReset, w: weeklyDisplay, wr: weeklyReset, unit: unitLabel })
    : t('widgetTooltipNoWeekly', { name: account.name, p: primaryDisplay, pr: primaryReset, unit: unitLabel })

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
