# @bfocus/monitor

Monitoramento de erros do [bFocus](https://bfocus.com.br) para o navegador. Os erros da sua página
chegam ao bFocus, são agrupados pela causa entre todos os clientes e viram demanda para a equipe —
com a versão do sistema, o ambiente e o cliente afetado.

Zero dependências. Nunca derruba a página: escuta `error` e `unhandledrejection` com
`addEventListener` (o que o site já trata continua igual, e o erro continua no console), envia em
lote, sem preflight de CORS, e pelo `sendBeacon` quando a página fecha.

Já usa o widget do bFocus? Então não precisa deste pacote: `bFocus.init({ monitor: { key } })`.

## Instalar

```sh
npm install @bfocus/monitor
```

## Ligar (uma linha)

```js
import * as monitor from '@bfocus/monitor'

monitor.init({ key: 'bf_mon_…', release: '1.4.2', environment: 'production' })
```

A chave do agente é pública (vai no navegador); o bFocus só aceita eventos das origens cadastradas
no agente (painel → Monitoramento → Agentes).

Opções: `key` (obrigatória), `release`, `environment` (padrão `production`), `baseUrl`,
`sampleRate` (0..1), `ignore` (textos ou RegExp), `beforeSend(event)` (devolva o evento alterado
ou `null` para descartar), `autoCapture` (padrão `true`).

## Framework

**React** — o `ErrorBoundary` mora num subpath (o pacote principal não importa React):

```jsx
import { ErrorBoundary } from '@bfocus/monitor/react'

<ErrorBoundary fallback={<p>Algo deu errado</p>}>
  <App />
</ErrorBoundary>
```

`fallback` também pode ser uma função `({ error, resetError }) => ...`. Props `tags` e `onError`
opcionais.

**Vue 3** — encadeia o handler que já existir:

```js
import { vueErrorHandler } from '@bfocus/monitor/vue'

app.config.errorHandler = vueErrorHandler(app.config.errorHandler)
```

## Quem foi afetado

O bFocus só liga o erro ao cliente e à pessoa com a identidade assinada — a MESMA assinatura v2 que
o seu servidor já entrega ao widget (`userHash`). O segredo nunca vai para o navegador.

```js
// Depois do login:
monitor.setUser({ externalId: 'u-123', userHash }, { externalId: 'cliente-9' })
// No logout:
monitor.setUser()
```

## Manual

```js
monitor.captureException(err, { level: 'warning', tags: { modulo: 'fiscal' }, fingerprint: ['nf'] })
monitor.captureMessage('estoque negativo', 'info')
monitor.setTag('modulo', 'fiscal')
monitor.addBreadcrumb('ui', 'clicou em Salvar')
monitor.flush()  // manda já o que está na fila
monitor.close()  // para de escutar a página
```

No `init` sai um sinal de vida (no máximo 1 a cada 30 min por aparelho), para o painel saber que
o agente está instalado mesmo sem erro. O mesmo erro sai no máximo uma vez a cada 30 s, e no máximo 50 erros por página. Erros de extensão
do navegador e `Script error.` sem rastro (script de outra origem sem CORS) não são enviados.

## Licença

MIT — Berni Software.
