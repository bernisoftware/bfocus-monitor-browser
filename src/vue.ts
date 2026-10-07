/**
 * `@bfocus/monitor/vue` — handler de erro do Vue 3 que manda o erro ao bFocus e encadeia o
 * handler que já existia (sem importar o Vue).
 *
 *   import { vueErrorHandler } from '@bfocus/monitor/vue'
 *   app.config.errorHandler = vueErrorHandler(app.config.errorHandler)
 */
import { captureException } from './client.js'

export type VueErrorHandler = (err: unknown, instance: unknown, info: string) => void

export function vueErrorHandler(previous?: VueErrorHandler | null): VueErrorHandler {
  return function bfocusVueErrorHandler(err: unknown, instance: unknown, info: string): void {
    captureException(err, info ? { tags: { 'vue.info': String(info).slice(0, 200) } } : undefined)
    if (typeof previous === 'function') {
      previous(err, instance, info)
    } else {
      // Sem handler, o Vue mostraria o erro no console: continua mostrando.
      console.error(err)
    }
  }
}
