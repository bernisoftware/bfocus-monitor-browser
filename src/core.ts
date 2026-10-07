/**
 * Monitoramento no navegador — o núcleo, sem dependência nenhuma.
 *
 * É a FONTE ÚNICA do código de captura do navegador: o widget (`bFocus.init({ monitor })`),
 * o script da CDN (`/v1/monitor.js`) e o pacote npm `@bfocus/monitor` usam este arquivo
 * (o pacote recebe uma cópia em `monitor/browser/src/core.ts`; o teste de lá confere que é
 * igual). Contrato do evento: `monitor/BRIEF.md`.
 *
 * - Escuta `error` e `unhandledrejection` com addEventListener: não substitui nada que o site
 *   já trate (o handler do site continua rodando, e o erro continua no console).
 * - Não manda erro de extensão do navegador nem "Script error." sem rastro (script de outra
 *   origem sem CORS: não há o que investigar).
 * - O mesmo erro no máximo 1 vez a cada 30 s, e no máximo 50 por página.
 * - Envia sem preflight (`text/plain` + `?key=`), em lote, e no `pagehide` pelo sendBeacon.
 * - Sinal de vida (monitor/BRIEF.md §7b): 1 por aparelho a cada 30 min, para o painel saber
 *   que o agente está instalado e rodando mesmo sem erro nenhum.
 * - Nunca derruba a página: toda falha do monitor é engolida.
 */

export type Level = 'fatal' | 'error' | 'warning' | 'info'

export interface MonitorIdentity {
  user?: { externalId: string; userHash?: string }
  customer?: { externalId: string }
}

export interface MonitorOptions {
  /** Chave de envio do agente (`bf_mon_…`). */
  key: string
  release?: string
  environment?: string
  /** 0..1 — fração dos erros enviada (padrão 1). */
  sampleRate?: number
  /** Mensagens a ignorar (texto contido ou RegExp). */
  ignore?: (string | RegExp)[]
  apiBaseUrl?: string
  /** Última chance de mudar ou descartar (devolva null) o evento. */
  beforeSend?: (event: MonitorEvent) => MonitorEvent | null
  /** Captura automática de erros não tratados (padrão true). */
  autoCapture?: boolean
}

export interface Frame { file?: string; function?: string; line?: number; col?: number; inApp?: boolean }

export interface MonitorEvent {
  timestamp: string
  level: Level
  release?: string
  environment?: string
  exception: { type: string; message: string; frames: Frame[] }
  url?: string
  user?: { externalId: string; userHash?: string }
  customer?: { externalId: string }
  tags?: Record<string, string>
  breadcrumbs?: { timestamp: string; category: string; message: string; level: Level }[]
  fingerprint?: string[]
  contexts?: Record<string, Record<string, string>>
  sdk: { name: string; version: string }
}

export interface Monitor {
  captureException: (err: unknown, extra?: { level?: Level; tags?: Record<string, string>; fingerprint?: string[] }) => void
  captureMessage: (message: string, level?: Level) => void
  setUser: (user?: MonitorIdentity['user'], customer?: MonitorIdentity['customer']) => void
  setTag: (key: string, value: string) => void
  addBreadcrumb: (category: string, message: string, level?: Level) => void
  flush: () => void
  close: () => void
}

export const SDK_VERSION = '0.1.0'
const DEFAULT_API = 'https://api.bfocus.com.br'
const MAX_PER_PAGE = 50
const DEDUPE_MS = 30_000
const MAX_CRUMBS = 30
const FLUSH_MS = 1000
const HEARTBEAT_EVERY_MS = 30 * 60 * 1000

