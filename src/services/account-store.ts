import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AccountConfig, WidgetConfig } from '../common/types.js'
import type { DetectedApp } from './local-app-detector.js'

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
  openAtLogin: true
}

export const DEFAULT_ACCOUNTS: AccountConfig[] = [
  {
    id: 'local-antigravity',
    name: 'Antigravity (Local IDE)',
    provider: 'antigravity',
    enabled: true,
    isLocalIde: true,
    customMock: {
      primaryPercent: 79,
      primaryReset: '4h 49m',
      weeklyPercent: 44,
      weeklyReset: '5d 8h',
      iconLetter: 'A',
      brandColor: '#2563EB'
    }
  },
  {
    id: 'local-claude-code',
    name: 'Claude Code',
    provider: 'claude',
    enabled: true,
    customMock: {
      primaryPercent: 43,
      primaryReset: '3h 12m',
      weeklyPercent: 39,
      weeklyReset: '5d 12h',
      iconLetter: 'C',
      brandColor: '#D97757'
    }
  },
  {
    id: 'local-codex',
    name: 'Codex CLI',
    provider: 'codex',
    enabled: true,
    customMock: {
      primaryPercent: 1,
      primaryReset: '1h 27m',
      weeklyPercent: 47,
      weeklyReset: '6d 4h',
      iconLetter: 'X',
      brandColor: '#6366F1'
    }
  },
  {
    id: 'google-gemini',
    name: 'Gemini Advanced',
    provider: 'google',
    enabled: true,
    customMock: {
      primaryPercent: 4,
      primaryReset: '4h 53m',
      weeklyPercent: 3,
      weeklyReset: '6d 18h',
      iconLetter: 'G',
      brandColor: '#4E82EE'
    }
  }
]

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
          return parsed
        }
      }
    } catch (err) {
      console.error('[AccountStore] Failed to load accounts, using defaults', err)
    }
    return [...DEFAULT_ACCOUNTS]
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
    this.accounts = [...accounts]
    this.atomicWriteFileSync(this.accountsPath, JSON.stringify(this.accounts, null, 2))
  }

  public getConfig(): WidgetConfig {
    return { ...this.config }
  }

  public getAccounts(): AccountConfig[] {
    return [...this.accounts]
  }

  public addAccount(account: AccountConfig): void {
    const existingIndex = this.accounts.findIndex(a => a.id === account.id || (account.tokens?.email && a.tokens?.email === account.tokens.email))
    if (existingIndex >= 0) {
      this.accounts[existingIndex] = { ...this.accounts[existingIndex], ...account, enabled: true }
    } else {
      this.accounts.push(account)
    }
    this.saveAccounts(this.accounts)
  }

  public restoreDetectedAccount(app: DetectedApp): void {
    let mockData = {
      primaryPercent: 45,
      primaryReset: '3h 15m',
      weeklyPercent: 25,
      weeklyReset: '4d 10h',
      iconLetter: app.iconLetter,
      brandColor: app.brandColor
    }

    if (app.id === 'local-antigravity') {
      mockData = {
        primaryPercent: 37,
        primaryReset: '3h 28m',
        weeklyPercent: 12,
        weeklyReset: '5d 14h',
        iconLetter: 'A',
        brandColor: '#2563EB'
      }
    } else if (app.id === 'local-claude-code') {
      mockData = {
        primaryPercent: 68,
        primaryReset: '2h 41m',
        weeklyPercent: 42,
        weeklyReset: '3d 9h',
        iconLetter: 'C',
        brandColor: '#D97757'
      }
    } else if (app.id === 'local-codex') {
      mockData = {
        primaryPercent: 54,
        primaryReset: '1h 50m',
        weeklyPercent: 38,
        weeklyReset: '4d 20h',
        iconLetter: 'X',
        brandColor: '#6366F1'
      }
    }

    const acc: AccountConfig = {
      id: app.id,
      name: app.name,
      provider: app.provider as any,
      enabled: true,
      isLocalIde: app.id === 'local-antigravity',
      customMock: mockData
    }

    this.addAccount(acc)
  }

  public resetToDefaultAccounts(): void {
    this.accounts = [...DEFAULT_ACCOUNTS]
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
