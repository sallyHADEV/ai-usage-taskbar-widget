export function formatCountdown(targetDateOrMs: string | number | undefined): string {
  if (!targetDateOrMs) return '--'

  const targetMs = typeof targetDateOrMs === 'number' 
    ? targetDateOrMs 
    : new Date(targetDateOrMs).getTime()

  if (isNaN(targetMs)) return '--'

  const diffMs = targetMs - Date.now()
  if (diffMs <= 0) return '0m'

  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  const minutes = totalMinutes % 60

  if (days > 0) {
    return `${days}d ${remainingHours}h`
  }
  if (hours > 0) {
    const padMin = minutes < 10 ? `0${minutes}` : `${minutes}`
    return `${hours}h ${padMin}m`
  }
  return `${minutes}m`
}

export function parseUsageColor(percentUsed: number, colorByUsage: boolean, defaultBrandColor: string): string {
  if (!colorByUsage) {
    return defaultBrandColor
  }
  // 사용량 임계값 기반 색상
  // 0~60%: 안전 (에메랄드/그린/민트)
  // 60~85%: 주의 (오렌지/옐로우)
  // 85~100%: 위험 (핫핑크/네온 레드)
  if (percentUsed >= 85) {
    return '#F43F5E' // rose-500
  }
  if (percentUsed >= 60) {
    return '#F97316' // orange-500
  }
  return '#10B981' // emerald-500
}
