import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AccountConfig, WidgetConfig } from '../common/types.js'
import type { DetectedApp } from './local-app-detector.js'
import { mergeClaudeAccounts } from './claude-account-migration.js'
import { DEFAULT_API_ENDPOINT } from './usage-push.js'

const DEFAULT_CONFIG: WidgetConfig = {
  theme: '1a',
  iconStyle: 'color',
  alignment: 'right',
  offsetPx: 20,
  verticalOffsetPx: 0,
  refreshIntervalSec: 60,
  alphaPercent: 85,
  showWeeklyLimit: true,
  colorByUsage: true,
  showCardBackground: true,
  showUsedPercent: false,
  placementMode: 'docked',
  alwaysOnTop: true,
  openAtLogin: true,
  doubleClickToOpenPopup: false,
  apiPushEnabled: false,
  apiEndpoint: DEFAULT_API_ENDPOINT,
  apiScreen: 1
}

// 쿼터 수치는 전부 실시간 조회로 채운다. 프리셋 숫자를 넣어두면 조회 실패 시 그게 정상값처럼 표시된다.
// (실시간 조회 클라이언트가 없는 provider 는 기본 계정에 두지 않는다 — loadAccounts 도 'google' 계정을 정리한다)
export const DEFAULT_ACCOUNTS: AccountConfig[] = [
  {
    id: 'local-antigravity',
    name: 'Antigravity (Local IDE)',
    provider: 'antigravity',
    enabled: true,
    isLocalIde: true
  },
  {
    id: 'local-claude-code',
    name: 'Claude Code',
    provider: 'claude',
    enabled: true
  },
  {
    id: 'local-codex',
    name: 'Codex CLI',
    provider: 'codex',
    enabled: true
  }
]

/** DEFAULT_ACCOUNTS 는 상수다. toggleAccount 등이 원본을 바꾸지 않도록 항상 깊은 복사본을 준다 */
function createDefaultAccounts(): AccountConfig[] {
  return structuredClone(DEFAULT_ACCOUNTS)
}

export class AccountStore {
  private configPath: string
  private accountsPath: string
  private config: WidgetConfig
  private accounts: AccountConfig[]

  constructor() {
    let baseDir: string
    try {
      baseDir = app ? app.getPath('userData') : path.join(process.cwd(), '.data')
    } catch {
      baseDir = path.join(process.cwd(), '.data')
    }

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true })
    }

    this.configPath = path.join(baseDir, 'config.json')
    this.accountsPath = path.join(baseDir, 'accounts.json')
    fs.rmSync(path.join(baseDir, 'oauth-client.json'), { force: true }) // 제거된 키 가져오기 기능의 잔여 파일

    this.config = this.loadConfig()
    this.accounts = this.loadAccounts()
  }

  private loadConfig(): WidgetConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8')
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
      }
    } catch (err) {
      console.error('[AccountStore] Failed to load config, using default', err)
    }
    return { ...DEFAULT_CONFIG }
  }

  private loadAccounts(): AccountConfig[] {
    try {
      if (fs.existsSync(this.accountsPath)) {
        const raw = fs.readFileSync(this.accountsPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 제거된 Google 로그인 기능이 남긴 계정(리프레시 토큰 포함)을 디스크에서 삭제
          const kept = parsed.filter((a: { provider?: string; tokens?: unknown }) => a.provider !== 'google' && !a.tokens)
          const merged = mergeClaudeAccounts(kept)
          if (kept.length !== parsed.length || merged !== kept) {
            this.atomicWriteFileSync(this.accountsPath, JSON.stringify(merged, null, 2))
          }
          return merged.length > 0 ? merged : createDefaultAccounts()
        }
      }
    } catch (err) {
      console.error('[AccountStore] Failed to load accounts, using defaults', err)
    }
    return createDefaultAccounts()
  }

  private atomicWriteFileSync(filePath: string, content: string): void {
    const tmpPath = `${filePath}.${Date.now()}.tmp`
    try {
      fs.writeFileSync(tmpPath, content, 'utf-8')
      fs.renameSync(tmpPath, filePath)
    } catch (err) {
      try {
        fs.writeFileSync(filePath, content, 'utf-8')
      } catch (fallbackErr) {
        console.error(`[AccountStore] Failed to write file ${filePath}:`, fallbackErr)
      }
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {}
    }
  }

  public saveConfig(config: WidgetConfig): void {
    this.config = { ...config }
    this.atomicWriteFileSync(this.configPath, JSON.stringify(this.config, null, 2))
  }

  public saveAccounts(accounts: AccountConfig[]): void {
    this.accounts = mergeClaudeAccounts([...accounts])
    this.atomicWriteFileSync(this.accountsPath, JSON.stringify(this.accounts, null, 2))
  }

  public getConfig(): WidgetConfig {
    return { ...this.config }
  }

  public getAccounts(): AccountConfig[] {
    return [...this.accounts]
  }

  public addAccount(account: AccountConfig): void {
    if (account.id === 'local-claude-desktop' && account.provider === 'claude') {
      account = { ...account, id: 'local-claude-code', name: 'Claude Code' }
    }
    const existingIndex = this.accounts.findIndex(a => a.id === account.id)
    if (existingIndex >= 0) {
      this.accounts[existingIndex] = { ...this.accounts[existingIndex], ...account, enabled: true }
    } else {
      this.accounts.push(account)
    }
    this.saveAccounts(this.accounts)
  }

  /** 감지된 로컬 앱을 계정으로 등록. 쿼터는 실시간 조회로만 채운다 (프리셋 숫자를 넣지 않는다) */
  public restoreDetectedAccount(app: DetectedApp): void {
    const acc: AccountConfig = {
      id: app.id,
      name: app.name,
      provider: app.provider as any,
      enabled: true,
      isLocalIde: app.id === 'local-antigravity'
    }

    this.addAccount(acc)
  }

  public resetToDefaultAccounts(): void {
    this.accounts = createDefaultAccounts()
    this.saveAccounts(this.accounts)
  }

  public removeAccount(id: string): void {
    this.accounts = this.accounts.filter(a => a.id !== id)
    this.saveAccounts(this.accounts)
  }

  public toggleAccount(id: string, enabled: boolean): void {
    const target = this.accounts.find(a => a.id === id)
    if (target) {
      target.enabled = enabled
      this.saveAccounts(this.accounts)
    }
  }

  public reorderAccount(id: string, direction: 'up' | 'down'): void {
    const idx = this.accounts.findIndex(a => a.id === id)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= this.accounts.length) return

    const temp = this.accounts[idx]
    this.accounts[idx] = this.accounts[targetIdx]
    this.accounts[targetIdx] = temp
    this.saveAccounts(this.accounts)
  }
}
