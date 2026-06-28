import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { serve, nodeFs } from '@artemjs/vfskit'

const DATA = fileURLToPath(new URL('./data/', import.meta.url))
const PUB = fileURLToPath(new URL('./public/', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

const http = createServer(async (req, res) => {
  const p = !req.url || req.url === '/' ? '/index.html' : req.url.split('?')[0]
  try {
    const body = await readFile(join(PUB, p))
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404).end('not found') }
})

const wss = new WebSocketServer({ server: http })
wss.on('connection', (ws, req) => {
  const user = new URL(req.url, 'http://x').searchParams.get('user') ?? 'guest'
  const sock = serve(nodeFs(join(DATA, user))).socket((bytes) => ws.send(bytes))
  ws.on('message', (data) => sock.message(new Uint8Array(data)))
  ws.on('close', () => sock.close())
})

http.listen(3000, () => console.log('cloud-ide on http://localhost:3000'))