function store(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

/** Id aleatório do aparelho (fica no localStorage; sem ele, um por carregamento). */
function deviceId(): string {
  const s = store()
  try {
    const cur = s?.getItem('bf_mon_device')
    if (cur) return cur
    const id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
    s?.setItem('bf_mon_device', id)
    return id
  } catch { return Math.random().toString(36).slice(2, 12) }
}

// Chrome/Edge: "    at fn (url:1:2)" ou "    at url:1:2"; Firefox/Safari: "fn@url:1:2".
const CHROME_RE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/
const GECKO_RE = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/
const EXTENSION_RE = /^(chrome|moz|safari|safari-web)-extension:\/\//

/** Rastro do JS (de dentro para fora) → frames do contrato (de fora para dentro). */
export function parseStack(stack: string | undefined, pageOrigin: string, ownOrigins: string[] = []): Frame[] {
  if (!stack) return []
  const frames: Frame[] = []
  for (const raw of stack.split('\n').slice(0, 60)) {
    const m = CHROME_RE.exec(raw) || GECKO_RE.exec(raw)
    if (!m) continue
    const file = m[2]
    const fn = (m[1] || '').replace(/^(async |new )/, '').trim() || undefined
    let inApp = !/node_modules|\/vendor[-.]|<anonymous>|^native$/.test(file) && !EXTENSION_RE.test(file)
    if (inApp && /^https?:/.test(file)) {
      try {
        const origin = new URL(file).origin
        inApp = origin === pageOrigin && !ownOrigins.includes(origin)
      } catch { inApp = false }
    }
    frames.push({ file, function: fn, line: Number(m[3]), col: Number(m[4]), inApp })
  }
  return frames.reverse()
}

function asError(err: unknown): { type: string; message: string; stack?: string } {
  if (err instanceof Error) return { type: err.name || 'Error', message: err.message || String(err), stack: err.stack }
  if (typeof err === 'string') return { type: 'Error', message: err }
  try { return { type: 'Error', message: JSON.stringify(err).slice(0, 500) } } catch { return { type: 'Error', message: String(err) } }
}

export function createMonitor(opts: MonitorOptions, own: { sdk?: string; ownOrigins?: string[] } = {}): Monitor {
  const api = (opts.apiBaseUrl || DEFAULT_API).replace(/\/+$/, '')
  const endpoint = `${api}/api/v1/monitor/events?key=${encodeURIComponent(opts.key)}`
  const sdk = { name: own.sdk || 'bfocus-monitor-browser', version: SDK_VERSION }
  const ownOrigins = own.ownOrigins || []
  const pageOrigin = typeof location !== 'undefined' ? location.origin : ''
  let identity: MonitorIdentity = {}
  const tags: Record<string, string> = {}
  const crumbs: NonNullable<MonitorEvent['breadcrumbs']> = []
  const seen = new Map<string, number>()
  let sent = 0
  let queue: MonitorEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  // 401/403 (chave errada/revogada, módulo desligado, origem recusada): para de enviar até um
  // novo init — nunca martelar a API.
  let disabled = false
  const cleanups: (() => void)[] = []

  const post = (url: string, body: string, retry: boolean): void => {
    if (disabled) return
    void fetch(url, { method: 'POST', body, keepalive: body.length < 60_000, headers: { 'Content-Type': 'text/plain' } })
      .then((r) => {
        if (r.status === 401 || r.status === 403) disabled = true
        else if ((r.status === 429 || r.status >= 500) && retry) setTimeout(() => post(url, body, false), 2000)
      })
      .catch(() => { if (retry) setTimeout(() => post(url, body, false), 2000) })
  }

  const send = (events: MonitorEvent[], beacon: boolean) => {
    if (!events.length || disabled) return
    const body = JSON.stringify({ events })
    try {
      if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))
        return
      }
      post(endpoint, body, true)
    } catch { /* nunca derruba a página */ }
  }

  const flush = (beacon = false) => {
    if (timer) { clearTimeout(timer); timer = null }
    const batch = queue
    queue = []
    send(batch, beacon)
  }

  const ignored = (message: string) =>
    (opts.ignore || []).some((p) => (typeof p === 'string' ? message.includes(p) : p.test(message)))

  const enqueue = (exc: { type: string; message: string; stack?: string }, level: Level,
    extra?: { tags?: Record<string, string>; fingerprint?: string[] }) => {
    if (closed || disabled || sent >= MAX_PER_PAGE) return
    const frames = parseStack(exc.stack, pageOrigin, ownOrigins)
    if (!frames.length && /^Script error\.?$/.test(exc.message)) return
    if (frames.length && frames.every((f) => f.file && EXTENSION_RE.test(f.file))) return
    if (ignored(exc.message)) return
    if (opts.sampleRate !== undefined && opts.sampleRate < 1 && Math.random() >= opts.sampleRate) return
    const top = [...frames].reverse().find((f) => f.inApp) || frames[frames.length - 1]
    const key = `${exc.type}|${exc.message}|${top?.file}:${top?.line}`
    const now = Date.now()
    if ((seen.get(key) ?? 0) > now - DEDUPE_MS) return
    seen.set(key, now)
    sent += 1
    let event: MonitorEvent | null = {
      timestamp: new Date().toISOString(), level, release: opts.release, environment: opts.environment,
      exception: { type: exc.type, message: exc.message.slice(0, 2000), frames },
      // Sem query nem fragmento: é onde mora token, e-mail e CPF.
      url: typeof location !== 'undefined' ? location.origin + location.pathname : undefined,
      ...identity.user ? { user: identity.user } : {}, ...identity.customer ? { customer: identity.customer } : {},
      tags: { ...tags, ...(extra?.tags || {}) },
      breadcrumbs: crumbs.slice(),
      ...(extra?.fingerprint ? { fingerprint: extra.fingerprint } : {}),
      contexts: typeof navigator !== 'undefined' ? { browser: { userAgent: navigator.userAgent.slice(0, 300), language: navigator.language } } : {},
      sdk,
    }
    if (opts.beforeSend) {
      try { event = opts.beforeSend(event) } catch { /* beforeSend com erro: manda como está */ }
    }
    if (!event) return
    queue.push(event)
    if (!timer) timer = setTimeout(() => flush(), FLUSH_MS)
  }

  const addBreadcrumb = (category: string, message: string, level: Level = 'info') => {
    crumbs.push({ timestamp: new Date().toISOString(), category, message: String(message).slice(0, 300), level })
    if (crumbs.length > MAX_CRUMBS) crumbs.shift()
  }

  // Sinal de vida: no máximo 1 a cada 30 min por aparelho e por chave.
  try {
    const s = store()
    const mark = `bf_mon_hb_${opts.key.slice(-8)}`
    const last = Number(s?.getItem(mark) || 0)
    if (Date.now() - last > HEARTBEAT_EVERY_MS && typeof fetch !== 'undefined') {
      s?.setItem(mark, String(Date.now()))
      const body = JSON.stringify({
        instance: deviceId(), release: opts.release, environment: opts.environment, sdk,
        runtime: typeof navigator !== 'undefined' ? { name: 'browser', version: navigator.userAgent.slice(0, 80) } : undefined,
      })
      void fetch(`${api}/api/v1/monitor/heartbeat?key=${encodeURIComponent(opts.key)}`,
        { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
        .then((r) => { if (r.status === 401 || r.status === 403) disabled = true })
        .catch(() => {})
    }
  } catch { /* nunca derruba a página */ }

  if (opts.autoCapture !== false && typeof window !== 'undefined') {
    const onError = (e: ErrorEvent) => {
      const err = e.error ?? e.message
      const info = asError(err)
      if (!info.stack && e.filename) info.stack = `    at ${e.filename}:${e.lineno || 0}:${e.colno || 0}`
      enqueue(info, 'error')
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const info = asError(e.reason)
      if (!(e.reason instanceof Error)) info.type = 'UnhandledRejection'
      enqueue(info, 'error')
    }
    const onHide = () => flush(true)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('pagehide', onHide)
    cleanups.push(() => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('pagehide', onHide)
    })
    // Passos antes do erro: troca de rota e console.error (sem mexer no que o console mostra).
    const origPush = history.pushState
    const origErr = console.error
    history.pushState = function (...args: Parameters<History['pushState']>) {
      try { addBreadcrumb('navigation', String(args[2] ?? '')) } catch { /* ignore */ }
      return origPush.apply(this, args)
    }
    const onPop = () => addBreadcrumb('navigation', location.pathname)
    window.addEventListener('popstate', onPop)
    console.error = function (...args: unknown[]) {
      try { addBreadcrumb('console', args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '), 'error') } catch { /* ignore */ }
      return origErr.apply(this, args)
    }
    cleanups.push(() => {
      history.pushState = origPush
      console.error = origErr
      window.removeEventListener('popstate', onPop)
    })
  }

  return {
    captureException: (err, extra) => enqueue(asError(err), extra?.level || 'error', extra),
    captureMessage: (message, level = 'info') => enqueue({ type: 'Message', message }, level, { fingerprint: [message] }),
    setUser: (user, customer) => { identity = { user, customer } },
    setTag: (k, v) => { tags[String(k).slice(0, 64)] = String(v).slice(0, 200) },
    addBreadcrumb,
    flush: () => flush(),
    close: () => { flush(true); closed = true; cleanups.forEach((c) => c()) },
  }
}
