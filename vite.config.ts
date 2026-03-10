import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Dev-only: SSH deploy agent to remote server
function deployPlugin(): Plugin {
  return {
    name: 'deploy-agent',
    configureServer(server) {
      server.middlewares.use('/api/deploy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        // Parse JSON body
        const body = await new Promise<string>(resolve => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk })
          req.on('end', () => resolve(data))
        })

        let params: {
          host: string
          sshPort?: number
          sshUser?: string
          sshPassword?: string
          sshKeyPath?: string
          smToken: string
          smPort?: number
        }

        try {
          params = JSON.parse(body)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
          return
        }

        if (!params.host || !params.smToken) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'host and smToken are required' }))
          return
        }

        // SSE for streaming output
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })

        const send = (data: string) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        }
        const sendDone = (success: boolean, message: string, extra?: Record<string, unknown>) => {
          res.write(`event: done\ndata: ${JSON.stringify({ success, message, ...extra })}\n\n`)
          res.end()
        }

        try {
          const { Client } = await import('ssh2')

          // Find the agent binary — auto-detect arch later on remote
          const agentDir = resolve(__dirname, 'agent')
          const scriptPath = join(agentDir, 'scripts', 'install.sh')
          const distDir = join(agentDir, 'dist')

          if (!existsSync(scriptPath)) {
            sendDone(false, 'install.sh 不存在，请先确认 agent/scripts/install.sh 已创建')
            return
          }

          // Collect available binaries
          const binaries: { name: string; localPath: string }[] = []
          for (const arch of ['amd64', 'arm64']) {
            const p = join(distDir, `server-monitor-agent-linux-${arch}`)
            if (existsSync(p)) binaries.push({ name: `server-monitor-agent-linux-${arch}`, localPath: p })
          }

          if (binaries.length === 0) {
            sendDone(false, '未找到编译产物，请先执行 cd agent && make all')
            return
          }

          send('正在连接 SSH ...')

          const conn = new Client()

          const connectOpts: import('ssh2').ConnectConfig = {
            host: params.host,
            port: params.sshPort || 22,
            username: params.sshUser || 'root',
          }

          if (params.sshKeyPath) {
            const keyPath = params.sshKeyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '')
            if (!existsSync(keyPath)) {
              sendDone(false, `密钥文件不存在: ${params.sshKeyPath}`)
              return
            }
            connectOpts.privateKey = readFileSync(keyPath)
          } else {
            connectOpts.password = params.sshPassword
          }

          await new Promise<void>((resolveConn, rejectConn) => {
            conn.on('ready', () => resolveConn())
            conn.on('error', (err: Error) => rejectConn(err))
            conn.connect(connectOpts)
          })

          send('SSH 连接成功')

          // Detect remote arch
          send('检测远程架构 ...')
          const remoteArch = await new Promise<string>((resolveArch, rejectArch) => {
            conn.exec('uname -m', (err, stream) => {
              if (err) return rejectArch(err)
              let out = ''
              stream.on('data', (data: Buffer) => { out += data.toString() })
              stream.on('close', () => {
                const arch = out.trim()
                if (arch === 'x86_64' || arch === 'amd64') resolveArch('amd64')
                else if (arch === 'aarch64' || arch === 'arm64') resolveArch('arm64')
                else rejectArch(new Error(`不支持的架构: ${arch}`))
              })
            })
          })

          send(`远程架构: ${remoteArch}`)

          const target = binaries.find(b => b.name.includes(remoteArch))
          if (!target) {
            conn.end()
            sendDone(false, `未找到 ${remoteArch} 架构的编译产物，请执行 make linux-${remoteArch}`)
            return
          }

          // SFTP upload
          send('上传文件 ...')
          const sftp = await new Promise<import('ssh2').SFTPWrapper>((resolveSftp, rejectSftp) => {
            conn.sftp((err, sftp) => err ? rejectSftp(err) : resolveSftp(sftp))
          })

          const uploadFile = (localPath: string, remotePath: string) => {
            return new Promise<void>((resolveUp, rejectUp) => {
              const data = readFileSync(localPath)
              sftp.writeFile(remotePath, data, (err) => {
                if (err) rejectUp(err)
                else resolveUp()
              })
            })
          }

          await uploadFile(target.localPath, '/tmp/server-monitor-agent')
          send(`已上传 ${target.name}`)
          await uploadFile(scriptPath, '/tmp/sm-install.sh')
          send('已上传 install.sh')

          // Execute install script
          const smPort = params.smPort || 9090
          const cmd = `chmod +x /tmp/sm-install.sh && SM_TOKEN='${params.smToken.replace(/'/g, "'\\''")}' SM_PORT=${smPort} LOCAL_BINARY=/tmp/server-monitor-agent bash /tmp/sm-install.sh 2>&1; rm -f /tmp/server-monitor-agent /tmp/sm-install.sh`

          send('执行安装脚本 ...')

          // Track existing agent info (skip-install case)
          let existingToken = ''
          let existingPort = ''

          await new Promise<void>((resolveExec, rejectExec) => {
            conn.exec(cmd, (err, stream) => {
              if (err) return rejectExec(err)
              stream.on('data', (data: Buffer) => {
                data.toString().split('\n').filter(Boolean).forEach(line => {
                  if (line.startsWith('SM_EXISTING_TOKEN=')) {
                    existingToken = line.slice('SM_EXISTING_TOKEN='.length)
                  } else if (line.startsWith('SM_EXISTING_PORT=')) {
                    existingPort = line.slice('SM_EXISTING_PORT='.length)
                  } else {
                    send(line)
                  }
                })
              })
              stream.stderr.on('data', (data: Buffer) => {
                data.toString().split('\n').filter(Boolean).forEach(line => send(line))
              })
              stream.on('close', (code: number) => {
                if (code === 0) resolveExec()
                else rejectExec(new Error(`脚本退出码: ${code}`))
              })
            })
          })

          conn.end()

          if (existingToken) {
            sendDone(true, '已是最新版本，跳过安装', {
              existingToken,
              existingPort: Number(existingPort) || smPort,
            })
          } else {
            sendDone(true, '部署完成')
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Deploy error'
          send(`错误: ${message}`)
          sendDone(false, message)
        }
      })
    },
  }
}

