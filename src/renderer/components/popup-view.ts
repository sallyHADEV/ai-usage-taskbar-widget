import { parseUsageColor } from '../../common/time-utils.js'
import type { AccountConfig, AppState, ThemeType, WidgetConfig } from '../../common/types.js'
import { renderAiIcon } from './ai-icons.js'

let activeTab: 'usage' | 'accounts' | 'settings' = 'usage'
let isAddingCustom = false
let isSliderDragging = false

// 캐시된 감지 앱 목록
let cachedDetectedApps: any[] = [
  { id: 'local-antigravity', name: 'Google Antigravity', provider: 'antigravity', installed: true, running: true, iconLetter: 'A', brandColor: '#2563EB' },
  { id: 'local-claude-code', name: 'Claude Code', provider: 'claude', installed: true, running: true, iconLetter: 'C', brandColor: '#D97757' },
  { id: 'local-codex', name: 'Codex CLI', provider: 'codex', installed: true, running: false, iconLetter: 'X', brandColor: '#6366F1' }
]

export function renderPopupView(container: HTMLElement, state: AppState) {
  // 슬라이더 드래그 중에는 사용자 조작(포커스/마우스) 보호를 위해 전체 DOM 재작성 방지
  if (isSliderDragging) {
    return
  }

  container.innerHTML = `
    <div class="popup-root">
      <!-- 헤더 -->
      <div class="popup-header">
        <div class="popup-title">
          <span>AI 토큰 사용량</span>
          <span class="popup-title-badge">${state.usages.length} 계정 활성</span>
        </div>
        <div class="popup-actions">
          <button class="icon-button ${state.isRefreshing ? 'refreshing' : ''}" id="btn-refresh" title="새로고침">
            &#8635;
          </button>
          <button class="icon-button" id="btn-close-popup" title="닫기">
            &times;
          </button>
        </div>
      </div>

      <!-- 탭 -->
      <div class="popup-tabs">
        <div class="popup-tab ${activeTab === 'usage' ? 'active' : ''}" data-tab="usage">사용량 현황</div>
        <div class="popup-tab ${activeTab === 'accounts' ? 'active' : ''}" data-tab="accounts">계정 관리</div>
        <div class="popup-tab ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">위젯 설정</div>
      </div>

      <!-- 본문 -->
      <div class="popup-body">
        ${renderTabContent(state)}
      </div>
    </div>
  `

  bindPopupEvents(container, state)
}

function renderTabContent(state: AppState): string {
  if (activeTab === 'usage') {
    return renderUsageTab(state)
  }
  if (activeTab === 'accounts') {
    return renderAccountsTab(state)
  }
  return renderSettingsTab(state)
}

