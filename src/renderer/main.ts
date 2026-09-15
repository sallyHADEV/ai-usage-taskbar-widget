import { renderPopupView } from './components/popup-view.js'
import { renderTheme1a } from './components/theme-1a.js'
import { renderTheme1b } from './components/theme-1b.js'
import { renderTheme1c } from './components/theme-1c.js'
import { renderTheme1d } from './components/theme-1d.js'
import type { AppState } from '../common/types.js'
import { detectLang, setLang, t } from '../common/i18n.js'

const lang = detectLang(navigator.language)
setLang(lang)
document.documentElement.lang = lang

const urlParams = new URLSearchParams(window.location.search)
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
const viewType = urlParams.get('view') || hashParams.get('view') || (window.location.hash.includes('popup') ? 'popup' : 'widget')
const appEl = document.getElementById('app')!

if (viewType === 'popup') {
  document.body.classList.add('is-popup-view')
} else {
  document.body.classList.add('is-widget-view')
}

let currentState: AppState | null = null
let lastWidgetHtml = ''
let lastSentWidth = 0
let lastSentHeight = 0

function updateRootAlpha(alphaPercent: number) {
  const alpha = Math.max(0.1, Math.min(1.0, alphaPercent / 100))
  document.documentElement.style.setProperty('--bg-alpha', alpha.toString())
}

function updateVerticalOffset(offsetPx?: number) {
  document.documentElement.style.setProperty('--vertical-offset', `${offsetPx || 0}px`)
}

function renderWidget(state: AppState) {
  currentState = state
  updateRootAlpha(state.config.alphaPercent)
  updateVerticalOffset(state.config.verticalOffsetPx)

  const activeUsages = state.usages
  const isEmpty = activeUsages.length === 0
  let accountsHtml = ''

  if (isEmpty) {
    // 연결된 계정이 없을 때: 하얀색 작은 동그라미 더미 아이콘 표시
    accountsHtml = `
      <div class="white-circle-dot" title="${t('noAccountTitle')}"></div>
    `
  } else {
    accountsHtml = activeUsages.map((u) => {
      switch (state.config.theme) {
        case '1b':
          return renderTheme1b(u, state.config)
        case '1c':
          return renderTheme1c(u, state.config)
        case '1d':
          return renderTheme1d(u, state.config)
        case '1a':
        default:
          return renderTheme1a(u, state.config)
      }
    }).join('')
  }

  const showCard = state.config.showCardBackground ?? false
  const newHtml = `
    <div class="widget-root ${isEmpty ? 'is-empty' : ''} ${showCard ? 'has-card-bg' : 'no-card-bg'}" id="widget-container" title="${t('widgetClickTitle')}">
      ${accountsHtml}
    </div>
  `

  // 내용 또는 스타일 설정 변경 시에만 DOM 교체하여 깜빡임 방지
  const renderSignature = `${newHtml}_${showCard}_${state.config.theme}_${state.config.iconStyle}`
  if (renderSignature !== lastWidgetHtml) {
    lastWidgetHtml = renderSignature
    appEl.innerHTML = newHtml

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = document.getElementById('widget-container')
        if (container) {
          const rect = container.getBoundingClientRect()
          const naturalWidth = Math.max(rect.width, container.scrollWidth)
          // 여유 너비 +24px, 높이는 34px 기본에 맞춰 설정
          const width = Math.ceil(naturalWidth) + 24
          const height = Math.max(34, Math.ceil(rect.height) + 4)
          if (width !== lastSentWidth || height !== lastSentHeight) {
            lastSentWidth = width
            lastSentHeight = height
            window.api.resizeWidget(width, height)
          }
        }
      })
    })
  }
}

function renderPopup(state: AppState) {
  currentState = state
  renderPopupView(appEl, state)
}

