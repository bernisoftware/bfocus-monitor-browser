/**
 * @bfocus/monitor — erros da sua página viram demanda no bFocus.
 *
 *   import * as monitor from '@bfocus/monitor'
 *   monitor.init({ key: 'bf_mon_…', release: '1.4.2', environment: 'production' })
 *   monitor.setUser({ externalId: 'u-123', userHash }, { externalId: 'cliente-9' })
 *
 * React: `import { ErrorBoundary } from '@bfocus/monitor/react'`.
 * Vue:   `import { vueErrorHandler } from '@bfocus/monitor/vue'`.
 * Este módulo não importa framework nenhum.
 */
export { init, captureException, captureMessage, setUser, setTag, addBreadcrumb, flush, close, VERSION, SDK_NAME } from './client.js'
export type { InitOptions, CaptureOptions } from './client.js'
export { parseStack } from './core.js'
export type { Level, Frame, MonitorEvent, MonitorIdentity } from './core.js'
