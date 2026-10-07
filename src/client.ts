/**
 * O monitor da página (singleton) sobre o núcleo `createMonitor` (src/core.ts — cópia do
 * núcleo do widget, que é a fonte única do código de captura do navegador).
 * O sinal de vida (BRIEF §7b) é do núcleo: 1 no `init`, no máximo 1 a cada 30 min por aparelho.
 */
import { createMonitor, SDK_VERSION, type Level, type Monitor, type MonitorEvent, type MonitorIdentity } from './core.js'

/** Versão do pacote (a mesma do núcleo; vai em `sdk.version`). */
export const VERSION: string = SDK_VERSION
/** `sdk.name` dos eventos. */
export const SDK_NAME = 'bfocus-monitor-browser'

export interface InitOptions {
  /** Chave do agente (`bf_mon_…`). Obrigatória. */
  key: string
  /** Versão do seu sistema (`1.4.2`). */
  release?: string
  /** Padrão `production`. */
  environment?: string
  /** Padrão `https://api.bfocus.com.br`. */
  baseUrl?: string
  /** 0..1 — fração dos erros enviada (padrão 1). */
  sampleRate?: number
  /** Mensagens a ignorar (texto contido ou RegExp). */
  ignore?: (string | RegExp)[]
  /** Última chance de mudar ou descartar (devolva null) o evento. */
  beforeSend?: (event: MonitorEvent) => MonitorEvent | null
  /** Escutar `error` e `unhandledrejection` da página (padrão true). */
  autoCapture?: boolean
}

export interface CaptureOptions {
  level?: Level
  tags?: Record<string, string>
  fingerprint?: string[]
}

let current: Monitor | null = null


/** Liga o monitor. Sem rede aqui: nada sai até o primeiro erro. Chamar de novo troca a configuração. */
export function init(opts: InitOptions): void {
  if (!opts || typeof opts.key !== 'string' || !opts.key.trim()) {
    throw new TypeError('bFocus monitor: `key` é obrigatória (a chave do agente, bf_mon_…)')
  }
  try { current?.close() } catch { /* ignore */ }
  const key = opts.key.trim()
  const monitor = createMonitor({
    key,
    release: opts.release,
    environment: opts.environment || 'production',
    apiBaseUrl: opts.baseUrl,
    sampleRate: opts.sampleRate,
    ignore: opts.ignore,
    beforeSend: opts.beforeSend,
    autoCapture: opts.autoCapture,
  }, { sdk: SDK_NAME })
  current = monitor
}

export function captureException(err: unknown, opts?: CaptureOptions): void {
  try { current?.captureException(err, opts) } catch { /* nunca derruba a página */ }
}

export function captureMessage(message: string, level?: Level): void {
  try { current?.captureMessage(message, level) } catch { /* ignore */ }
}

/**
 * Quem foi afetado. O `userHash` vem do SEU servidor (a mesma assinatura v2 do widget) — o
 * segredo nunca vai para o navegador. Sem argumentos, limpa.
 */
export function setUser(user?: MonitorIdentity['user'], customer?: MonitorIdentity['customer']): void {
  try { current?.setUser(user, customer) } catch { /* ignore */ }
}

export function setTag(key: string, value: string): void {
  try { current?.setTag(key, value) } catch { /* ignore */ }
}

export function addBreadcrumb(category: string, message: string, level?: Level): void {
  try { current?.addBreadcrumb(category, message, level) } catch { /* ignore */ }
}

/** Manda já o que está na fila (sem esperar a resposta). */
export function flush(): void {
  try { current?.flush() } catch { /* ignore */ }
}

/** Manda o que falta, para de escutar a página e desliga. */
export function close(): void {
  try { current?.close() } catch { /* ignore */ }
  current = null
}
