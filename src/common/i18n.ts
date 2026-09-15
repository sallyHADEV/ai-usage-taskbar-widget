export type Lang = 'ko' | 'en'

// 시스템 로케일 문자열(예: 'ko-KR', 'en-US')로부터 지원 언어 판별. ko 외에는 전부 영어로 폴백.
export function detectLang(rawLocale: string | undefined | null): Lang {
  return (rawLocale || '').toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

const dict = {
  trayToggleWidget: { ko: '위젯 표시/숨김', en: 'Show/Hide Widget' },
  trayOpenPopup: { ko: '상세 팝업 열기', en: 'Open Details' },
  trayAutoLaunch: { ko: '윈도우 시작 시 자동 실행', en: 'Launch at Login' },
  trayRefreshNow: { ko: '지금 새로고침', en: 'Refresh Now' },
  trayAddGoogle: { ko: 'Google 계정 추가...', en: 'Add Google Account...' },
  trayQuit: { ko: '종료', en: 'Quit' },
  trayTooltip: { ko: 'AI 토큰 사용량 위젯', en: 'AI Token Usage Widget' },

  popupTitle: { ko: 'AI 토큰 사용량', en: 'AI Token Usage' },
  accountsActive: { ko: '{count} 계정 활성', en: '{count} accounts active' },
  refresh: { ko: '새로고침', en: 'Refresh' },
  close: { ko: '닫기', en: 'Close' },

  tabUsage: { ko: '사용량 현황', en: 'Usage' },
  tabAccounts: { ko: '계정 관리', en: 'Accounts' },
  tabSettings: { ko: '위젯 설정', en: 'Settings' },

  noActiveAccounts: { ko: '활성화된 계정이 없습니다.', en: 'No active accounts.' },
  addAccountHint: { ko: '[계정 관리] 탭에서 감지된 로컬 계정을 추가하세요.', en: 'Add a detected local account from the [Accounts] tab.' },
  realtimeMonitoring: { ko: '실시간 모니터링 중', en: 'Live monitoring' },
  modelQuotaTitle: { ko: '모델별 세부 쿼터', en: 'Per-model quota' },
  sessionLimit5h: { ko: '5시간 세션 한도', en: '5-Hour Session Limit' },
  usageLabel: { ko: '사용량', en: 'Usage' },
  resetLabel: { ko: '리셋: {time} 남음', en: 'Resets in {time}' },
  weeklyLimit: { ko: '주간 누적 한도', en: 'Weekly Limit' },

  localIdeNoAuth: { ko: '로컬 IDE 무인증 연동', en: 'Local IDE (no login required)' },
  moveUp: { ko: '위로 이동', en: 'Move Up' },
  moveDown: { ko: '아래로 이동', en: 'Move Down' },
  deleteAccountTitle: { ko: '계정 삭제', en: 'Delete Account' },
  deleteAccountBtn: { ko: '삭제', en: 'Delete' },
  runningNow: { ko: '현재 프로세스 실행 중', en: 'Currently running' },
  localInstallDetected: { ko: '로컬 설치 감지됨', en: 'Installed locally' },
  presetReady: { ko: '프리셋 준비됨', en: 'Preset ready' },
  added: { ko: '✓ 추가됨', en: '✓ Added' },
  addToWidget: { ko: '+ 위젯에 추가', en: '+ Add to widget' },
  localDetectTitle: { ko: '로컬 AI 앱 자동 감지 (원클릭 추가)', en: 'Auto-detect local AI apps (one-click add)' },
  redetect: { ko: '다시 감지', en: 'Re-scan' },
  checkedAccountsHint: { ko: '체크된 계정이 작업표시줄 위젯에 실시간 표시됩니다.', en: 'Checked accounts are shown live on the taskbar widget.' },
  addCustomAccountTitle: { ko: '새 커스텀 계정 추가', en: 'Add Custom Account' },
  accountAlias: { ko: '계정 별칭', en: 'Account Name' },
  iconLetterLabel: { ko: '아이콘 글자', en: 'Icon Letter' },
  brandColorLabel: { ko: '브랜드 색상', en: 'Brand Color' },
  usage5h: { ko: '5H 사용량 (%)', en: '5H Usage (%)' },
  usageWeekly: { ko: '주간 사용량 (%)', en: 'Weekly Usage (%)' },
  save: { ko: '저장', en: 'Save' },
  cancel: { ko: '취소', en: 'Cancel' },
  addGoogleOAuth: { ko: '+ Google OAuth 로그인', en: '+ Sign in with Google' },
  addManually: { ko: '+ 직접 입력', en: '+ Add Manually' },
  resetDefaults: { ko: '🔄 기본 3대 AI (Antigravity · Claude · Codex) 전체 초기화/복원', en: '🔄 Reset to Default 3 AIs (Antigravity · Claude · Codex)' },
  detectingApps: { ko: '로컬 프로세스 및 CLI 설치 경로 실시간 탐색 중...', en: 'Scanning local processes and CLI install paths...' },
  confirmDeleteAccount: { ko: '이 계정을 위젯에서 제거하시겠습니까? (로컬 앱 감지에서 언제든 다시 추가할 수 있습니다)', en: 'Remove this account from the widget? (You can re-add it anytime via local app detection.)' },
  confirmResetDefaults: { ko: '기본 3대 AI (Antigravity · Claude · Codex) 프리셋으로 복원하시겠습니까?', en: 'Restore the default 3 AI presets (Antigravity · Claude · Codex)?' },
  loginFailedAlert: { ko: '로그인 실패: {error}', en: 'Login failed: {error}' },

  widgetTheme: { ko: '위젯 테마 디자인', en: 'Widget Theme' },
  theme1a: { ko: '1a. 바 게이지', en: '1a. Bar Gauge' },
  theme1b: { ko: '1b. 세그먼트', en: '1b. Segments' },
  theme1c: { ko: '1c. 이중 링', en: '1c. Dual Ring' },
  theme1d: { ko: '1d. 초압축', en: '1d. Ultra Compact' },
  iconStyleLabel: { ko: 'AI 아이콘 스타일', en: 'AI Icon Style' },
  iconColor: { ko: '오리지널 컬러', en: 'Original Color' },
  iconMono: { ko: '채도 없음 (모노크롬)', en: 'Monochrome' },
  launchAtLogin: { ko: '윈도우 시작 시 자동 실행', en: 'Launch at Login' },
  colorByUsageLabel: { ko: '사용량 임계값 색상 변화 (녹색 → 주황 → 빨강)', en: 'Color by Usage (Green → Orange → Red)' },
  showCardBg: { ko: '위젯 배경 카드 표시 (해제 시 완전 투명 일체화)', en: 'Show Background Card (off = fully transparent)' },
  showUsedPercentLabel: { ko: '작업표시줄 바 표시 방식 (소모량 %로 표시)', en: 'Taskbar Display Mode (show used %)' },
  placementLabel: { ko: '위젯 배치 위치', en: 'Widget Placement' },
  placementDocked: { ko: '작업표시줄 오버레이 (권장)', en: 'Taskbar Overlay (Recommended)' },
  placementFloating: { ko: '작업 표시줄 바로 위', en: 'Above Taskbar' },
  alwaysOnTopLabel: { ko: '항상 위에 표시', en: 'Always on Top' },
  alwaysOnTopDesc: { ko: '다른 전체 화면 및 일반 창보다 항상 위에 떠 있도록 고정합니다', en: 'Keeps the widget pinned above other windows and fullscreen apps' },
  alignmentLabel: { ko: '위젯 위치 정렬', en: 'Widget Alignment' },
  alignRightFloating: { ko: '우측 정렬 (화면 끝)', en: 'Right (screen edge)' },
  alignRightDocked: { ko: '우측 정렬 (트레이 좌측)', en: 'Right (left of tray)' },
  alignLeftFloating: { ko: '좌측 정렬 (화면 끝)', en: 'Left (screen edge)' },
  alignLeftDocked: { ko: '좌측 정렬 (작업표시줄 왼쪽)', en: 'Left (taskbar left edge)' },
  offsetLabel: { ko: '위치 오프셋 간격', en: 'Offset Distance' },
  alphaLabel: { ko: '작업표시줄 배경 투명도', en: 'Taskbar Background Opacity' },
  refreshIntervalLabel: { ko: '데이터 갱신 주기', en: 'Refresh Interval' },
  interval15: { ko: '15초', en: '15s' },
  interval30: { ko: '30초', en: '30s' },
  interval60: { ko: '1분 (기본)', en: '1 min (default)' },
  interval120: { ko: '2분', en: '2 min' },
  interval300: { ko: '5분', en: '5 min' },

  unitUsed: { ko: '소모', en: 'used' },
  unitLeft: { ko: '남음', en: 'left' },
  widgetTooltip: { ko: '{name} | 5시간: {p}% {unit} ({pr}) | 주간: {w}% {unit} ({wr})', en: '{name} | 5H: {p}% {unit} ({pr}) | Weekly: {w}% {unit} ({wr})' },
  widgetTooltipNoWeekly: { ko: '{name} | {p}% {unit} ({pr})', en: '{name} | {p}% {unit} ({pr})' },
  widgetTooltipWeeklyOnly: { ko: '{name} | 주간: {w}% {unit} ({wr})', en: '{name} | Weekly: {w}% {unit} ({wr})' },
  noAccountTitle: { ko: '연결된 AI 계정 없음 (클릭하여 계정 추가 또는 로컬 앱 감지)', en: 'No AI account connected (click to add or auto-detect)' },
  widgetClickTitle: { ko: '클릭하여 상세 정보 및 설정 열기', en: 'Click for details and settings' }
} satisfies Record<string, Record<Lang, string>>

export type I18nKey = keyof typeof dict

let currentLang: Lang = 'ko'

export function setLang(lang: Lang) {
  currentLang = lang
}

export function getLang(): Lang {
  return currentLang
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let str = dict[key][currentLang]
  if (vars) {
    for (const k of Object.keys(vars)) {
      str = str.replaceAll(`{${k}}`, String(vars[k]))
    }
  }
  return str
}
