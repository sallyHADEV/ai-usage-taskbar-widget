import { screen } from 'electron'
import type { PositionAlignment, WidgetConfig } from '../common/types.js'

export interface TaskbarBounds {
  taskbarY: number
  taskbarHeight: number
  taskbarWidth: number
  position: 'bottom' | 'top' | 'left' | 'right'
}

export function getTaskbarInfo(): TaskbarBounds {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { bounds, workArea } = primaryDisplay

  // 하단 작업표시줄 감지 (Windows 기본)
  if (workArea.y === bounds.y && workArea.height < bounds.height) {
    return {
      taskbarY: workArea.height,
      taskbarHeight: bounds.height - workArea.height,
      taskbarWidth: bounds.width,
      position: 'bottom'
    }
  }

  // 상단 작업표시줄
  if (workArea.y > bounds.y) {
    return {
      taskbarY: bounds.y,
      taskbarHeight: workArea.y - bounds.y,
      taskbarWidth: bounds.width,
      position: 'top'
    }
  }

  // 기본값 (일반적인 Windows 11 하단 48px)
  return {
    taskbarY: bounds.height - 48,
    taskbarHeight: 48,
    taskbarWidth: bounds.width,
    position: 'bottom'
  }
}

export function calculateWidgetPosition(
  config: WidgetConfig,
  widgetWidth: number,
  widgetHeight: number
): { x: number; y: number } {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { bounds } = primaryDisplay
  const taskbar = getTaskbarInfo()
  const trayWidth = 220
  const offset = Math.max(0, config.offsetPx !== undefined ? config.offsetPx : 20)

  let x: number
  if (config.alignment === 'left') {
    x = 64 + offset
  } else {
    x = bounds.width - trayWidth - widgetWidth - offset
  }
  x = Math.max(12, Math.min(x, bounds.width - widgetWidth - 12))

  let y: number
  if (config.placementMode === 'floating') {
    y = taskbar.taskbarY - widgetHeight - 4 + (config.verticalOffsetPx || 0)
  } else {
    const d = Math.max(0, Math.floor((taskbar.taskbarHeight - widgetHeight) / 2))
    y = taskbar.taskbarY + d + (config.verticalOffsetPx || 0)
  }

  return { x, y }
}

export function calculatePopupPosition(
  widgetX: number,
  widgetWidth: number,
  popupWidth: number,
  popupHeight: number,
  widgetY?: number
): { x: number; y: number } {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { workArea } = primaryDisplay
  const taskbar = getTaskbarInfo()

  // 위젯 가로 중앙에 팝업 가로 중앙 정렬
  let x = Math.round(widgetX + (widgetWidth / 2) - (popupWidth / 2))
  x = Math.max(workArea.x + 12, Math.min(x, workArea.x + workArea.width - popupWidth - 12))

  // 상단 작업표시줄 대응
  if (taskbar.position === 'top') {
    const referenceY = (widgetY !== undefined && widgetY > taskbar.taskbarY)
      ? widgetY + 36
      : (taskbar.taskbarY + taskbar.taskbarHeight)
    let y = referenceY + 8
    y = Math.min(workArea.y + workArea.height - popupHeight - 12, y)
    return { x, y }
  }

  const referenceY = (widgetY !== undefined && widgetY < taskbar.taskbarY)
    ? widgetY
    : taskbar.taskbarY
  let y = referenceY - popupHeight - 8

  // 화면 상단(workArea.y) 밖으로 나가지 않도록 클램핑
  y = Math.max(workArea.y + 8, y)

  return { x, y }
}
