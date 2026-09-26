import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { LocalLspClient } from './local-lsp-client.js'
import { CodexAppServerClient } from './codex-app-server-client.js'
import { ClaudeDesktopClient } from './claude-desktop-client.js'

const execAsync = promisify(exec)

export interface DetectedApp {
  id: string
  name: string
  provider: 'antigravity' | 'claude' | 'codex' | 'google' | 'openai' | 'custom'
  installed: boolean
  running: boolean
  description: string
  iconLetter: string
  brandColor: string
}

export class LocalAppDetector {
  public static async detectAll(): Promise<DetectedApp[]> {
    const results: DetectedApp[] = []

    // 1. Antigravity IDE 감지
    const lspProc = await LocalLspClient.detectProcess()
    results.push({
      id: 'local-antigravity',
      name: 'Google Antigravity',
      provider: 'antigravity',
      installed: true,
      running: !!lspProc,
      description: lspProc ? '현재 실행 중 (무인증 실시간 연동)' : '설치됨 (실행 시 자동 연동)',
      iconLetter: 'A',
      brandColor: '#2563EB'
    })

    // 2. Claude Code CLI 감지
    const homeDir = os.homedir()
    const claudeCredsPath = path.join(homeDir, '.claude', '.credentials.json')
    let claudeInstalled = false
    let claudeLoggedIn = false

    try {
      const { stdout } = await execAsync('where.exe claude', { timeout: 2000, windowsHide: true })
      if (stdout.trim()) claudeInstalled = true
    } catch {}

    if (fs.existsSync(claudeCredsPath)) {
      claudeInstalled = true
      try {
        const raw = fs.readFileSync(claudeCredsPath, 'utf-8')
        const json = JSON.parse(raw)
        if (json.claudeAiOauth?.accessToken) {
          claudeLoggedIn = true
        }
      } catch {}
    }

    // CLI를 우선 사용하고 실패 시 데스크톱 앱 기록을 사용한다.
    const desktopHistoryPath = ClaudeDesktopClient.getUsageHistoryPath()
    const desktopDetected = !!desktopHistoryPath && fs.existsSync(desktopHistoryPath)
    let desktopRunning = false
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Claude.exe" /FO CSV /NH', { timeout: 2000, windowsHide: true })
      desktopRunning = /^"Claude\.exe"/im.test(stdout.trim())
    } catch {}
    const claudeAvailable = claudeInstalled || desktopDetected || fs.existsSync(path.join(process.env.APPDATA || '', 'Claude'))
    results.push({
      id: 'local-claude-code',
      name: 'Claude Code',
      provider: 'claude',
      installed: claudeAvailable,
      running: claudeLoggedIn || desktopRunning,
      description: claudeLoggedIn && desktopDetected
        ? 'CLI 로그인 · 앱 사용량 기록 감지됨'
        : claudeLoggedIn ? 'CLI 로그인 세션 감지됨'
          : desktopDetected ? '앱 사용량 기록 감지됨' : (claudeAvailable ? '설치됨 (연결 가능)' : '미설치'),
      iconLetter: 'C',
      brandColor: '#D97757'
    })

    // 3. Codex CLI / Desktop 감지
    let codexInstalled = !!CodexAppServerClient.findCodexExecutable()
    let codexLoggedIn = false
    if (!codexInstalled) {
      try {
        const { stdout } = await execAsync('where.exe codex', { timeout: 2000, windowsHide: true })
        if (stdout.trim()) codexInstalled = true
      } catch {}
    }

    const appData = process.env.APPDATA || ''
    const codexAuthPaths = [
      path.join(appData, 'orca', 'codex-runtime-home', 'home', 'auth.json'),
      path.join(homeDir, '.codex', 'auth.json')
    ]
    for (const p of codexAuthPaths) {
      if (fs.existsSync(p)) {
        codexInstalled = true
        codexLoggedIn = true
        break
      }
    }

    results.push({
      id: 'local-codex',
      name: 'Codex CLI',
      provider: 'codex',
      installed: codexInstalled,
      running: codexLoggedIn,
      description: codexLoggedIn ? '로컬 세션 감지됨 (연결 완료)' : (codexInstalled ? '설치됨 (연결 가능)' : '미설치 (기본 프리셋 제공)'),
      iconLetter: 'X',
      brandColor: '#6366F1'
    })

    return results
  }
}