function renderUsageTab(state: AppState): string {
  if (state.usages.length === 0) {
    return `
      <div style="text-align: center; padding: 40px 10px; color: var(--text-muted);">
        <p>활성화된 계정이 없습니다.</p>
        <p style="margin-top: 8px; font-size: 11px;">[계정 관리] 탭에서 감지된 로컬 계정을 추가하세요.</p>
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
        <div class="model-list-title">모델별 세부 쿼터</div>
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
              <div class="card-account-email">${u.email || u.projectId || (u.status === 'error' ? u.errorMessage : '실시간 모니터링 중')}</div>
            </div>
          </div>
          <span class="card-badge ${u.status === 'error' ? 'error' : ''}">${u.tier || u.status}</span>
        </div>

        <div class="card-quota-grid">
          <div class="quota-box">
            <div class="quota-box-title">
              <span>5시간 세션 한도</span>
              <span>사용량</span>
            </div>
            <div class="quota-box-percent" style="color: ${primaryColor}">${primaryUsed}%</div>
            <div class="quota-box-reset">리셋: <strong>${u.primaryQuota.resetCountdown}</strong> 남음</div>
          </div>
          <div class="quota-box">
            <div class="quota-box-title">
              <span>주간 누적 한도</span>
              <span>사용량</span>
            </div>
            <div class="quota-box-percent" style="color: ${weeklyColor}">${weeklyUsed}%</div>
            <div class="quota-box-reset">리셋: <strong>${u.weeklyQuota?.resetCountdown || '--'}</strong> 남음</div>
          </div>
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
            <div style="font-size: 9px; color: var(--text-dim);">${acc.tokens?.email || (acc.isLocalIde ? '로컬 IDE 무인증 연동' : acc.provider.toUpperCase())}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 5px;">
          <button class="btn-order btn-move-up" data-id="${acc.id}" title="위로 이동" ${isFirst ? 'disabled style="opacity: 0.25; cursor: default;"' : 'style="cursor: pointer;"'}>▲</button>
          <button class="btn-order btn-move-down" data-id="${acc.id}" title="아래로 이동" ${isLast ? 'disabled style="opacity: 0.25; cursor: default;"' : 'style="cursor: pointer;"'}>▼</button>
          <button class="btn-danger btn-delete-account" data-id="${acc.id}" title="계정 삭제">삭제</button>
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
            <div style="font-size: 9px; color: var(--text-muted);">${app.running ? '현재 프로세스 실행 중' : (app.installed ? '로컬 설치 감지됨' : '프리셋 준비됨')}</div>
          </div>
        </div>
        <div>
          ${isAdded
            ? `<span style="color: #34d399; font-weight: 600; font-size: 10px; background: rgba(52, 211, 153, 0.12); padding: 3px 8px; border-radius: 4px;">✓ 추가됨</span>`
            : `<button class="btn-primary btn-add-detected" data-app-id="${app.id}" style="padding: 3px 10px; font-size: 10px; background: #2563EB;">+ 위젯에 추가</button>`
          }
        </div>
      </div>
    `
  }).join('')

  const localDetectorHtml = `
    <div class="card" style="padding: 10px 12px; background: rgba(37, 99, 235, 0.08); border-color: rgba(37, 99, 235, 0.3);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong style="font-size: 11px; color: #60a5fa;">로컬 AI 앱 자동 감지 (원클릭 추가)</strong>
        <button class="btn-secondary" id="btn-detect-apps" style="padding: 2px 8px; font-size: 10px;">다시 감지</button>
      </div>
      <div id="local-apps-list" style="display: flex; flex-direction: column; gap: 2px;">
        ${detectedItemsHtml}
      </div>
    </div>
  `

  const customFormHtml = isAddingCustom ? `
    <div class="card" style="margin-top: 10px; padding: 12px; background: rgba(0,0,0,0.3);">
      <div style="font-weight: 700; font-size: 12px; margin-bottom: 8px;">새 커스텀 계정 추가</div>
      <div class="form-group">
        <label class="form-label">계정 별칭</label>
        <input type="text" id="new-acc-name" value="Claude Work" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;" />
      </div>
      <div class="form-row">
        <div class="form-group" style="flex: 1;">
          <label class="form-label">아이콘 글자</label>
          <input type="text" id="new-acc-icon" value="C" maxlength="2" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;" />
        </div>
        <div class="form-group" style="flex: 1;">
          <label class="form-label">브랜드 색상</label>
          <input type="color" id="new-acc-color" value="#D97757" style="background: none; border: none; height: 30px; cursor: pointer; width: 100%;" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex: 1;">
          <label class="form-label">5H 사용량 (%)</label>
          <input type="number" id="new-acc-5h" min="0" max="100" value="45" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;" />
        </div>
        <div class="form-group" style="flex: 1;">
          <label class="form-label">주간 사용량 (%)</label>
          <input type="number" id="new-acc-wk" min="0" max="100" value="28" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;" />
        </div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button class="btn-primary" id="btn-save-custom" style="flex: 1;">저장</button>
        <button class="btn-secondary" id="btn-cancel-custom">취소</button>
      </div>
    </div>
  ` : `
    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
      <div style="display: flex; gap: 8px;">
        <button class="btn-primary" id="btn-add-google" style="flex: 1;">
          <span>+ Google OAuth 로그인</span>
        </button>
        <button class="btn-secondary" id="btn-show-custom-form">
          + 직접 입력
        </button>
      </div>
      <button class="btn-secondary" id="btn-reset-defaults" style="font-size: 11px; padding: 6px; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.15);">
        🔄 기본 3대 AI (Antigravity · Claude · Codex) 전체 초기화/복원
      </button>
    </div>
  `

  return `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${localDetectorHtml}
      <div style="font-size: 11px; color: var(--text-muted); margin: 4px 0 2px 0;">
        체크된 계정이 작업표시줄 위젯에 실시간 표시됩니다.
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
        <label class="form-label">위젯 테마 디자인</label>
        <div class="form-row">
          <button class="theme-button ${cfg.theme === '1a' ? 'active' : ''}" data-theme="1a">1a. 바 게이지</button>
          <button class="theme-button ${cfg.theme === '1b' ? 'active' : ''}" data-theme="1b">1b. 세그먼트</button>
          <button class="theme-button ${cfg.theme === '1c' ? 'active' : ''}" data-theme="1c">1c. 이중 링</button>
          <button class="theme-button ${cfg.theme === '1d' ? 'active' : ''}" data-theme="1d">1d. 초압축</button>
        </div>
      </div>

      <!-- 아이콘 스타일 -->
      <div class="form-group">
        <label class="form-label">AI 아이콘 스타일</label>
        <div class="form-row">
          <button class="theme-button ${cfg.iconStyle === 'color' ? 'active' : ''}" id="btn-icon-color">
            오리지널 컬러
          </button>
          <button class="theme-button ${cfg.iconStyle === 'monochrome' ? 'active' : ''}" id="btn-icon-mono">
            채도 없음 (모노크롬)
          </button>
        </div>
      </div>

      <!-- 윈도우 시작 시 자동 실행 -->
      <div class="form-group">
        <label class="form-label switch-container" for="chk-open-at-login">
          <span>윈도우 시작 시 자동 실행</span>
          <div class="md-switch">
            <input type="checkbox" id="chk-open-at-login" ${cfg.openAtLogin ? 'checked' : ''} />
            <div class="md-switch-track">
              <div class="md-switch-thumb"></div>
            </div>
          </div>
        </label>
      </div>

      <!-- 사용량에 따른 색상 변화 -->
      <div class="form-group">
        <label class="form-label switch-container" for="chk-color-usage">
          <span>사용량 임계값 색상 변화 (녹색 &rarr; 주황 &rarr; 빨강)</span>
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
          <span>위젯 배경 카드 표시 (해제 시 완전 투명 일체화)</span>
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
          <span>작업표시줄 바 표시 방식 (소모량 %로 표시)</span>
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
        <label class="form-label">위젯 배치 위치</label>
        <div class="form-row">
          <button class="theme-button ${cfg.placementMode !== 'floating' ? 'active' : ''}" id="btn-place-docked">
            작업표시줄 오버레이 (권장)
          </button>
          <button class="theme-button ${cfg.placementMode === 'floating' ? 'active' : ''}" id="btn-place-floating">
            작업 표시줄 바로 위
          </button>
        </div>
      </div>

      <!-- 항상 위에 표시 ('작업 표시줄 바로 위' 전용) -->
      <div class="form-group" id="group-always-on-top" style="${cfg.placementMode === 'floating' ? '' : 'display: none;'}">
        <label class="form-label switch-container" for="chk-always-on-top">
          <div>
            <span>항상 위에 표시</span>
            <div style="font-size: 9px; color: var(--text-muted); font-weight: 400;">
              다른 전체 화면 및 일반 창보다 항상 위에 떠 있도록 고정합니다
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
        <label class="form-label">위젯 위치 정렬</label>
        <div class="form-row">
          <button class="theme-button ${cfg.alignment === 'right' ? 'active' : ''}" id="btn-align-right">
            ${cfg.placementMode === 'floating' ? '우측 정렬 (화면 끝)' : '우측 정렬 (트레이 좌측)'}
          </button>
          <button class="theme-button ${cfg.alignment === 'left' ? 'active' : ''}" id="btn-align-left">
            ${cfg.placementMode === 'floating' ? '좌측 정렬 (화면 끝)' : '좌측 정렬 (시작버튼 우측)'}
          </button>
        </div>
      </div>

      <!-- 거리 오프셋 -->
      <div class="form-group">
        <div class="form-label">
          <span>위치 오프셋 간격</span>
          <span id="label-offset">${cfg.offsetPx}px</span>
        </div>
        <input type="range" class="range-slider" id="slider-offset" min="0" max="350" value="${cfg.offsetPx}" />
      </div>

      <!-- 투명도 알파 -->
      <div class="form-group">
        <div class="form-label">
          <span>작업표시줄 배경 투명도</span>
          <span id="label-alpha">${cfg.alphaPercent}%</span>
        </div>
        <input type="range" class="range-slider" id="slider-alpha" min="10" max="100" value="${cfg.alphaPercent}" />
      </div>

      <!-- 업데이트 주기 -->
      <div class="form-group">
        <label class="form-label">데이터 갱신 주기</label>
        <select id="sel-interval" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px; border-radius: 4px;">
          <option value="15" ${cfg.refreshIntervalSec === 15 ? 'selected' : ''}>15초</option>
          <option value="30" ${cfg.refreshIntervalSec === 30 ? 'selected' : ''}>30초</option>
          <option value="60" ${cfg.refreshIntervalSec === 60 ? 'selected' : ''}>1분 (기본)</option>
          <option value="120" ${cfg.refreshIntervalSec === 120 ? 'selected' : ''}>2분</option>
          <option value="300" ${cfg.refreshIntervalSec === 300 ? 'selected' : ''}>5분</option>
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
        if (activeTab === 'settings' || activeTab === 'accounts') {
          window.api.lockPopup() // 설정이나 계정 관리 조작 중에는 팝업 잠금 유지
        }
        renderPopupView(container, state)
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
      if (id && confirm('이 계정을 위젯에서 제거하시겠습니까? (로컬 앱 감지에서 언제든 다시 추가할 수 있습니다)')) {
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
    if (confirm('기본 3대 AI (Antigravity · Claude · Codex) 프리셋으로 복원하시겠습니까?')) {
      window.api.resetDefaultAccounts()
    }
  })

  container.querySelector('#btn-detect-apps')?.addEventListener('click', async () => {
    const listEl = container.querySelector('#local-apps-list')
    if (listEl) {
      listEl.innerHTML = '<div style="color: #60a5fa; padding: 6px 0; font-size: 11px;">로컬 프로세스 및 CLI 설치 경로 실시간 탐색 중...</div>'
    }
    const apps = await window.api.detectLocalApps()
    if (apps && apps.length > 0) {
      cachedDetectedApps = apps
    }
    renderPopupView(container, state)
    window.api.refreshQuota()
  })

  container.querySelector('#btn-add-google')?.addEventListener('click', async () => {
    const res = await window.api.addGoogleAccount()
    if (!res.success && res.error) {
      alert(`로그인 실패: ${res.error}`)
    }
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
        window.api.updateConfig({ ...state.config, theme })
      }
    })
  })

  container.querySelector('#btn-icon-color')?.addEventListener('click', () => {
    window.api.updateConfig({ ...state.config, iconStyle: 'color' })
  })

  container.querySelector('#btn-icon-mono')?.addEventListener('click', () => {
    window.api.updateConfig({ ...state.config, iconStyle: 'monochrome' })
  })

  container.querySelector('#btn-place-docked')?.addEventListener('click', () => {
    window.api.updateConfig({ ...state.config, placementMode: 'docked' })
  })

  container.querySelector('#btn-place-floating')?.addEventListener('click', () => {
    window.api.updateConfig({ ...state.config, placementMode: 'floating', showCardBackground: true })
  })

  container.querySelector('#chk-always-on-top')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ ...state.config, alwaysOnTop: checked })
  })

  container.querySelector('#chk-open-at-login')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ ...state.config, openAtLogin: checked })
  })

  container.querySelector('#chk-color-usage')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ ...state.config, colorByUsage: checked })
  })

  container.querySelector('#chk-show-used-percent')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ ...state.config, showUsedPercent: checked })
  })

  container.querySelector('#chk-show-card-bg')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked
    window.api.updateConfig({ ...state.config, showCardBackground: checked })
  })

  container.querySelector('#btn-align-right')?.addEventListener('click', () => {
    window.api.updateConfig({ ...state.config, alignment: 'right' })
  })

  container.querySelector('#btn-align-left')?.addEventListener('click', () => {
    window.api.updateConfig({ ...state.config, alignment: 'left' })
  })

  // 오프셋 슬라이더 (조작 중 절대 꺼지지 않도록 잠금 + 디바운스 적용)
  const sliderOffset = container.querySelector('#slider-offset') as HTMLInputElement
  if (sliderOffset) {
    sliderOffset.addEventListener('mousedown', () => {
      isSliderDragging = true
      window.api.lockPopup()
    })
    sliderOffset.addEventListener('touchstart', () => {
      isSliderDragging = true
      window.api.lockPopup()
    })

    sliderOffset.addEventListener('input', () => {
      const val = parseInt(sliderOffset.value, 10)
      const lbl = container.querySelector('#label-offset')
      if (lbl) lbl.textContent = `${val}px`

      // 메인 프로세스로 디바운스 전송 (위젯 실시간 이동 & 팝업 동기 추종)
      if (offsetUpdateTimeout) clearTimeout(offsetUpdateTimeout)
      offsetUpdateTimeout = setTimeout(() => {
        window.api.updateConfig({ ...state.config, offsetPx: val })
      }, 50)
    })

    const onFinishOffset = () => {
      isSliderDragging = false
      const val = parseInt(sliderOffset.value, 10)
      window.api.updateConfig({ ...state.config, offsetPx: val })
    }

    sliderOffset.addEventListener('change', onFinishOffset)
    sliderOffset.addEventListener('mouseup', onFinishOffset)
    sliderOffset.addEventListener('touchend', onFinishOffset)
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
      window.api.updateConfig({ ...state.config, alphaPercent: val })
    })
  }

  const selInterval = container.querySelector('#sel-interval') as HTMLSelectElement
  selInterval?.addEventListener('change', () => {
    const val = parseInt(selInterval.value, 10)
    window.api.updateConfig({ ...state.config, refreshIntervalSec: val })
  })
}
