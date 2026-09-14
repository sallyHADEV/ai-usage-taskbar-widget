import type { IconStyle } from '../../common/types.js'
import { ICON_ANTIGRAVITY_B64, ICON_CLAUDE_B64, ICON_CODEX_B64 } from './icon-assets.js'

/**
 * AI 브랜드별 오리지널 공식 SVG 벡터 및 사용자 지정 이미지 정의
 */

// 1. Anthropic Claude (사용자 지정 공식 14갈래 스파크)
const CLAUDE_SVG = `
<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
  <path d="M12 2l1.2 5.5L18 4l-3 4.8 5.8.5-5 3 4.2 4-5.4.3 2 5.4-4.8-3-1 5.8-1.5-5.5-4.5 3.5 1.5-5.5-5.5-1 5-3.2-4-4.5 5.5 1L10.5 2z"/>
</svg>
`

// 2. OpenAI / Codex (구름 모양 터미널 프롬프트)
const CODEX_SVG = `
<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="#6366F1"/>
  <path d="M7.5 11.5l2.5 2.5-2.5 2.5M12.5 16.5h3" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
`

// 3. Google Gemini (공식 4각 다이아몬드 스파크)
const GEMINI_SVG = `
<svg viewBox="0 0 24 24" width="16" height="16">
  <defs>
    <linearGradient id="geminiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4E82EE"/>
      <stop offset="50%" stop-color="#9B72CB"/>
      <stop offset="100%" stop-color="#D96570"/>
    </linearGradient>
  </defs>
  <path fill="url(#geminiGrad)" d="M12 1C12 7.075 7.075 12 1 12C7.075 12 12 16.925 12 23C12 16.925 16.925 12 23 12C16.925 12 12 7.075 12 1Z"/>
</svg>
`

// 4. Google Antigravity (사용자 지정 무지개 가우스 아치 A자 로고)
const ANTIGRAVITY_SVG = `
<svg viewBox="0 0 24 24" width="16" height="16">
  <defs>
    <linearGradient id="agyArchGrad" x1="0%" y1="100%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E70F5"/>
      <stop offset="25%" stop-color="#43B957"/>
      <stop offset="50%" stop-color="#EB572A"/>
      <stop offset="75%" stop-color="#7E57C2"/>
      <stop offset="100%" stop-color="#2176FF"/>
    </linearGradient>
  </defs>
  <path fill="url(#agyArchGrad)" d="M12 2C7.5 2 3.5 12 1 20c1.5 2 4.5 2 6-1 1.5-3 3-9 5-9s3.5 6 5 9c1.5 3 4.5 3 6 1-2.5-8-6.5-18-11-18z"/>
</svg>
`

// 5. 범용 기본 AI 스파크
const GENERIC_AI_SVG = `
<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
  <path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/>
</svg>
`

export interface AiBrandInfo {
  name: string
  svg: string
  imgSrc?: string
  brandColor: string
  bgMono: string
  colorMono: string
}

export function getAiBrand(provider: string, accountName: string = ''): AiBrandInfo {
  const normProvider = provider.toLowerCase()
  const normName = accountName.toLowerCase()

  // 1. Antigravity (사용자 제공 로고)
  if (
    normProvider === 'antigravity' ||
    normName.includes('antigravity') ||
    normName.includes('agy')
  ) {
    return {
      name: 'Antigravity',
      svg: ANTIGRAVITY_SVG,
      imgSrc: ICON_ANTIGRAVITY_B64,
      brandColor: '#2563EB', // 안티그래비티 블루 / 멀티컬러
      bgMono: '#374151',
      colorMono: '#D1D5DB'
    }
  }

  // 2. Claude (사용자 제공 테라코타 스파크)
  if (
    normProvider === 'claude' ||
    normName.includes('claude') ||
    normName.includes('anthropic')
  ) {
    return {
      name: 'Claude',
      svg: CLAUDE_SVG,
      imgSrc: ICON_CLAUDE_B64,
      brandColor: '#D97757', // 공식 클로드 테라코타
      bgMono: '#374151',
      colorMono: '#D1D5DB'
    }
  }

  // 3. Codex (사용자 제공 구름 터미널 로고)
  if (
    normProvider === 'codex' ||
    normProvider === 'openai' ||
    normName.includes('codex') ||
    normName.includes('gpt') ||
    normName.includes('openai')
  ) {
    return {
      name: 'Codex',
      svg: CODEX_SVG,
      imgSrc: ICON_CODEX_B64,
      brandColor: '#6366F1', // 코덱스 인디고 바이올렛
      bgMono: '#374151',
      colorMono: '#D1D5DB'
    }
  }

  // 4. Gemini
  if (
    normProvider === 'google' ||
    normName.includes('google') ||
    normName.includes('gemini')
  ) {
    return {
      name: 'Gemini',
      svg: GEMINI_SVG,
      brandColor: '#4E82EE', // 제미나이 블루
      bgMono: '#374151',
      colorMono: '#D1D5DB'
    }
  }

  return {
    name: 'AI',
    svg: GENERIC_AI_SVG,
    brandColor: '#8B5CF6',
    bgMono: '#374151',
    colorMono: '#D1D5DB'
  }
}

/**
 * AI 브랜드 아이콘 HTML 렌더링 (투명 배경 + 사용자 제공 고화질 64x64 로고)
 */
export function renderAiIcon(
  provider: string,
  accountName: string,
  iconStyle: IconStyle = 'color',
  size: number = 18
): string {
  const brand = getAiBrand(provider, accountName)
  const isMono = iconStyle === 'monochrome'

  const iconColor = isMono ? '#9CA3AF' : brand.brandColor
  const filterStyle = isMono ? 'filter: grayscale(100%) brightness(1.25) contrast(1.1); opacity: 0.88;' : ''

  let contentHtml = ''
  if (brand.imgSrc) {
    contentHtml = `<img src="${brand.imgSrc}" alt="${brand.name}" width="${size}" height="${size}" style="width: ${size}px; height: ${size}px; object-fit: contain; display: block;" />`
  } else {
    contentHtml = brand.svg.replace('width="16" height="16"', `width="${size}" height="${size}"`)
  }

  return `
    <div class="ai-brand-icon ${isMono ? 'is-mono' : 'is-color'}" style="
      width: ${size}px;
      height: ${size}px;
      min-width: ${size}px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: transparent;
      color: ${iconColor};
      ${filterStyle}
    " title="${brand.name}">
      <span style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
        ${contentHtml}
      </span>
    </div>
  `
}