// Dev proxy: forwards /api/agent/{serverId}/* to the configured agent
function agentProxyPlugin(): Plugin {
  return {
    name: 'agent-proxy',
    configureServer(server) {
      server.middlewares.use('/api/agent', async (req, res) => {
        const target = req.headers['x-agent-url'] as string
        const token = req.headers['x-agent-token'] as string

        if (!target) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing X-Agent-Url header' }))
          return
        }

        try {
          // Strip /api/agent prefix, forward the rest
          const forwardPath = (req.url || '/').replace(/^\/api\/agent/, '')
          const url = new URL(forwardPath, target)

          // Read request body for non-GET methods
          let reqBody: string | undefined
          if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
            reqBody = await new Promise<string>(resolve => {
              let data = ''
              req.on('data', (chunk: Buffer) => { data += chunk })
              req.on('end', () => resolve(data))
            })
          }

          const acceptHeader = req.headers['accept'] || 'application/json'
          const fetchHeaders: Record<string, string> = {
            'Authorization': token ? `Bearer ${token}` : '',
            'Accept': acceptHeader,
          }
          if (reqBody) {
            fetchHeaders['Content-Type'] = req.headers['content-type'] || 'application/json'
          }

          const response = await fetch(url.toString(), {
            method: req.method || 'GET',
            headers: fetchHeaders,
            body: reqBody || undefined,
            // @ts-expect-error Node fetch option to bypass self-signed certs
            dispatcher: new (await import('undici')).Agent({
              connect: { rejectUnauthorized: false },
            }),
          })

          const contentType = response.headers.get('content-type') || 'application/json'

          // SSE streaming: pipe the response body directly
          if (contentType.includes('text/event-stream')) {
            res.writeHead(response.status, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
              'X-Accel-Buffering': 'no',
            })
            const reader = (response.body as ReadableStream<Uint8Array>)?.getReader()
            if (reader) {
              const pump = async () => {
                try {
                  while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    res.write(Buffer.from(value))
                  }
                } catch {
                  // client disconnected
                }
                res.end()
              }
              req.on('close', () => reader.cancel())
              pump()
              return
            }
          }

          const body = await response.text()
          res.writeHead(response.status, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
          })
          res.end(body)
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Proxy error'
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    deployPlugin(),
    agentProxyPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ServerMonitor',
        short_name: 'ServerMonitor',
        description: '服务器运维监控工具',
        theme_color: '#0c0f14',
        background_color: '#0c0f14',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\.(?:woff2?|ttf|otf|eot)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5174,
  },
})
