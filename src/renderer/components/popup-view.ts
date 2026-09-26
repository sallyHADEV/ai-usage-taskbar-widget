import { parseUsageColor } from '../../common/time-utils.js'
import type { AccountConfig, AccountUsage, AppState, ThemeType, WidgetConfig } from '../../common/types.js'
import { renderAiIcon } from './ai-icons.js'
import { t } from '../../common/i18n.js'

let activeTab: 'usage' | 'accounts' | 'settings' | 'api' = 'usage'
let hasDetectedApps = false
let isAddingCustom = false
let isSliderDragging = false

// 캐시된 감지 앱 목록
let cachedDetectedApps: any[] = [
  { id: 'local-antigravity', name: 'Google Antigravity', provider: 'antigravity', installed: true, running: true, iconLetter: 'A', brandColor: '#2563EB' },
  { id: 'local-claude-code', name: 'Claude Code', provider: 'claude', installed: true, running: true, iconLetter: 'C', brandColor: '#D97757' },
  { id: 'local-codex', name: 'Codex CLI', provider: 'codex', installed: true, running: false, iconLetter: 'X', brandColor: '#6366F1' }
]

// animate: 팝업이 실제로 열릴 때만 true (설정 클릭 등 재렌더링 시 애니메이션이 다시 재생되어 깜빡이는 것 방지)
export function renderPopupView(container: HTMLElement, state: AppState, animate = false) {
  // 슬라이더 드래그 중에는 사용자 조작(포커스/마우스) 보호를 위해 전체 DOM 재작성 방지
  if (isSliderDragging) {
    return
  }
  // 입력 중 쿼터 갱신으로 재렌더링되면 타이핑하던 값이 날아간다
  if (document.activeElement?.matches('.api-input')) {
    return
  }

  // 항목 선택 시 전체 DOM이 재작성되며 스크롤이 맨 위로 튀는 것을 방지하기 위해 위치 보존
  const prevScrollTop = container.querySelector('.popup-body')?.scrollTop ?? 0

  container.innerHTML = `
    <div class="popup-root ${animate ? 'popup-enter' : ''}">
      <!-- 헤더 -->
      <div class="popup-header">
        <div class="popup-title">
          <span>${t('popupTitle')}</span>
          <span class="popup-title-badge">${t('accountsActive', { count: state.usages.length })}</span>
        </div>
        <div class="popup-actions">
          <button class="icon-button ${state.isRefreshing ? 'refreshing' : ''}" id="btn-refresh" title="${t('refresh')}">
            &#8635;
          </button>
          <button class="icon-button" id="btn-close-popup" title="${t('close')}">
            &times;
          </button>
        </div>
      </div>

      <!-- 탭 -->
      <div class="popup-tabs">
        <div class="popup-tab ${activeTab === 'usage' ? 'active' : ''}" data-tab="usage">${t('tabUsage')}</div>
        <div class="popup-tab ${activeTab === 'accounts' ? 'active' : ''}" data-tab="accounts">${t('tabAccounts')}</div>
        <div class="popup-tab ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">${t('tabSettings')}</div>
        <div class="popup-tab ${activeTab === 'api' ? 'active' : ''}" data-tab="api">${t('tabApi')}</div>
      </div>

      <!-- 본문 -->
      <div class="popup-body">
        ${renderTabContent(state)}
      </div>
    </div>
  `

  bindPopupEvents(container, state)

  const popupBody = container.querySelector('.popup-body')
  if (popupBody) popupBody.scrollTop = prevScrollTop
}