// 브라우저 직접 접근 및 E2E 테스트 지원을 위한 Mock API
if (!(window as any).api) {
  let mockState: AppState = {
    config: {
      theme: '1b',
      iconStyle: 'color',
      alignment: 'right',
      offsetPx: 20,
      verticalOffsetPx: 0,
      refreshIntervalSec: 60,
      alphaPercent: 85,
      showWeeklyLimit: true,
      colorByUsage: true,
      showCardBackground: false
    },
    accounts: [
      { id: 'local-antigravity', name: 'Google Antigravity', provider: 'antigravity', enabled: true },
      { id: 'local-claude-code', name: 'Claude Code', provider: 'claude', enabled: true },
      { id: 'local-codex', name: 'Codex CLI', provider: 'codex', enabled: true }
    ],
    usages: [
      {
        id: 'acc-antigravity',
        name: 'Antigravity (Local IDE)',
        provider: 'antigravity',
        iconLetter: 'A',
        brandColor: '#2563EB',
        status: 'ready',
        primaryQuota: { remainingFraction: 0.63, percentLeft: 63, percentUsed: 37, resetCountdown: '3h 28m' },
        weeklyQuota: { remainingFraction: 0.88, percentLeft: 88, percentUsed: 12, resetCountdown: '5d 14h' },
        updatedAt: new Date().toISOString()
      },
      {
        id: 'acc-claude',
        name: 'Claude Code',
        provider: 'claude',
        iconLetter: 'C',
        brandColor: '#D97757',
        status: 'ready',
        primaryQuota: { remainingFraction: 0.32, percentLeft: 32, percentUsed: 68, resetCountdown: '2h 41m' },
        weeklyQuota: { remainingFraction: 0.58, percentLeft: 58, percentUsed: 42, resetCountdown: '3d 9h' },
        updatedAt: new Date().toISOString()
      },
      {
        id: 'acc-codex',
        name: 'Codex CLI',
        provider: 'codex',
        iconLetter: 'X',
        brandColor: '#6366F1',
        status: 'ready',
        primaryQuota: { remainingFraction: 0.46, percentLeft: 46, percentUsed: 54, resetCountdown: '1h 50m' },
        weeklyQuota: { remainingFraction: 0.62, percentLeft: 62, percentUsed: 38, resetCountdown: '4d 20h' },
        updatedAt: new Date().toISOString()
      }
    ],
    isRefreshing: false,
    lastRefreshedAt: new Date().toISOString()
  }

  const listeners: ((s: AppState) => void)[] = []
  ;(window as any).api = {
    getState: async () => mockState,
    updateConfig: async (patch: any) => {
      mockState = { ...mockState, config: { ...mockState.config, ...patch } }
      listeners.forEach((fn) => fn(mockState))
      return mockState
    },
    refreshQuota: async () => mockState,
    addGoogleAccount: async () => ({ success: true }),
    addCustomAccount: async () => mockState,
    restoreDetectedApp: async (app: any) => {
      if (!mockState.accounts.some(a => a.id === app.id)) {
        mockState.accounts.push({ id: app.id, name: app.name, provider: app.provider, enabled: true })
      }
      listeners.forEach((fn) => fn(mockState))
      return mockState
    },
    resetDefaultAccounts: async () => {
      mockState.accounts = [
        { id: 'local-antigravity', name: 'Google Antigravity', provider: 'antigravity', enabled: true },
        { id: 'local-claude-code', name: 'Claude Code', provider: 'claude', enabled: true },
        { id: 'local-codex', name: 'Codex CLI', provider: 'codex', enabled: true }
      ]
      listeners.forEach((fn) => fn(mockState))
      return mockState
    },
    toggleAccount: async () => mockState,
    removeAccount: async (id: string) => {
      mockState.accounts = mockState.accounts.filter(a => a.id !== id)
      listeners.forEach((fn) => fn(mockState))
      return mockState
    },
    reorderAccount: async (id: string, direction: 'up' | 'down') => {
      const idx = mockState.accounts.findIndex(a => a.id === id)
      if (idx >= 0) {
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1
        if (targetIdx >= 0 && targetIdx < mockState.accounts.length) {
          const temp = mockState.accounts[idx]
          mockState.accounts[idx] = mockState.accounts[targetIdx]
          mockState.accounts[targetIdx] = temp
        }
      }
      // usages 순서도 계정 순서와 일치하도록 동기화
      const sortedUsages: any[] = []
      for (const acc of mockState.accounts) {
        const u = mockState.usages.find(item => item.id === acc.id || item.name.toLowerCase().includes(acc.name.toLowerCase().split(' ')[0]))
        if (u) sortedUsages.push(u)
      }
      mockState.usages = sortedUsages
      listeners.forEach((fn) => fn(mockState))
      return mockState
    },
    showPopup: () => console.log('[MockAPI] showPopup'),
    hidePopup: () => console.log('[MockAPI] hidePopup'),
    togglePopup: () => console.log('[MockAPI] togglePopup'),
    lockPopup: () => console.log('[MockAPI] lockPopup'),
    unlockPopup: () => console.log('[MockAPI] unlockPopup'),
    resizeWidget: (w: number, h: number) => console.log(`[MockAPI] resizeWidget: ${w}x${h}`),
    openSettings: () => console.log('[MockAPI] openSettings'),
    detectLocalApps: async () => [
      { id: 'local-antigravity', name: 'Google Antigravity', provider: 'antigravity', running: true, installed: true, brandColor: '#2563EB' },
      { id: 'local-claude-code', name: 'Claude Code', provider: 'claude', running: true, installed: true, brandColor: '#D97757' },
      { id: 'local-codex', name: 'Codex CLI', provider: 'codex', running: false, installed: true, brandColor: '#6366F1' }
    ],
    scheduleHidePopup: () => {},
    cancelHidePopup: () => {},
    popupReady: () => {},
    onPopupOpened: () => {},
    onStateChange: (fn: (s: AppState) => void) => {
      listeners.push(fn)
    }
  }
}

