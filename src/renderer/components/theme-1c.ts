import { parseUsageColor } from '../../common/time-utils.js'
import type { AccountUsage, WidgetConfig } from '../../common/types.js'
import { getAiBrand } from './ai-icons.js'
import { t } from '../../common/i18n.js'

export function renderTheme1c(account: AccountUsage, config: WidgetConfig): string {
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

  // SVG 링 계산: 기본값(남은량 표시)은 네이티브 앱과 동일하게 잔여량만큼 차오름. 소모량 표시 시 사용한 비율만큼 차오름
  const outerR = 15.5
  const outerCircumference = 2 * Math.PI * outerR
  const outerOffset = outerCircumference * (1 - Math.min(100, primaryDisplay) / 100)

  const innerR = 11.5
  const innerCircumference = 2 * Math.PI * innerR
  const innerOffset = innerCircumference * (1 - Math.min(100, weeklyDisplay) / 100)

  const brand = getAiBrand(account.provider, account.name)
  const centerFill = isMono ? '#9CA3AF' : brand.brandColor
  const centerBg = 'transparent'
  const isWeeklyOnly = !!account.isWeeklyOnly
  const tooltip = isWeeklyOnly
    ? t('widgetTooltipWeeklyOnly', { name: account.name, w: primaryDisplay, wr: primaryReset, unit: unitLabel })
    : t('widgetTooltip', { name: account.name, p: primaryDisplay, pr: primaryReset, w: weeklyDisplay, wr: weeklyReset, unit: unitLabel })

  return `
    <div class="account-item" data-account-id="${account.id}" title="${tooltip}">
      <div class="theme-1c">
        <div class="ring-container">
          <svg class="ring-svg" viewBox="0 0 36 36">
            <!-- 배경 트랙 외곽/내부 -->
            <circle cx="18" cy="18" r="${outerR}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2.5" />
            ${!isWeeklyOnly ? `<circle cx="18" cy="18" r="${innerR}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2.5" />` : ''}
            <!-- 프로그레스 링 -->
            <circle cx="18" cy="18" r="${outerR}" fill="none" stroke="${primaryColor}" stroke-width="2.5"
              stroke-dasharray="${outerCircumference}" stroke-dashoffset="${outerOffset}" stroke-linecap="round" />
            ${!isWeeklyOnly ? `
            <circle cx="18" cy="18" r="${innerR}" fill="none" stroke="${weeklyColor}" stroke-width="2.5"
              stroke-dasharray="${innerCircumference}" stroke-dashoffset="${innerOffset}" stroke-linecap="round" />` : ''}
          </svg>
          <div class="ring-center-icon ${isMono ? 'monochrome' : ''}" style="background: ${centerBg}; color: ${centerFill}; box-shadow: none;">
            <span style="display: flex; align-items: center; justify-content: center; transform: scale(0.9);">
              ${brand.svg}
            </span>
          </div>
        </div>
        <div class="data-col">
          <div class="row">
            <span class="percent" style="color: ${primaryColor};">${primaryDisplay}%</span>
            <span class="tag">${isWeeklyOnly ? 'WK' : '5H'}</span>
            <span class="reset">${primaryReset}</span>
          </div>
          ${!isWeeklyOnly ? `
          <div class="row">
            <span class="percent" style="color: ${weeklyColor};">${weeklyDisplay}%</span>
            <span class="tag">WK</span>
            <span class="reset">${weeklyReset}</span>
          </div>` : ''}
        </div>
      </div>
    </div>
  `
}
