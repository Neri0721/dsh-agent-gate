/**
 * dsh-agent-gate — 宿主半边（Host half）
 *
 * 只做一件事：把「访问码」的校验与持久化暴露成几条本地 HTTP 路由，供客户端闸门调用。
 *
 *   GET  /dsh-agent-gate/status                 → { ok, enabled, configured, length, lockedFor }
 *   POST /dsh-agent-gate/verify   { pin }       → { ok, remaining } | { ok:false, lockedFor }
 *   POST /dsh-agent-gate/set      { pin, current }
 *   POST /dsh-agent-gate/clear    { current }
 *   POST /dsh-agent-gate/toggle   { enabled }
 *
 * 访问码只以 PBKDF2-SHA256 派生值落盘（~/.dsh/agent-gate.json），不保存明文。
 * 忘记访问码时的后门：退出 DSH，删除 %USERPROFILE%\.dsh\agent-gate.json，重新打开即可重设。
 *
 * 设计取舍：闸门是「体验层」的锁，不是安全边界。真正的权限仍由 DSH 的沙箱与审批策略负责。
 */

import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export const name = 'dsh-agent-gate'
export const inject = ['webServer']

const STORE = join(homedir(), '.dsh', 'agent-gate.json')
const ITERATIONS = 120000
const MAX_BODY = 4096
const MIN_LEN = 4
const MAX_LEN = 8
const MAX_FAILS = 5

const DEFAULTS = {
  v: 1,
  enabled: true,
  configured: false,
  salt: '',
  hash: '',
  length: 6,
  iterations: ITERATIONS,
  fails: 0,
  lockedUntil: 0,
  lastUnlock: 0,
}

function readStore() {
  try {
    if (!existsSync(STORE)) return { ...DEFAULTS }
    const raw = JSON.parse(readFileSync(STORE, 'utf8'))
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
    return { ...DEFAULTS, ...raw, configured: Boolean(raw.hash) }
  } catch {
    return { ...DEFAULTS }
  }
}

function writeStore(next) {
  const dir = dirname(STORE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = STORE + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(tmp, STORE)
  return next
}

function derive(pin, salt, iterations) {
  return pbkdf2Sync(String(pin), Buffer.from(salt, 'hex'), iterations | 0, 32, 'sha256')
}

function matches(pin, store) {
  try {
    const expected = Buffer.from(store.hash, 'hex')
    if (expected.length !== 32) return false
    const got = derive(pin, store.salt, store.iterations || ITERATIONS)
    return timingSafeEqual(expected, got)
  } catch {
    return false
  }
}

function validPin(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin)
}

function lockedFor(store) {
  const left = Math.ceil(((store.lockedUntil || 0) - Date.now()) / 1000)
  return left > 0 ? left : 0
}

function readJson(req) {
  return new Promise((resolvePromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        req.destroy()
        resolvePromise(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolvePromise({})
        return
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolvePromise(value && typeof value === 'object' ? value : {})
      } catch {
        resolvePromise(null)
      }
    })
    req.on('error', () => resolvePromise(null))
  })
}

function send(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

export function apply(ctx) {
  const webServer = ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    console.error('[dsh-agent-gate] 拿不到 webServer 服务，插件未生效')
    return
  }

  const route = (path, handler) =>
    ctx.effect(
      () => webServer.register({ path, handler }),
      'dsh-agent-gate: ' + path,
    )

  route('/dsh-agent-gate/status', (req, res) => {
    const store = readStore()
    send(res, 200, {
      ok: true,
      enabled: store.enabled !== false,
      configured: store.configured === true,
      length: store.length || 6,
      lockedFor: lockedFor(store),
      lastUnlock: store.lastUnlock || 0,
      storePath: STORE,
    })
  })

  route('/dsh-agent-gate/verify', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' })
    const body = await readJson(req)
    if (!body) return send(res, 400, { ok: false, error: 'bad-body' })

    const store = readStore()
    if (!store.configured) return send(res, 200, { ok: false, error: 'not-configured' })

    const wait = lockedFor(store)
    if (wait > 0) return send(res, 200, { ok: false, lockedFor: wait })

    if (!validPin(body.pin) || !matches(body.pin, store)) {
      const fails = (store.fails || 0) + 1
      let locked = 0
      if (fails >= MAX_FAILS) {
        const round = Math.floor(fails / MAX_FAILS)
        locked = Math.min(15 * 2 ** (round - 1), 300)
        store.lockedUntil = Date.now() + locked * 1000
        store.fails = 0
      } else {
        store.fails = fails
      }
      writeStore(store)
      return send(res, 200, {
        ok: false,
        remaining: MAX_FAILS - (store.fails || 0),
        lockedFor: locked,
      })
    }

    store.fails = 0
    store.lockedUntil = 0
    store.lastUnlock = Date.now()
    writeStore(store)
    return send(res, 200, { ok: true })
  })

  route('/dsh-agent-gate/set', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' })
    const body = await readJson(req)
    if (!body) return send(res, 400, { ok: false, error: 'bad-body' })
    if (!validPin(body.pin)) return send(res, 200, { ok: false, error: 'length' })

    const store = readStore()
    if (store.configured) {
      const wait = lockedFor(store)
      if (wait > 0) return send(res, 200, { ok: false, lockedFor: wait })
      if (!validPin(body.current) || !matches(body.current, store)) {
        const fails = (store.fails || 0) + 1
        store.fails = fails
        if (fails >= MAX_FAILS) {
          store.lockedUntil = Date.now() + 30000
          store.fails = 0
        }
        writeStore(store)
        return send(res, 200, { ok: false, error: 'wrong-current', remaining: Math.max(0, MAX_FAILS - fails) })
      }
    }

    const salt = randomBytes(16).toString('hex')
    const iterations = ITERATIONS
    writeStore({
      ...store,
      configured: true,
      salt,
      hash: derive(body.pin, salt, iterations).toString('hex'),
      iterations,
      length: String(body.pin).length,
      fails: 0,
      lockedUntil: 0,
    })
    return send(res, 200, { ok: true })
  })

  route('/dsh-agent-gate/clear', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' })
    const body = await readJson(req)
    if (!body) return send(res, 400, { ok: false, error: 'bad-body' })

    const store = readStore()
    if (store.configured && (!validPin(body.current) || !matches(body.current, store))) {
      return send(res, 200, { ok: false, error: 'wrong-current' })
    }
    writeStore({
      ...DEFAULTS,
      enabled: store.enabled !== false,
      lastUnlock: store.lastUnlock || 0,
    })
    return send(res, 200, { ok: true })
  })

  route('/dsh-agent-gate/toggle', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' })
    const body = await readJson(req)
    if (!body) return send(res, 400, { ok: false, error: 'bad-body' })
    const store = readStore()
    const enabled = Boolean(body.enabled)
    if (!enabled && store.configured) {
      const wait = lockedFor(store)
      if (wait > 0) return send(res, 200, { ok: false, lockedFor: wait })
      if (!validPin(body.current) || !matches(body.current, store)) {
        return send(res, 200, { ok: false, error: 'wrong-current' })
      }
    }
    writeStore({ ...store, enabled })
    return send(res, 200, { ok: true, enabled })
  })

  console.log('[dsh-agent-gate] 已注册闸门路由：' + STORE)
}