async function init() {
  // 클릭 리스너는 state를 필요로 하지 않으므로, 창이 화면에 보이자마자(getState
  // IPC 왕복을 기다리기 전에) 먼저 붙여둔다. 개발 모드(Vite dev server)는 번들이
  // 아니라 개별 모듈을 네트워크로 받아오는 방식이라 이 왕복이 느려질 수 있는데,
  // 그 사이에 창은 이미 떠 있어서 클릭해도 반응이 없는 것처럼 보이는 문제를 줄인다.
  if (viewType === 'popup') {
    // ESC 키 입력 시 팝업 닫기
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.api.hidePopup()
      }
    })
  } else {
    // 위젯 클릭 이벤트 시 팝업 토글 (중복 트리거 방지 디바운스 적용)
    let lastToggleTime = 0
    const triggerToggle = (e: Event) => {
      e.stopPropagation()
      const now = Date.now()
      if (now - lastToggleTime < 300) return
      lastToggleTime = now
      console.log('[Widget] Click event handled, invoking togglePopup')
      window.api.togglePopup()
    }

    appEl.addEventListener('click', triggerToggle)
  }

  const state = await window.api.getState()

  if (viewType === 'popup') {
    renderPopup(state)
    window.api.onStateChange((nextState) => {
      renderPopup(nextState)
    })
    // 메인이 팝업을 투명하게 띄운 상태: 등장 애니메이션 첫 프레임이 화면에 반영된 뒤 불투명 전환 요청
    window.api.onPopupOpened((nextState) => {
      currentState = nextState
      renderPopupView(appEl, nextState, true)
      requestAnimationFrame(() => requestAnimationFrame(() => window.api.popupReady()))
    })
  } else {
    renderWidget(state)
    window.api.onStateChange((nextState) => {
      renderWidget(nextState)
    })
  }
}

init().catch((err) => {
  console.error('[Renderer] Init error:', err)
})
