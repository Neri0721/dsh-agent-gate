/**
 * dsh-agent-gate — 客户端半边（Client half）
 *
 * 两处 UI：
 *   1) shell.overlay        → 启动时的「特工身份验证」闸门，覆盖整个界面，输对访问码才放行
 *   2) settings.section     → 「启动密码」设置页：设置 / 修改 / 关闭 / 立即上锁
 *
 * 访问码只交给宿主半边校验（POST /dsh-agent-gate/verify），浏览器里不留任何明文或哈希。
 * 解锁状态存在 sessionStorage：刷新页面仍保持解锁，彻底退出 DSH 后重新打开需要再验一次。
 * 快捷键 Alt+L 可以随时重新上锁。
 */

window.__ModuleLoader__.load({
  id: 'dsh-agent-gate',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/dsh-agent-gate'
    const SESSION_KEY = 'dsh-agent-gate:unlocked'
    const relockSubs = new Set()

    function isUnlocked() {
      try {
        return window.sessionStorage.getItem(SESSION_KEY) === '1'
      } catch {
        return false
      }
    }

    function markUnlocked() {
      try {
        window.sessionStorage.setItem(SESSION_KEY, '1')
      } catch {
        /* 隐私模式下忽略 */
      }
    }

    function relock() {
      try {
        window.sessionStorage.removeItem(SESSION_KEY)
      } catch {
        /* 忽略 */
      }
      relockSubs.forEach((fn) => {
        try {
          fn()
        } catch {
          /* 忽略 */
        }
      })
    }

    async function call(path, body) {
      const init =
        body === undefined
          ? { cache: 'no-store' }
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
              cache: 'no-store',
            }
      const res = await fetch(API + path, init)
      const text = await res.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }
      if (!res.ok) throw new Error('HTTP ' + res.status + (data && data.error ? ' ' + data.error : ''))
      return data || {}
    }

    const pad2 = (n) => String(n).padStart(2, '0')

    /* ------------------------------------------------------------------ 样式 */

    const GATE_CSS = `
.dag-stage{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;
  background:radial-gradient(1200px 720px at 50% 18%,#0c161a 0%,#060a0c 52%,#020304 100%);
  color:#d8f7ea;overflow:hidden;isolation:isolate;
  font-family:ui-monospace,SFMono-Regular,"Cascadia Mono",Consolas,"Liberation Mono",monospace;
  animation:dag-fade .28s ease-out both}
@keyframes dag-fade{from{opacity:0}to{opacity:1}}
.dag-grid{position:absolute;inset:-15%;opacity:.55;
  background-image:linear-gradient(rgba(34,255,166,.055) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(34,255,166,.055) 1px,transparent 1px);
  background-size:46px 46px;
  -webkit-mask-image:radial-gradient(closest-side at 50% 42%,#000 35%,transparent 76%);
  mask-image:radial-gradient(closest-side at 50% 42%,#000 35%,transparent 76%)}
.dag-scan{position:absolute;left:0;right:0;height:140px;pointer-events:none;
  background:linear-gradient(180deg,transparent,rgba(34,255,166,.10),transparent);
  animation:dag-scan 5.6s linear infinite}
@keyframes dag-scan{0%{top:-18%}100%{top:112%}}
.dag-vignette{position:absolute;inset:0;pointer-events:none;
  box-shadow:inset 0 0 220px rgba(0,0,0,.95),inset 0 0 60px rgba(0,0,0,.6)}
.dag-panel{position:relative;width:min(92vw,624px);padding:32px 34px 22px;
  background:linear-gradient(160deg,rgba(8,17,19,.97),rgba(4,8,10,.99));
  border:1px solid rgba(34,255,166,.22);
  box-shadow:0 0 0 1px rgba(0,0,0,.85),0 34px 90px rgba(0,0,0,.8),inset 0 0 70px rgba(34,255,166,.045)}
.dag-panel::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px)}
.dag-panel-wrap{position:relative}
.dag-panel-wrap.shake{animation:dag-shake .42s cubic-bezier(.36,.07,.19,.97) both}
@keyframes dag-shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}
  30%,50%,70%{transform:translateX(-7px)}40%,60%{transform:translateX(7px)}}
.dag-corner{position:absolute;width:16px;height:16px;border:2px solid #22ffa6;opacity:.75}
.dag-corner.tl{top:-1px;left:-1px;border-right:0;border-bottom:0}
.dag-corner.tr{top:-1px;right:-1px;border-left:0;border-bottom:0}
.dag-corner.bl{bottom:-1px;left:-1px;border-right:0;border-top:0}
.dag-corner.br{bottom:-1px;right:-1px;border-left:0;border-top:0}
.dag-eyebrow{font-size:10.5px;letter-spacing:.34em;color:rgba(34,255,166,.72);text-transform:uppercase}
.dag-title{margin:10px 0 6px;font-size:21px;font-weight:600;letter-spacing:.15em;color:#eafff7}
.dag-sub{margin:0 0 20px;font-size:12px;line-height:1.7;color:rgba(200,240,225,.5)}
.dag-boot{margin:0 0 18px;font-size:11.5px;line-height:1.95;color:rgba(120,230,180,.72)}
.dag-boot b{color:#22ffa6;font-weight:600}
.dag-boot-line{opacity:0;animation:dag-in .22s ease-out forwards}
@keyframes dag-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.dag-caret{display:inline-block;width:7px;height:12px;margin-left:5px;vertical-align:-1px;
  background:#22ffa6;animation:dag-blink 1.05s steps(1) infinite}
@keyframes dag-blink{50%{opacity:0}}
.dag-dots{display:flex;gap:13px;align-items:center;margin:4px 0 22px}
.dag-dot{width:15px;height:15px;border:1px solid rgba(34,255,166,.32);background:rgba(34,255,166,.03);
  transition:background .12s,border-color .12s,box-shadow .18s,transform .12s}
.dag-dot.on{background:#22ffa6;border-color:#22ffa6;transform:scale(1.06);
  box-shadow:0 0 12px rgba(34,255,166,.85),0 0 26px rgba(34,255,166,.32)}
.dag-dot.tick{animation:dag-dot .2s ease-out}
@keyframes dag-dot{0%{transform:scale(.78)}100%{transform:scale(1.06)}}
.dag-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.dag-key{height:54px;font-family:inherit;font-size:17px;letter-spacing:.08em;color:#c9f7e6;
  background:rgba(34,255,166,.035);border:1px solid rgba(34,255,166,.16);cursor:pointer;
  transition:background .12s,border-color .12s,box-shadow .16s,transform .08s}
.dag-key:hover{background:rgba(34,255,166,.10);border-color:rgba(34,255,166,.5);
  box-shadow:0 0 18px rgba(34,255,166,.18)}
.dag-key:active{transform:translateY(1px) scale(.985)}
.dag-key.fn{font-size:12px;letter-spacing:.2em;color:rgba(200,240,225,.62)}
.dag-key:disabled{opacity:.35;cursor:not-allowed;box-shadow:none;transform:none}
.dag-alert{margin:16px 0 0;padding:9px 12px;font-size:11.5px;letter-spacing:.05em;
  border:1px solid rgba(255,84,84,.42);background:rgba(255,84,84,.07);color:#ffb4b4}
.dag-alert.ok{border-color:rgba(34,255,166,.42);background:rgba(34,255,166,.07);color:#9dffd6}
.dag-foot{display:flex;justify-content:space-between;gap:14px;margin-top:20px;padding-top:14px;
  border-top:1px solid rgba(34,255,166,.12);font-size:10.5px;line-height:1.85;color:rgba(180,225,210,.36)}
.dag-foot b{color:rgba(120,230,180,.6);font-weight:600}
.dag-granted{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;
  background:radial-gradient(circle at 50% 50%,rgba(34,255,166,.20),transparent 62%);
  animation:dag-flash .8s ease-out both}
@keyframes dag-flash{0%{opacity:0}18%{opacity:1}100%{opacity:0}}
.dag-granted-text{font-size:22px;letter-spacing:.5em;color:#a8ffd9;text-shadow:0 0 22px rgba(34,255,166,.75)}
.dag-form{display:flex;flex-direction:column;gap:10px;margin:2px 0 6px}
.dag-label{font-size:10.5px;letter-spacing:.28em;color:rgba(34,255,166,.6);text-transform:uppercase}
.dag-input{width:100%;max-width:240px;padding:11px 13px;font-family:inherit;font-size:16px;
  letter-spacing:.42em;color:#eafff7;background:rgba(34,255,166,.04);
  border:1px solid rgba(34,255,166,.24);outline:none;transition:border-color .15s,box-shadow .15s}
.dag-input:focus{border-color:rgba(34,255,166,.72);box-shadow:0 0 0 3px rgba(34,255,166,.10)}
.dag-primary{margin-top:8px;padding:11px 20px;font-family:inherit;font-size:12px;letter-spacing:.26em;
  color:#04120c;background:#22ffa6;border:0;cursor:pointer;transition:filter .15s,transform .08s}
.dag-primary:hover{filter:brightness(1.08)}
.dag-primary:active{transform:translateY(1px)}
.dag-primary:disabled{opacity:.5;cursor:not-allowed}
.dag-ghost{background:none;border:1px solid rgba(34,255,166,.28);color:rgba(200,240,225,.8)}
`

    const SETTINGS_CSS = `
.dag-set{display:flex;flex-direction:column;gap:16px;max-width:620px;padding:4px 2px 8px;
  font-size:13px;line-height:1.65;color:var(--dsw-alias-fg-default,inherit)}
.dag-set-card{border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.28));
  border-radius:10px;padding:14px 16px;background:var(--dsw-alias-bg-raised,rgba(127,127,127,.05))}
.dag-set-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
.dag-set-title{font-size:13px;font-weight:600;letter-spacing:.02em}
.dag-badge{font-size:11px;padding:2px 8px;border-radius:999px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.3))}
.dag-badge.on{color:#0a7c52;background:rgba(34,200,140,.14);border-color:rgba(34,200,140,.38)}
.dag-badge.off{color:#a4482b;background:rgba(220,110,60,.12);border-color:rgba(220,110,60,.32)}
.dag-hint{font-size:12px;opacity:.62;margin:6px 0 0}
.dag-set-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
.dag-set input[type="password"],.dag-set input[type="text"]{
  width:150px;padding:8px 10px;font-family:inherit;font-size:13px;letter-spacing:.34em;
  color:var(--dsw-alias-fg-default,inherit);
  background:var(--dsw-alias-bg-base,rgba(127,127,127,.06));
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.34));border-radius:8px;outline:none}
.dag-set input:focus{border-color:var(--dsw-alias-border-strong,rgba(127,127,127,.6))}
.dag-set button{font-family:inherit;font-size:12.5px;padding:7px 14px;border-radius:8px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.34));
  background:var(--dsw-alias-bg-raised,rgba(127,127,127,.08));
  color:var(--dsw-alias-fg-default,inherit);transition:opacity .15s,transform .08s}
.dag-set button:hover{opacity:.85}
.dag-set button:active{transform:translateY(1px)}
.dag-set button.primary{background:#1f8f66;border-color:#1f8f66;color:#fff}
.dag-set button.danger{color:#b4402a}
.dag-set button:disabled{opacity:.5;cursor:not-allowed}
.dag-set-msg{font-size:12px;margin-top:8px}
.dag-set-msg.ok{color:#12855c}
.dag-set-msg.err{color:#b4402a}
.dag-set-foot{font-size:11.5px;opacity:.55;line-height:1.8}
.dag-set code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;
  padding:1px 5px;border-radius:4px;background:rgba(127,127,127,.16)}
`

    /* ------------------------------------------------------------------ 闸门 */

    const BOOT_LINES = [
      ['建立加密信道', 'TLS-1.3 / ECDHE'],
      ['校验终端指纹', 'DEVICE BOUND'],
      ['加载身份档案', 'AGENT FILE FOUND'],
    ]

    function Gate() {
      const [status, setStatus] = useState(null)
      const [unlocked, setUnlocked] = useState(isUnlocked)
      const [buffer, setBuffer] = useState('')
      const [phase, setPhase] = useState('boot') // boot | ready | checking | denied | granted | setup
      const [bootStep, setBootStep] = useState(0)
      const [message, setMessage] = useState('')
      const [remaining, setRemaining] = useState(null)
      const [lockLeft, setLockLeft] = useState(0)
      const [shakeKey, setShakeKey] = useState(0)
      const [digits, setDigits] = useState('')
      const [confirm, setConfirm] = useState('')
      const [setupMsg, setSetupMsg] = useState('')
      const busy = useRef(false)
      const bufferRef = useRef('')

      /* 状态拉取 */
      useEffect(() => {
        let alive = true
        call('/status')
          .then((s) => {
            if (!alive) return
            setStatus(s)
            setLockLeft(s.lockedFor || 0)
          })
          .catch((error) => {
            if (alive) setStatus({ error: String((error && error.message) || error) })
          })
        return () => {
          alive = false
        }
      }, [])

      /* 重新上锁订阅 */
      useEffect(() => {
        const fn = () => {
          setUnlocked(false)
          setBuffer('')
          bufferRef.current = ''
          setPhase('ready')
          setMessage('')
          setRemaining(null)
        }
        relockSubs.add(fn)
        return () => relockSubs.delete(fn)
      }, [])

      /* 启动动画 */
      useEffect(() => {
        if (!status || status.error || unlocked) return
        const timers = []
        BOOT_LINES.forEach((_, i) => timers.push(setTimeout(() => setBootStep(i + 1), 160 + i * 190)))
        timers.push(setTimeout(() => setPhase((p) => (p === 'boot' ? (status.configured ? 'ready' : 'setup') : p)), 900))
        return () => timers.forEach(clearTimeout)
      }, [status, unlocked])

      /* 锁定倒计时 */
      useEffect(() => {
        if (lockLeft <= 0) return
        const t = setTimeout(() => setLockLeft((n) => (n <= 1 ? 0 : n - 1)), 1000)
        return () => clearTimeout(t)
      }, [lockLeft])

      const pinLength = (status && status.length) || 6

      const submit = useCallback(
        async (pin) => {
          if (busy.current) return
          busy.current = true
          setPhase('checking')
          setMessage('')
          try {
            const result = await call('/verify', { pin })
            if (result.ok) {
              setPhase('granted')
              markUnlocked()
              setTimeout(() => setUnlocked(true), 760)
            } else if (result.lockedFor) {
              setLockLeft(result.lockedFor)
              setBuffer('')
              bufferRef.current = ''
              setPhase('denied')
              setMessage('安全冷却中，' + result.lockedFor + ' 秒后可重试')
              setShakeKey((k) => k + 1)
              setRemaining(null)
            } else {
              setBuffer('')
              bufferRef.current = ''
              setPhase('denied')
              setShakeKey((k) => k + 1)
              setRemaining(typeof result.remaining === 'number' ? result.remaining : null)
              setMessage(
                typeof result.remaining === 'number'
                  ? '访问码不正确 · 剩余尝试 ' + result.remaining + ' 次'
                  : '访问码不正确',
              )
            }
          } catch (error) {
            setPhase('denied')
            setShakeKey((k) => k + 1)
            setMessage('校验通道异常：' + String((error && error.message) || error))
          } finally {
            busy.current = false
          }
        },
        [],
      )

      const push = useCallback(
        (digit) => {
          if (busy.current || lockLeft > 0) return
          if (phase === 'granted') return
          let next = (bufferRef.current + digit).slice(0, pinLength)
          bufferRef.current = next
          setBuffer(next)
          if (next.length === pinLength) {
            setPhase('checking')
            submit(next)
          } else if (phase === 'denied' || phase === 'boot') {
            setPhase('ready')
            setMessage('')
            setRemaining(null)
          }
        },
        [buffer, lockLeft, phase, pinLength, submit],
      )

      const back = useCallback(() => {
        if (busy.current || lockLeft > 0) return
        const next = bufferRef.current.slice(0, -1)
        bufferRef.current = next
        setBuffer(next)
        setPhase('ready')
        setMessage('')
      }, [lockLeft])

      const clearAll = useCallback(() => {
        bufferRef.current = ''
        setBuffer('')
        setPhase('ready')
        setMessage('')
        setRemaining(null)
      }, [])

      /* 键盘接管 */
      useEffect(() => {
        if (unlocked) return
        if (phase === 'setup') return
        const onKey = (event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          if (/^[0-9]$/.test(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            push(event.key)
            return
          }
          if (event.key === 'Backspace') {
            event.preventDefault()
            event.stopPropagation()
            back()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            if (bufferRef.current.length >= 4) submit(bufferRef.current)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            clearAll()
            return
          }
          /* 其它可见字符一律吞掉，别漏到背后的输入框 */
          if (event.key.length === 1) {
            event.preventDefault()
            event.stopPropagation()
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [unlocked, phase, push, back, submit, clearAll])

      /* 建立访问码（首次） */
      const createPin = useCallback(async () => {
        if (!/^\d{4,8}$/.test(digits)) {
          setSetupMsg('访问码必须是 4—8 位数字')
          return
        }
        if (digits !== confirm) {
          setSetupMsg('两次输入不一致')
          return
        }
        try {
          const result = await call('/set', { pin: digits, current: '' })
          if (result.ok) {
            setSetupMsg('')
            markUnlocked()
            setPhase('granted')
            setTimeout(() => setUnlocked(true), 700)
          } else {
            setSetupMsg('设置失败：' + (result.error || 'unknown'))
          }
        } catch (error) {
          setSetupMsg('设置失败：' + String((error && error.message) || error))
        }
      }, [digits, confirm])

      if (unlocked) return null
      if (!status) return null

      const styleTag = h('style', { key: 'css' }, GATE_CSS)
      const stage = (children) =>
        h(
          'div',
          { className: 'dag-stage', role: 'dialog', 'aria-modal': 'true', 'aria-label': '身份验证' },
          styleTag,
          h('div', { className: 'dag-grid' }),
          h('div', { className: 'dag-scan' }),
          h('div', { className: 'dag-vignette' }),
          children,
        )

      /* 宿主半边没起来：放行，并提示；绝不让插件把人锁在门外 */
      if (status.error) {
        return stage(
          h(
            'div',
            { className: 'dag-panel' },
            h('span', { className: 'dag-corner tl' }),
            h('span', { className: 'dag-corner tr' }),
            h('span', { className: 'dag-corner bl' }),
            h('span', { className: 'dag-corner br' }),
            h('div', { className: 'dag-eyebrow' }, 'SYSTEM NOTICE'),
            h('h1', { className: 'dag-title' }, '验证服务未就绪'),
            h(
              'p',
              { className: 'dag-sub' },
              '宿主半边没有响应（' + status.error + '）。可能是插件还没完全加载，或路由被挡住了。',
            ),
            h(
              'button',
              {
                className: 'dag-primary',
                onClick: () => {
                  markUnlocked()
                  setUnlocked(true)
                },
              },
              '继续进入',
            ),
            h('div', { className: 'dag-foot' }, h('span', null, 'dsh-agent-gate'), h('span', null, 'FAIL-OPEN')),
          ),
        )
      }

      if (status.enabled === false) {
        return null
      }

      /* 首次使用：建立访问码 */
      if (phase === 'setup' || (status.configured === false && phase !== 'granted')) {
        return stage(
          h(
            'div',
            { className: 'dag-panel' },
            h('span', { className: 'dag-corner tl' }),
            h('span', { className: 'dag-corner tr' }),
            h('span', { className: 'dag-corner bl' }),
            h('span', { className: 'dag-corner br' }),
            h('div', { className: 'dag-eyebrow' }, 'FIRST BOOT · AGENT ENROLLMENT'),
            h('h1', { className: 'dag-title' }, '建立访问码'),
            h('p', { className: 'dag-sub' }, '这台终端还没有身份档案。设置一串 4—8 位数字，之后每次打开 DSH 都要输入它。'),
            h(
              'div',
              { className: 'dag-form' },
              h('label', { className: 'dag-label' }, '设置访问码'),
              h('input', {
                className: 'dag-input',
                type: 'password',
                inputMode: 'numeric',
                autoFocus: true,
                maxLength: 8,
                value: digits,
                onChange: (e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 8)),
              }),
              h('label', { className: 'dag-label' }, '再输一次'),
              h('input', {
                className: 'dag-input',
                type: 'password',
                inputMode: 'numeric',
                maxLength: 8,
                value: confirm,
                onChange: (e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8)),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') createPin()
                },
              }),
              setupMsg ? h('div', { className: 'dag-alert' }, setupMsg) : null,
              h('button', { className: 'dag-primary', onClick: createPin }, '确认并进入'),
            ),
            h(
              'div',
              { className: 'dag-foot' },
              h('span', null, 'SAVED TO ', h('b', null, status.storePath || '~/.dsh/agent-gate.json')),
              h('span', null, 'PBKDF2-SHA256'),
            ),
          ),
        )
      }

      const dots = []
      for (let i = 0; i < pinLength; i += 1) {
        dots.push(h('span', { key: i, className: 'dag-dot' + (i < buffer.length ? ' on' : '') }))
      }

      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
      const disabled = lockLeft > 0 || phase === 'checking'

      const keypad = h(
        'div',
        { className: 'dag-keys' },
        keys.map((k) =>
          h('button', { key: k, className: 'dag-key', disabled, onClick: () => push(k) }, k),
        ),
        h('button', { key: 'clr', className: 'dag-key fn', disabled, onClick: clearAll }, 'CLR'),
        h('button', { key: '0', className: 'dag-key', disabled, onClick: () => push('0') }, '0'),
        h('button', { key: 'ok', className: 'dag-key fn', disabled, onClick: () => submit(bufferRef.current) }, 'ENTER'),
      )

      const statusLine =
        lockLeft > 0
          ? 'ACCESS LOCKED · ' + pad2(lockLeft) + 's'
          : phase === 'granted'
            ? 'ACCESS GRANTED'
            : phase === 'checking'
              ? 'VERIFYING...'
              : phase === 'denied'
                ? 'ACCESS DENIED'
                : 'AWAITING ACCESS CODE'

      return stage(
        h(
          'div',
          { className: 'dag-panel-wrap' + (shakeKey ? ' shake' : ''), key: 'wrap' + shakeKey },
          h(
            'div',
            { className: 'dag-panel' },
            h('span', { className: 'dag-corner tl' }),
            h('span', { className: 'dag-corner tr' }),
            h('span', { className: 'dag-corner bl' }),
            h('span', { className: 'dag-corner br' }),

            h('div', { className: 'dag-eyebrow' }, 'DSH // MISSION CONTROL'),
            h('h1', { className: 'dag-title' }, 'AGENT AUTHENTICATION'),
            h('p', { className: 'dag-sub' }, '本次任务已加密。输入访问码以解除锁定 —— ' + pinLength + ' 位数字。'),

            h(
              'div',
              { className: 'dag-boot' },
              BOOT_LINES.map((pair, i) =>
                bootStep > i
                  ? h(
                      'div',
                      { key: i, className: 'dag-boot-line' },
                      '> ' + pair[0] + ' ... ',
                      h('b', null, 'OK'),
                      '  ',
                      h('span', { style: { opacity: 0.45 } }, pair[1]),
                    )
                  : null,
              ),
            ),

            h('div', { className: 'dag-dots' }, dots),

            keypad,

            message
              ? h('div', { className: 'dag-alert' + (phase === 'granted' ? ' ok' : '') }, message)
              : null,

            h(
              'div',
              { className: 'dag-foot' },
              h('span', null, 'STATUS ', h('b', null, statusLine)),
              h('span', null, 'ALT+L 立即上锁'),
            ),
          ),

          phase === 'granted'
            ? h(
                'div',
                { className: 'dag-granted' },
                h('div', { className: 'dag-granted-text' }, 'ACCESS GRANTED'),
              )
            : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ 设置页 */

    function SettingsPanel() {
      const [status, setStatus] = useState(null)
      const [newPin, setNewPin] = useState('')
      const [repeat, setRepeat] = useState('')
      const [current, setCurrent] = useState('')
      const [msg, setMsg] = useState(null)
      const [busy, setBusy] = useState(false)

      const refresh = useCallback(() => {
        call('/status')
          .then((s) => setStatus(s))
          .catch((e) => setMsg({ kind: 'err', text: '读取状态失败：' + String((e && e.message) || e) }))
      }, [])

      useEffect(() => {
        refresh()
      }, [refresh])

      const save = async () => {
        if (!/^\d{4,8}$/.test(newPin)) return setMsg({ kind: 'err', text: '访问码必须是 4—8 位数字' })
        if (newPin !== repeat) return setMsg({ kind: 'err', text: '两次输入不一致' })
        setBusy(true)
        try {
          const r = await call('/set', { pin: newPin, current })
          if (r.ok) {
            setMsg({ kind: 'ok', text: '已更新。下次打开 DSH 生效。' })
            setNewPin('')
            setRepeat('')
            setCurrent('')
            refresh()
          } else if (r.error === 'wrong-current') {
            setMsg({ kind: 'err', text: '当前访问码不正确' })
          } else {
            setMsg({ kind: 'err', text: '保存失败：' + (r.error || 'unknown') })
          }
        } catch (e) {
          setMsg({ kind: 'err', text: String((e && e.message) || e) })
        } finally {
          setBusy(false)
        }
      }

      const toggle = async () => {
        setBusy(true)
        try {
          const r = await call('/toggle', { enabled: !(status && status.enabled), current })
          if (r.ok) {
            setMsg({ kind: 'ok', text: r.enabled ? '闸门已开启' : '闸门已关闭' })
            setCurrent('')
            refresh()
          } else if (r.error === 'wrong-current') {
            setMsg({ kind: 'err', text: '关闭闸门需要输入当前访问码' })
          } else {
            setMsg({ kind: 'err', text: '操作失败：' + (r.error || 'unknown') })
          }
        } catch (e) {
          setMsg({ kind: 'err', text: String((e && e.message) || e) })
        } finally {
          setBusy(false)
        }
      }

      const clearPin = async () => {
        setBusy(true)
        try {
          const r = await call('/clear', { current })
          if (r.ok) {
            setMsg({ kind: 'ok', text: '访问码已清除，下次打开会要求重新设置。' })
            setCurrent('')
            refresh()
          } else {
            setMsg({ kind: 'err', text: '清除失败：需要正确的当前访问码' })
          }
        } catch (e) {
          setMsg({ kind: 'err', text: String((e && e.message) || e) })
        } finally {
          setBusy(false)
        }
      }

      const configured = Boolean(status && status.configured)
      const enabled = Boolean(status && status.enabled)

      return h(
        'div',
        { className: 'dag-set' },
        h('style', null, SETTINGS_CSS),

        h(
          'div',
          { className: 'dag-set-card' },
          h(
            'div',
            { className: 'dag-set-head' },
            h('span', { className: 'dag-set-title' }, '启动闸门'),
            h(
              'span',
              { className: 'dag-badge ' + (enabled && configured ? 'on' : 'off') },
              enabled ? (configured ? '已设访问码' : '未设访问码') : '已关闭',
            ),
          ),
          h(
            'p',
            { className: 'dag-hint' },
            '打开 DSH 时用「特工身份验证」挡住界面，输入 ' +
              (configured ? (status && status.length) || 6 : '4—8') +
              ' 位数字访问码才能进入。解锁状态跟随窗口会话：刷新页面不用再输，彻底退出后重开需要重新验证。',
          ),
          h(
            'div',
            { className: 'dag-set-row' },
            h('button', { className: 'primary', onClick: () => relock(), disabled: busy }, '立即上锁'),
            h('button', { onClick: toggle, disabled: busy }, enabled ? '关闭闸门' : '开启闸门'),
          ),
          !enabled || !configured
            ? h('p', { className: 'dag-hint' }, '关闭闸门 / 改密码时，若已设置访问码，需要下面的「当前访问码」。')
            : null,
        ),

        h(
          'div',
          { className: 'dag-set-card' },
          h('div', { className: 'dag-set-head' }, h('span', { className: 'dag-set-title' }, configured ? '修改访问码' : '设置访问码')),
          h(
            'div',
            { className: 'dag-set-row' },
            h('input', {
              type: 'password',
              inputMode: 'numeric',
              placeholder: configured ? '当前访问码' : '（尚未设置）',
              value: current,
              disabled: !configured,
              maxLength: 8,
              onChange: (e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 8)),
            }),
          ),
          h(
            'div',
            { className: 'dag-set-row' },
            h('input', {
              type: 'password',
              inputMode: 'numeric',
              placeholder: '新访问码 4—8 位',
              value: newPin,
              maxLength: 8,
              onChange: (e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8)),
            }),
            h('input', {
              type: 'password',
              inputMode: 'numeric',
              placeholder: '再输一次',
              value: repeat,
              maxLength: 8,
              onChange: (e) => setRepeat(e.target.value.replace(/\D/g, '').slice(0, 8)),
              onKeyDown: (e) => {
                if (e.key === 'Enter') save()
              },
            }),
            h('button', { className: 'primary', onClick: save, disabled: busy }, '保存'),
          ),
          msg ? h('div', { className: 'dag-set-msg ' + msg.kind }, msg.text) : null,
        ),

        h(
          'div',
          { className: 'dag-set-card' },
          h('div', { className: 'dag-set-head' }, h('span', { className: 'dag-set-title' }, '细节')),
          h(
            'p',
            { className: 'dag-hint' },
            '连续输错 5 次会进入冷却：15 秒起，逐轮翻倍，最长 5 分钟。访问码以 PBKDF2-SHA256（12 万轮）派生后保存在 ' +
              (status && status.storePath ? status.storePath : '~/.dsh/agent-gate.json') +
              '，浏览器里不留明文。',
          ),
          h(
            'p',
            { className: 'dag-hint' },
            '忘了访问码：退出 DSH，删除 <code>%USERPROFILE%\\.dsh\\agent-gate.json</code>，重新打开就能重设。',
          ),
          h(
            'div',
            { className: 'dag-set-row' },
            h('button', { className: 'danger', onClick: clearPin, disabled: busy || !configured }, '清除访问码'),
          ),
        ),

        h(
          'p',
          { className: 'dag-set-foot' },
          '快捷键：在任意界面按 Alt+L 立即上锁。闸门是体验层的屏保式锁，不替代 DSH 的沙箱与审批策略。',
        ),
      )
    }

    /* ------------------------------------------------------------------ 挂载 */

    function apply(ctx) {
      const slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
      if (!slots) {
        console.error('[dsh-agent-gate] 拿不到 slots 服务')
        return
      }

      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'agent-gate', order: 1000 }, () => h(Gate)),
      )

      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'agent-gate', order: 130, label: '启动密码' }, () =>
          h(SettingsPanel),
        ),
      )

      ctx.effect(() => {
        const onKey = (event) => {
          if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
          if (String(event.key).toLowerCase() !== 'l') return
          event.preventDefault()
          relock()
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, 'dsh-agent-gate: Alt+L 重新上锁')

      console.log('[dsh-agent-gate] 客户端已挂载：身份验证闸门 + 设置页')
    }

    return { inject: ['slots'], apply }
  },
})