function renderTabContent(state: AppState): string {
  if (activeTab === 'usage') {
    return renderUsageTab(state)
  }
  if (activeTab === 'accounts') {
    return renderAccountsTab(state)
  }
  if (activeTab === 'api') {
    return renderApiTab(state)
  }
  return renderSettingsTab(state)
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function renderApiTab(state: AppState): string {
  const cfg = state.config
  const inputStyle = 'background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;'

  return `
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div class="form-group">
        <label class="form-label switch-container" for="chk-api-push">
          <div>
            <span>${t('apiPushLabel')}</span>
            <div style="font-size: 9px; color: var(--text-muted); font-weight: 400;">
              ${t('apiPushDesc')}
            </div>
          </div>
          <div class="md-switch">
            <input type="checkbox" id="chk-api-push" ${cfg.apiPushEnabled ? 'checked' : ''} />
            <div class="md-switch-track">
              <div class="md-switch-thumb"></div>
            </div>
          </div>
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" for="inp-api-endpoint">${t('apiEndpointLabel')}</label>
        <input type="url" class="api-input" id="inp-api-endpoint" style="${inputStyle}"
          value="${escapeAttr(cfg.apiEndpoint || 'http://localhost:8080/api/usage')}" />
      </div>

      <div class="form-group">
        <label class="form-label" for="inp-api-screen">${t('apiScreenLabel')}</label>
        <input type="number" class="api-input" id="inp-api-screen" min="1" step="1" style="${inputStyle}"
          value="${cfg.apiScreen ?? 1}" />
      </div>
    </div>
  `
}

function badgeClass(u: AccountUsage): string {
  if (u.status === 'error' || u.status === 'unauthenticated') return 'error'
  if (u.status === 'stale') return 'stale'
  if (u.isEstimated) return 'estimated'
  return ''
}

// 카드 부제: 정상 실측일 때만 '실시간 모니터링 중'. 그 외에는 왜 믿을 수 없는 값인지 밝힌다
function statusLine(u: AccountUsage): string {
  if (u.status === 'error' || u.status === 'unauthenticated') {
    return u.errorMessage || t('statusUnavailable')
  }
  if (u.dataSource === 'claude-desktop' && (u.status === 'ready' || u.status === 'stale')) {
    const key = u.status === 'stale' ? 'desktopHistoryStale' : 'desktopHistory'
    return t(key, { time: new Date(u.updatedAt).toLocaleString() })
  }
  if (u.status === 'stale') {
    return t('statusStale', { time: new Date(u.updatedAt).toLocaleString() })
  }
  if (u.status === 'loading') return t('statusLoading')
  if (u.isEstimated) return `${t('statusEstimated')}${u.email ? ` · ${u.email}` : ''}`
  return u.email || u.projectId || t('realtimeMonitoring')
}

function renderUsageTab(state: AppState): string {
  if (state.usages.length === 0) {
    return `
      <div style="text-align: center; padding: 40px 10px; color: var(--text-muted);">
        <p>${t('noActiveAccounts')}</p>
        <p style="margin-top: 8px; font-size: 11px;">${t('addAccountHint')}</p>
      </div>
    `
  }

  const isMono = state.config.iconStyle === 'monochrome'

  return state.usages.map((u) => {
    const primaryUsed = u.primaryQuota.percentUsed
    const weeklyUsed = u.weeklyQuota?.percentUsed ?? 0
    const primaryColor = isMono ? '#D1D5DB' : parseUsageColor(primaryUsed, state.config.colorByUsage, u.brandColor)
    const weeklyColor = isMono ? '#9CA3AF' : parseUsageColor(weeklyUsed, state.config.colorByUsage, '#9CA3AF')

    let displayedModels = u.models || []
    if (u.provider === 'antigravity' && displayedModels.length > 1) {
      let bestModel = displayedModels[0]
      let bestScore = -1
      for (const m of displayedModels) {
        const match = m.displayName.match(/gemini[\s\-_]*([0-9]+)(?:\.([0-9]+))?/i)
        if (match) {
          const score = parseInt(match[1], 10) * 1000 + (match[2] ? parseInt(match[2], 10) : 0)
          if (score > bestScore) {
            bestScore = score
            bestModel = m
          }
        }
      }
      displayedModels = [bestModel]
    }

    const modelsHtml = (displayedModels.length > 0)
      ? `
        <div class="model-list-title">${t('modelQuotaTitle')}</div>
        ${displayedModels.map(m => `
          <div class="model-item">
            <span class="model-name">${m.displayName}</span>
            <span class="model-pct" style="color: ${parseUsageColor(m.quota.percentUsed, state.config.colorByUsage, u.brandColor)}">${m.quota.percentUsed}% (${m.quota.resetCountdown})</span>
          </div>
        `).join('')}
      `
      : ''

    const iconHtml = renderAiIcon(u.provider, u.name, state.config.iconStyle, 24)

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-account-info">
            ${iconHtml}
            <div>
              <div class="card-account-name">${u.name}</div>
              <div class="card-account-email">${statusLine(u)}</div>
            </div>
          </div>
          <span class="card-badge ${badgeClass(u)}">${u.tier || u.status}</span>
        </div>

        <div class="card-quota-grid">
          ${u.isWeeklyOnly ? `
          <div class="quota-box" style="grid-column: 1 / -1;">
            <div class="quota-box-title">
              <span>${t('weeklyLimit')}</span>
              <span>${t('usageLabel')}</span>
            </div>
            <div class="quota-box-percent" style="color: ${primaryColor}">${primaryUsed}%</div>
            <div class="quota-box-reset">${t('resetLabel', { time: `<strong>${u.primaryQuota.resetCountdown}</strong>` })}</div>
          </div>
          ` : `
          <div class="quota-box">
            <div class="quota-box-title">
              <span>${t('sessionLimit5h')}</span>
              <span>${t('usageLabel')}</span>
            </div>
            <div class="quota-box-percent" style="color: ${primaryColor}">${primaryUsed}%</div>
            <div class="quota-box-reset">${t('resetLabel', { time: `<strong>${u.primaryQuota.resetCountdown}</strong>` })}</div>
          </div>
          <div class="quota-box">
            <div class="quota-box-title">
              <span>${t('weeklyLimit')}</span>
              <span>${t('usageLabel')}</span>
            </div>
            <div class="quota-box-percent" style="color: ${weeklyColor}">${weeklyUsed}%</div>
            <div class="quota-box-reset">${t('resetLabel', { time: `<strong>${u.weeklyQuota?.resetCountdown || '--'}</strong>` })}</div>
          </div>
          `}
        </div>

        ${modelsHtml}
      </div>
    `
  }).join('')
}

function renderAccountsTab(state: AppState): string {
  const accountListHtml = state.accounts.map((acc, index) => {
    const isFirst = index === 0
    const isLast = index === state.accounts.length - 1
    return `
      <div class="card" style="padding: 10px 12px; flex-direction: row; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" class="chk-account" data-id="${acc.id}" ${acc.enabled ? 'checked' : ''} style="cursor: pointer;" />
          ${renderAiIcon(acc.provider, acc.name, state.config.iconStyle, 20)}
          <div>
            <div style="font-weight: 600; font-size: 11px;">${acc.name}</div>
            <div style="font-size: 9px; color: var(--text-dim);">${acc.isLocalIde ? t('localIdeNoAuth') : acc.provider.toUpperCase()}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 5px;">
          <button class="btn-order btn-move-up" data-id="${acc.id}" title="${t('moveUp')}" ${isFirst ? 'disabled style="opacity: 0.25; cursor: default;"' : 'style="cursor: pointer;"'}>▲</button>
          <button class="btn-order btn-move-down" data-id="${acc.id}" title="${t('moveDown')}" ${isLast ? 'disabled style="opacity: 0.25; cursor: default;"' : 'style="cursor: pointer;"'}>▼</button>
          <button class="btn-danger btn-delete-account" data-id="${acc.id}" title="${t('deleteAccountTitle')}">${t('deleteAccountBtn')}</button>
        </div>
      </div>
    `
  }).join('')

  // 감지된 각 앱의 상태 및 추가 버튼
  const detectedItemsHtml = cachedDetectedApps.map(app => {
    const isAdded = state.accounts.some(a => a.id === app.id)
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06);">
        <div style="display: flex; align-items: center; gap: 8px;">
          ${renderAiIcon(app.provider, app.name, state.config.iconStyle, 18)}
          <div>
            <div style="font-weight: 600; font-size: 11px; color: #fff;">${app.name}</div>
            <div style="font-size: 9px; color: var(--text-muted);">${app.running ? t('runningNow') : (app.installed ? t('localInstallDetected') : t('presetReady'))}</div>
          </div>
        </div>
        <div>
          ${isAdded
            ? `<span style="color: #34d399; font-weight: 600; font-size: 10px; background: rgba(52, 211, 153, 0.12); padding: 3px 8px; border-radius: 4px;">${t('added')}</span>`
            : `<button class="btn-primary btn-add-detected" data-app-id="${app.id}" style="padding: 3px 10px; font-size: 10px; background: #2563EB;">${t('addToWidget')}</button>`
          }
        </div>
      </div>
    `
  }).join('')

  const localDetectorHtml = `
    <div class="card" style="padding: 10px 12px; background: rgba(37, 99, 235, 0.08); border-color: rgba(37, 99, 235, 0.3);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong style="font-size: 11px; color: #60a5fa;">${t('localDetectTitle')}</strong>
        <button class="btn-secondary" id="btn-detect-apps" style="padding: 2px 8px; font-size: 10px;">${t('redetect')}</button>
      </div>
      <div id="local-apps-list" style="display: flex; flex-direction: column; gap: 2px;">
        ${detectedItemsHtml}
      </div>
    </div>
  `

  const customFormHtml = isAddingCustom ? `
    <div class="card" style="margin-top: 10px; padding: 12px; background: rgba(0,0,0,0.3);">
      <div style="font-weight: 700; font-size: 12px; margin-bottom: 8px;">${t('addCustomAccountTitle')}</div>
      <div class="form-group">
        <label class="form-label">${t('accountAlias')}</label>
        <input type="text" id="new-acc-name" value="Claude Work" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;" />
      </div>
      <div class="form-row">
        <div class="form-group" style="flex: 1;">
          <label class="form-label">${t('iconLetterLabel')}</label>
          <input type="text" id="new-acc-icon" value="C" maxlength="2" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;" />
        </div>
        <div class="form-group" style="flex: 1;">
          <label class="form-label">${t('brandColorLabel')}</label>
          <input type="color" id="new-acc-color" value="#D97757" style="background: none; border: none; height: 30px; cursor: pointer; width: 100%;" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex: 1;">
          <label class="form-label">${t('usage5h')}</label>
          <input type="number" id="new-acc-5h" min="0" max="100" value="45" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;" />
        </div>
        <div class="form-group" style="flex: 1;">
          <label class="form-label">${t('usageWeekly')}</label>
          <input type="number" id="new-acc-wk" min="0" max="100" value="28" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;" />
        </div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button class="btn-primary" id="btn-save-custom" style="flex: 1;">${t('save')}</button>
        <button class="btn-secondary" id="btn-cancel-custom">${t('cancel')}</button>
      </div>
    </div>
  ` : `
    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
      <div style="display: flex; gap: 8px;">
        <button class="btn-secondary" id="btn-show-custom-form" style="flex: 1;">
          ${t('addManually')}
        </button>
      </div>
      <button class="btn-secondary" id="btn-reset-defaults" style="font-size: 11px; padding: 6px; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.15);">
        ${t('resetDefaults')}
      </button>
    </div>
  `

  return `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${localDetectorHtml}
      <div style="font-size: 11px; color: var(--text-muted); margin: 4px 0 2px 0;">
        ${t('checkedAccountsHint')}
      </div>
      ${accountListHtml}
      ${customFormHtml}
    </div>
  `
}

function renderSettingsTab(state: AppState): string {
  const cfg = state.config

  return `
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <!-- 테마 선택 -->
      <div class="form-group">
        <label class="form-label">${t('widgetTheme')}</label>
        <div class="form-row">
          <button class="theme-button ${cfg.theme === '1a' ? 'active' : ''}" data-theme="1a">${t('theme1a')}</button>
          <button class="theme-button ${cfg.theme === '1b' ? 'active' : ''}" data-theme="1b">${t('theme1b')}</button>
          <button class="theme-button ${cfg.theme === '1c' ? 'active' : ''}" data-theme="1c">${t('theme1c')}</button>
          <button class="theme-button ${cfg.theme === '1d' ? 'active' : ''}" data-theme="1d">${t('theme1d')}</button>
        </div>
      </div>

      <!-- 아이콘 스타일 -->
      <div class="form-group">
        <label class="form-label">${t('iconStyleLabel')}</label>
        <div class="form-row">
          <button class="theme-button ${cfg.iconStyle === 'color' ? 'active' : ''}" id="btn-icon-color">
            ${t('iconColor')}
          </button>
          <button class="theme-button ${cfg.iconStyle === 'monochrome' ? 'active' : ''}" id="btn-icon-mono">
            ${t('iconMono')}
          </button>
        </div>
      </div>

      <!-- 윈도우 시작 시 자동 실행 -->
      <div class="form-group">
        <label class="form-label switch-container" for="chk-open-at-login">
          <span>${t('launchAtLogin')}</span>
          <div class="md-switch">
            <input type="checkbox" id="chk-open-at-login" ${cfg.openAtLogin ? 'checked' : ''} />
            <div class="md-switch-track">
              <div class="md-switch-thumb"></div>
            </div>
          </div>
        </label>
      </div>

      <!-- 팝업 열기 클릭 방식 -->
      <div class="form-group">
        <label class="form-label switch-container" for="chk-double-click-popup">
          <div>
            <span>${t('doubleClickPopupLabel')}</span>
            <div style="font-size: 9px; color: var(--text-muted); font-weight: 400;">
              ${t('doubleClickPopupDesc')}
            </div>
          </div>
          <div class="md-switch">
            <input type="checkbox" id="chk-double-click-popup" ${cfg.doubleClickToOpenPopup ? 'checked' : ''} />
            <div class="md-switch-track">
              <div class="md-switch-thumb"></div>
            </div>
          </div>
        </label>
      </div>

      <!-- 사용량에 따른 색상 변화 -->
      <div class="form-group">
        <label class="form-label switch-container" for="chk-color-usage">
          <span>${t('colorByUsageLabel')}</span>
          <div class="md-switch">
            <input type="checkbox" id="chk-color-usage" ${cfg.colorByUsage ? 'checked' : ''} />
            <div class="md-switch-track">
              <div class="md-switch-thumb"></div>
            </div>
          </div>
        </label>
      </div>

      <!-- 배경 카드 표시 여부 -->
      <div class="form-group">
        <label class="form-label switch-container" for="chk-show-card-bg">
          <span>${t('showCardBg')}</span>
          <div class="md-switch">
            <input type="checkbox" id="chk-show-card-bg" ${cfg.showCardBackground ? 'checked' : ''} />
            <div class="md-switch-track">
              <div class="md-switch-thumb"></div>
            </div>
          </div>
        </label>
      </div>

      <!-- 작업표시줄 바 표시 방식: 남은량 vs 소모량 -->
      <div class="form-group">
        <label class="form-label switch-container" for="chk-show-used-percent">
          <span>${t('showUsedPercentLabel')}</span>
          <div class="md-switch">
            <input type="checkbox" id="chk-show-used-percent" ${cfg.showUsedPercent ? 'checked' : ''} />
            <div class="md-switch-track">
              <div class="md-switch-thumb"></div>
            </div>
          </div>
        </label>
      </div>

      <!-- 배치 모드 -->
      <div class="form-group">
        <label class="form-label">${t('placementLabel')}</label>
        <div class="form-row">
          <button class="theme-button ${cfg.placementMode !== 'floating' ? 'active' : ''}" id="btn-place-docked">
            ${t('placementDocked')}
          </button>
          <button class="theme-button ${cfg.placementMode === 'floating' ? 'active' : ''}" id="btn-place-floating">
            ${t('placementFloating')}
          </button>
        </div>
      </div>

      <!-- 항상 위에 표시 ('작업 표시줄 바로 위' 전용) -->
      <div class="form-group" id="group-always-on-top" style="${cfg.placementMode === 'floating' ? '' : 'display: none;'}">
        <label class="form-label switch-container" for="chk-always-on-top">
          <div>
            <span>${t('alwaysOnTopLabel')}</span>
            <div style="font-size: 9px; color: var(--text-muted); font-weight: 400;">
              ${t('alwaysOnTopDesc')}
            </div>
          </div>
          <div class="md-switch">
            <input type="checkbox" id="chk-always-on-top" ${cfg.alwaysOnTop !== false ? 'checked' : ''} />
            <div class="md-switch-track">
              <div class="md-switch-thumb"></div>
            </div>
          </div>
        </label>
      </div>

      <!-- 위치 및 정렬 -->
      <div class="form-group">
        <label class="form-label">${t('alignmentLabel')}</label>
        <div class="form-row">
          <button class="theme-button ${cfg.alignment === 'right' ? 'active' : ''}" id="btn-align-right">
            ${cfg.placementMode === 'floating' ? t('alignRightFloating') : t('alignRightDocked')}
          </button>
          <button class="theme-button ${cfg.alignment === 'left' ? 'active' : ''}" id="btn-align-left">
            ${cfg.placementMode === 'floating' ? t('alignLeftFloating') : t('alignLeftDocked')}
          </button>
        </div>
      </div>

      <!-- 거리 오프셋 -->
      <div class="form-group">
        <div class="form-label">
          <span>${t('offsetLabel')}</span>
          <span id="label-offset">${cfg.offsetPx}px</span>
        </div>
        <input type="range" class="range-slider" id="slider-offset" min="-150" max="350" value="${cfg.offsetPx}" />
      </div>

      <!-- 세로 오프셋 -->
      <div class="form-group">
        <div class="form-label">
          <span>${t('verticalOffsetLabel')}</span>
          <span id="label-voffset">${cfg.verticalOffsetPx ?? 0}px</span>
        </div>
        <input type="range" class="range-slider" id="slider-voffset" min="-20" max="20" value="${cfg.verticalOffsetPx ?? 0}" />
      </div>

      <!-- 투명도 알파 -->
      <div class="form-group">
        <div class="form-label">
          <span>${t('alphaLabel')}</span>
          <span id="label-alpha">${cfg.alphaPercent}%</span>
        </div>
        <input type="range" class="range-slider" id="slider-alpha" min="10" max="100" value="${cfg.alphaPercent}" />
      </div>

      <!-- 업데이트 주기 -->
      <div class="form-group">
        <label class="form-label">${t('refreshIntervalLabel')}</label>
        <select id="sel-interval" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;">
          <option value="15" style="color: #111;" ${cfg.refreshIntervalSec === 15 ? 'selected' : ''}>${t('interval15')}</option>
          <option value="30" style="color: #111;" ${cfg.refreshIntervalSec === 30 ? 'selected' : ''}>${t('interval30')}</option>
          <option value="60" style="color: #111;" ${cfg.refreshIntervalSec === 60 ? 'selected' : ''}>${t('interval60')}</option>
          <option value="120" style="color: #111;" ${cfg.refreshIntervalSec === 120 ? 'selected' : ''}>${t('interval120')}</option>
          <option value="300" style="color: #111;" ${cfg.refreshIntervalSec === 300 ? 'selected' : ''}>${t('interval300')}</option>
        </select>
      </div>
    </div>
  `
}

let offsetUpdateTimeout: any = null

function bindPopupEvents(container: HTMLElement, state: AppState) {
  // 닫기 버튼
  container.querySelector('#btn-close-popup')?.addEventListener('click', () => {
    window.api.unlockPopup()
    window.api.hidePopup()
  })

  // 새로고침 버튼
  container.querySelector('#btn-refresh')?.addEventListener('click', () => {
    window.api.refreshQuota()
  })

  // 탭 전환 (이벤트 위임 적용)
  const tabsContainer = container.querySelector('.popup-tabs')
  tabsContainer?.addEventListener('click', (e) => {
    const tabEl = (e.target as HTMLElement).closest('.popup-tab') as HTMLElement
    if (tabEl) {
      const tabName = tabEl.getAttribute('data-tab') as any
      if (tabName) {
        activeTab = tabName
        if (activeTab === 'settings' || activeTab === 'accounts' || activeTab === 'api') {
          window.api.lockPopup() // 설정이나 계정 관리 조작 중에는 팝업 잠금 유지
        }
        renderPopupView(container, state)
        if (activeTab === 'accounts' && !hasDetectedApps) {
          hasDetectedApps = true
          window.api.detectLocalApps().then((apps) => {
            if (apps && apps.length > 0) cachedDetectedApps = apps
            if (activeTab === 'accounts' && container.isConnected) renderPopupView(container, state)
          }).catch(() => { hasDetectedApps = false })
        }
      }
    }
  })

  // 계정 관리 이벤트
  container.querySelectorAll('.chk-account').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id')
      const checked = (e.target as HTMLInputElement).checked
      if (id) {
        window.api.toggleAccount(id, checked)
      }
    })
  })

  container.querySelectorAll('.btn-delete-account').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id')
      if (id && confirm(t('confirmDeleteAccount'))) {
        window.api.removeAccount(id)
      }
    })
  })

  // 순서 위로 이동
  container.querySelectorAll('.btn-move-up').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id')
      if (id) {
        window.api.reorderAccount(id, 'up')
      }
    })
  })

  // 순서 아래로 이동
  container.querySelectorAll('.btn-move-down').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id')
      if (id) {
        window.api.reorderAccount(id, 'down')
      }
    })
  })

  // 감지된 앱 개별 위젯 추가 버튼
  container.querySelectorAll('.btn-add-detected').forEach((btn) => {
    btn.addEventListener('click', () => {
      const appId = btn.getAttribute('data-app-id')
      const appData = cachedDetectedApps.find(a => a.id === appId)
      if (appData) {
        window.api.restoreDetectedApp(appData)
      }
    })
  })

  // 기본 계정 전체 초기화/복원 버튼
  container.querySelector('#btn-reset-defaults')?.addEventListener('click', () => {
    if (confirm(t('confirmResetDefaults'))) {
      window.api.resetDefaultAccounts()
    }
  })

  container.querySelector('#btn-detect-apps')?.addEventListener('click', async () => {
    const listEl = container.querySelector('#local-apps-list')
    if (listEl) {
      listEl.innerHTML = `<div style="color: #60a5fa; padding: 6px 0; font-size: 11px;">${t('detectingApps')}</div>`
    }
    const apps = await window.api.detectLocalApps()
    if (apps && apps.length > 0) {
      cachedDetectedApps = apps
      hasDetectedApps = true
    }
    renderPopupView(container, state)
    window.api.refreshQuota()
  })

  container.querySelector('#btn-show-custom-form')?.addEventListener('click', () => {
    isAddingCustom = true
    renderPopupView(container, state)
  })

  container.querySelector('#btn-cancel-custom')?.addEventListener('click', () => {
    isAddingCustom = false
    renderPopupView(container, state)
  })

  container.querySelector('#btn-save-custom')?.addEventListener('click', () => {
    const name = (container.querySelector('#new-acc-name') as HTMLInputElement)?.value || 'Custom AI'
    const icon = (container.querySelector('#new-acc-icon') as HTMLInputElement)?.value || 'A'
    const color = (container.querySelector('#new-acc-color') as HTMLInputElement)?.value || '#D97757'
    const p5h = parseInt((container.querySelector('#new-acc-5h') as HTMLInputElement)?.value || '50', 10)
    const pwk = parseInt((container.querySelector('#new-acc-wk') as HTMLInputElement)?.value || '30', 10)

    window.api.addCustomAccount({
      name,
      provider: 'custom',
      customMock: {
        primaryPercent: p5h,
        primaryReset: '2h 15m',
        weeklyPercent: pwk,
        weeklyReset: '3d 20h',
        iconLetter: icon.toUpperCase(),
        brandColor: color
      }
    })

    isAddingCustom = false
  })

  // 설정 이벤트
  container.querySelectorAll('.theme-button[data-theme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme') as ThemeType
      if (theme) {
        window.api.updateConfig({ theme })
      }
    })
  })

  container.querySelector('#btn-icon-color')?.addEventListener('click', () => {
    window.api.updateConfig({ iconStyle: 'color' })
  })

  container.querySelector('#btn-icon-mono')?.addEventListener('click', () => {
    window.api.updateConfig({ iconStyle: 'monochrome' })
  })

  container.querySelector('#btn-place-docked')?.addEventListener('click', () => {
    window.api.updateConfig({ placementMode: 'docked' })
  })

  container.querySelector('#btn-place-floating')?.addEventListener('click', () => {
    window.api.updateConfig({ placementMode: 'floating', showCardBackground: true })
  })

  container.querySelector('#chk-always-on-top')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ alwaysOnTop: checked })
  })

  container.querySelector('#chk-open-at-login')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ openAtLogin: checked })
  })

  container.querySelector('#chk-double-click-popup')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ doubleClickToOpenPopup: checked })
  })

  container.querySelector('#chk-color-usage')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ colorByUsage: checked })
  })

  container.querySelector('#chk-show-used-percent')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ showUsedPercent: checked })
  })

  container.querySelector('#chk-show-card-bg')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ showCardBackground: checked })
  })

  container.querySelector('#btn-align-right')?.addEventListener('click', () => {
    window.api.updateConfig({ alignment: 'right' })
  })

  container.querySelector('#btn-align-left')?.addEventListener('click', () => {
    window.api.updateConfig({ alignment: 'left' })
  })

  // 가로/세로 오프셋 슬라이더 (조작 중 절대 꺼지지 않도록 잠금 + 디바운스 적용)
  for (const [key, id] of [['offsetPx', 'offset'], ['verticalOffsetPx', 'voffset']] as const) {
    const slider = container.querySelector(`#slider-${id}`) as HTMLInputElement
    if (!slider) continue

    const onStart = () => {
      isSliderDragging = true
      window.api.lockPopup()
    }
    slider.addEventListener('mousedown', onStart)
    slider.addEventListener('touchstart', onStart)

    slider.addEventListener('input', () => {
      const val = parseInt(slider.value, 10)
      const lbl = container.querySelector(`#label-${id}`)
      if (lbl) lbl.textContent = `${val}px`

      // 메인 프로세스로 디바운스 전송 (위젯 실시간 이동 & 팝업 동기 추종)
      if (offsetUpdateTimeout) clearTimeout(offsetUpdateTimeout)
      offsetUpdateTimeout = setTimeout(() => {
        window.api.updateConfig({ [key]: val })
      }, 50)
    })

    const onFinish = () => {
      isSliderDragging = false
      window.api.updateConfig({ [key]: parseInt(slider.value, 10) })
    }
    slider.addEventListener('change', onFinish)
    slider.addEventListener('mouseup', onFinish)
    slider.addEventListener('touchend', onFinish)
  }

  // 투명도 알파 슬라이더
  const sliderAlpha = container.querySelector('#slider-alpha') as HTMLInputElement
  if (sliderAlpha) {
    sliderAlpha.addEventListener('input', () => {
      const val = parseInt(sliderAlpha.value, 10)
      const lbl = container.querySelector('#label-alpha')
      if (lbl) lbl.textContent = `${val}%`
    })
    sliderAlpha.addEventListener('change', () => {
      const val = parseInt(sliderAlpha.value, 10)
      window.api.updateConfig({ alphaPercent: val })
    })
  }

  container.querySelector('#chk-api-push')?.addEventListener('change', (e) => {
    window.api.updateConfig({ apiPushEnabled: (e.target as HTMLInputElement).checked })
  })

  // change 는 blur/Enter 때만 발생 — 타이핑 중엔 저장하지 않는다
  const inpEndpoint = container.querySelector('#inp-api-endpoint') as HTMLInputElement
  inpEndpoint?.addEventListener('change', () => {
    const val = inpEndpoint.value.trim()
    if (/^https?:\/\/\S+$/i.test(val)) window.api.updateConfig({ apiEndpoint: val })
    else inpEndpoint.value = state.config.apiEndpoint || 'http://localhost:8080/api/usage'
  })

  const inpScreen = container.querySelector('#inp-api-screen') as HTMLInputElement
  inpScreen?.addEventListener('change', () => {
    const val = parseInt(inpScreen.value, 10)
    if (val >= 1) window.api.updateConfig({ apiScreen: val })
    else inpScreen.value = String(state.config.apiScreen ?? 1)
  })

  const selInterval = container.querySelector('#sel-interval') as HTMLSelectElement
  selInterval?.addEventListener('change', () => {
    const val = parseInt(selInterval.value, 10)
    window.api.updateConfig({ refreshIntervalSec: val })
  })
}
