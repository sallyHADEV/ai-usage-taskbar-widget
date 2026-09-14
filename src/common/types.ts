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
  projectId?: string
  status: 'ready' | 'loading' | 'error' | 'unauthenticated'
  errorMessage?: string
  primaryQuota: QuotaInfo // 5시간 또는 기본 한도
  weeklyQuota?: QuotaInfo // 주간 한도
  models?: ModelQuotaDetail[]
  updatedAt: string
}

export interface AccountConfig {
  id: string
  name: string
  provider: ProviderType
  enabled: boolean
  isLocalIde?: boolean
  tokens?: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    email?: string
    projectId?: string
  }
  customMock?: {
    primaryPercent: number
    primaryReset: string
    weeklyPercent: number
    weeklyReset: string
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
}

export interface AppState {
  config: WidgetConfig
  accounts: AccountConfig[]
  usages: AccountUsage[]
  isRefreshing: boolean
  lastRefreshedAt: string
}
