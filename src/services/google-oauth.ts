import http from 'node:http'
import { URL, URLSearchParams } from 'node:url'
import open from 'open'

const OAUTH_CONFIG = {
  clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || '',
  clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || '',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email'
  ]
}

export interface OAuthResult {
  success: boolean
  email?: string
  projectId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  error?: string
}

export class GoogleOAuthService {
  /**
   * 사용 가능한 로컬 포트 탐색
   */
  private static async getAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer()
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          const port = address.port
          server.close(() => resolve(port))
        } else {
          reject(new Error('Failed to obtain local port'))
        }
      })
      server.on('error', reject)
    })
  }

  /**
   * 인가 코드를 액세스 토큰으로 교환
   */
  public static async exchangeCodeForTokens(code: string, redirectUri: string) {
    const params = new URLSearchParams({
      code,
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })

    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Token exchange failed: ${response.status} ${err}`)
    }

    return (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      token_type: string
    }
  }

  /**
   * 리프레시 토큰으로 액세스 토큰 갱신
   */
  public static async refreshAccessToken(refreshToken: string) {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
      grant_type: 'refresh_token'
    })

    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`)
    }

    return (await response.json()) as {
      access_token: string
      expires_in: number
      token_type: string
    }
  }

  /**
   * 사용자 이메일 조회
   */
  public static async getUserEmail(accessToken: string): Promise<string | undefined> {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (res.ok) {
        const data = (await res.json()) as { email?: string }
        return data.email
      }
    } catch (e) {
      console.warn('[OAuth] getUserEmail error:', e)
    }
    return undefined
  }

  /**
   * Google Cloud Code API에서 프로젝트 ID 추출/온보딩
   */
  public static async resolveProjectId(accessToken: string): Promise<string | undefined> {
    try {
      const res = await fetch('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity'
        },
        body: JSON.stringify({
          metadata: {
            ideType: 'ANTIGRAVITY',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI'
          }
        })
      })

      if (res.ok) {
        const data = (await res.json()) as {
          cloudaicompanionProject?: string | { id?: string }
        }
        if (typeof data.cloudaicompanionProject === 'string') {
          return data.cloudaicompanionProject
        }
        if (data.cloudaicompanionProject?.id) {
          return data.cloudaicompanionProject.id
        }
      }
    } catch (e) {
      console.warn('[OAuth] resolveProjectId error:', e)
    }
    return undefined
  }

  /**
   * 브라우저 기반 Google OAuth 2.0 로그인 프로세스 시작
   */
  public static async startLogin(): Promise<OAuthResult> {
    if (!OAUTH_CONFIG.clientId || !OAUTH_CONFIG.clientSecret) {
      return {
        success: false,
        error: 'Google OAuth 키가 설정되지 않았습니다. ANTIGRAVITY_OAUTH_CLIENT_ID 및 ANTIGRAVITY_OAUTH_CLIENT_SECRET 환경변수를 설정해주세요.'
      }
    }

    const port = await this.getAvailablePort()
    const redirectUri = `http://127.0.0.1:${port}/callback`
    const state = Math.random().toString(36).substring(2)

    const params = new URLSearchParams({
      client_id: OAUTH_CONFIG.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_CONFIG.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state
    })

    const authUrl = `${OAUTH_CONFIG.authUrl}?${params.toString()}`

    return new Promise((resolve) => {
      let resolved = false

      const server = http.createServer(async (req, res) => {
        if (resolved) return

        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code')
          const returnedState = url.searchParams.get('state')

          if (!code || returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h3>인증 실패: 잘못된 요청입니다. 창을 닫아주세요.</h3>')
            resolved = true
            server.close()
            resolve({ success: false, error: 'State mismatch or missing code' })
            return
          }

          try {
            const tokenData = await GoogleOAuthService.exchangeCodeForTokens(code, redirectUri)
            const email = await GoogleOAuthService.getUserEmail(tokenData.access_token)
            const projectId = await GoogleOAuthService.resolveProjectId(tokenData.access_token)

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <div style="font-family: system-ui, sans-serif; text-align: center; padding: 40px;">
                <h2>로그인 완료!</h2>
                <p><strong>${email || 'Google 계정'}</strong> 연동이 성공했습니다.</p>
                <p>이 브라우저 탭을 닫고 위젯으로 돌아가세요.</p>
              </div>
            `)

            resolved = true
            server.close()
            resolve({
              success: true,
              email,
              projectId,
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt: Date.now() + tokenData.expires_in * 1000
            })
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<h3>토큰 교환 실패: ${err instanceof Error ? err.message : String(err)}</h3>`)
            resolved = true
            server.close()
            resolve({ success: false, error: String(err) })
          }
        }
      })

      server.listen(port, '127.0.0.1', async () => {
        try {
          await open(authUrl)
        } catch (e) {
          console.error('[OAuth] Failed to auto-open browser', e)
        }
      })

      // 3분 타임아웃
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          server.close()
          resolve({ success: false, error: 'Login timed out' })
        }
      }, 180000)
    })
  }
}
