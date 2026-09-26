export type ThemeType = '1a' | '1b' | '1c' | '1d'
export type IconStyle = 'color' | 'monochrome'
export type PositionAlignment = 'right' | 'left'
export type ProviderType = 'google' | 'claude' | 'mistral' | 'xai' | 'openai' | 'antigravity' | 'codex' | 'custom'

export interface QuotaInfo {
  remainingFraction: number // 0.0 ~ 1.0 (남은 비율)
  percentLeft: number // 0 ~ 100% (남은 비율 %)
  percentUsed: number // 0 ~ 100% (사용한 비율 %)
  resetTime?: string // ISO date
  resetCountdown: string // "2h 41m", "3d 9h", "47m"
  timeUntilResetMs?: number
  isExhausted?: boolean
}

export interface ModelQuotaDetail {
  modelId: string
  displayName: string
  quota: QuotaInfo
}

export interface AccountUsage {
  id: string
  name: string
  provider: ProviderType
  iconLetter: string // C, G, M, X 등
  brandColor: string // #FF6B4A, #4285F4, #00D1B2, #D946EF 등
  email?: string
  tier?: string
  dataSource?: 'claude-cli' | 'claude-desktop'
  projectId?: string
  // 'stale' = 마지막 성공 실측값을 그대로 보여주는 중 (갱신 실패). updatedAt은 그 실측 시각을 유지한다
  status: 'ready' | 'loading' | 'error' | 'unauthenticated' | 'stale'
  errorMessage?: string
  // 실측이 아니라 추정/수동 입력값임을 표시 (Codex SQLite 토큰 추정, 사용자가 직접 넣은 custom 계정)
  isEstimated?: boolean
  primaryQuota: QuotaInfo // 5시간 또는 기본 한도
  weeklyQuota?: QuotaInfo // 주간 한도
  isWeeklyOnly?: boolean // ChatGPT Pro 등 5시간 세션 쿼터 없이 1주일 쿼터만 존재하는 계정 여부
  models?: ModelQuotaDetail[]
  updatedAt: string
}

export interface AccountConfig {
  id: string
  name: string
  provider: ProviderType
  enabled: boolean
  isLocalIde?: boolean
  customMock?: {
    primaryPercent: number
    primaryReset: string
    weeklyPercent: number
    weeklyReset: string
    isWeeklyOnly?: boolean
    iconLetter?: string
    brandColor?: string
  }
}

export interface WidgetConfig {
  theme: ThemeType // '1a' | '1b' | '1c' | '1d'
  iconStyle: IconStyle // 'color' | 'monochrome'
  alignment: PositionAlignment // 'right' | 'left'
  offsetPx: number // 트레이 또는 모서리로부터 떨어진 거리 (기본 16px)
  verticalOffsetPx: number // 작업표시줄 상하 미세조정 (기본 0px)
  refreshIntervalSec: number // 갱신 주기 (기본 60초)
  alphaPercent: number // 투명도 (기본 20% -> 0.8 알파 or 투명 배경)
  showWeeklyLimit: boolean
  colorByUsage: boolean // 사용량에 따른 색상 변화 (안전:그린 -> 주의:오렌지 -> 위험:레드)
  showUsedPercent?: boolean // true: 소모량(%) 표시, false/미설정: 남은량(%) 표시 (작업표시줄 바)
  placementMode?: 'docked' | 'floating' // 작업표시줄 내부 도킹 vs 작업표시줄 바로 위 플로팅
  alwaysOnTop?: boolean // '작업 표시줄 바로 위' 플로팅 모드 시 항상 위에 표시 여부 (기본: true)
  showCardBackground?: boolean // 배경 카드 박스 표시 여부 (false 시 완전 투명/작업표시줄 일체화)
  openAtLogin?: boolean // 윈도우 시작 시 자동 실행
  doubleClickToOpenPopup?: boolean // true면 위젯 더블클릭으로만 상세 팝업 열기 (기본 false)
  apiPushEnabled?: boolean // 쿼터 갱신 시 사용량을 apiEndpoint 로 POST (기본 false)
  apiEndpoint?: string // 기본 http://localhost:8080/api/usage
  apiScreen?: number // 페이로드의 screen 번호 (기본 1)
}

export interface AppState {
  config: WidgetConfig
  accounts: AccountConfig[]
  usages: AccountUsage[]
  isRefreshing: boolean
  lastRefreshedAt: string
}
