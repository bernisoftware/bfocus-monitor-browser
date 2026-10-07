/**
 * Conformidade (monitor/BRIEF.md §8): roda TODOS os casos de test/cases.json — cópia de
 * monitor/conformance/cases.json escrita por `python3 monitor/conformance/generate.py` — contra
 * um servidor HTTP local.
 *
 * DIFERENÇA DO NAVEGADOR (documentada, vem do núcleo `src/core.ts` = widget/src/monitor/core.ts):
 * para não disparar preflight de CORS, o núcleo NÃO manda headers customizados. Por isso, aqui:
 * - `X-bFocus-Monitor-Key` → a chave vai na query (`?key=`), que a API também aceita;
 * - `Content-Type: application/json` → `text/plain` (o corpo continua JSON; a API aceita);
 * - `X-bFocus-Client` → não vai; o prefixo é conferido em `sdk.name` do corpo.
 * - `signingSecret` é só servidor: no caso da identidade assinada, o teste faz o papel do servidor
 *   do cliente (assina com o segredo) e passa o `userHash` pronto ao `setUser`.
 * - 429 → nova tentativa e 401 → parar de enviar: o núcleo hoje NÃO lê a resposta (manda e
 *   esquece). Esses dois casos rodam como `todo` até o núcleo do widget ganhar esse tratamento.
 * - Sinal de vida: mesmas trocas de header (`?key=` + text/plain, sem X-bFocus-Client).
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import * as monitor from "@bfocus/monitor";
import { getPath, sleep, startServer, type TestServer } from "./helpers/server.js";
import { memoryStorage, useStorage } from "./helpers/storage.js";

useStorage(null);

const CASES_URL = new URL("../test/cases.json", import.meta.url);
const SOURCE_URL = new URL("../../conformance/cases.json", import.meta.url);
const CASES = JSON.parse(readFileSync(CASES_URL, "utf8"));

/** Casos que o núcleo ainda não cumpre (ver o cabeçalho). */
const CORE_TODO: Record<string, string> = {};

interface Capture {
  kind: "exception" | "message";
  type?: string;
  message: string;
  level?: monitor.Level;
  tags?: Record<string, string>;
  fingerprint?: string[];
}

function doCapture(c: Capture): void {
  if (c.kind === "message") {
    monitor.captureMessage(c.message, c.level);
    return;
  }
  const err = new Error(c.message);
  err.name = c.type ?? "Error";
  monitor.captureException(err, { level: c.level, tags: c.tags, fingerprint: c.fingerprint });
}

/** O que o servidor do cliente faz (o segredo nunca vai ao navegador). */
function serverSideSign(secret: string, user: string, customer: string, ts: number): string {
  return `v2.${ts}.${createHmac("sha256", secret).update(`v2:${ts}:${user}:${customer}`).digest("hex")}`;
}

describe("cases.json", () => {
  it("a cópia é igual à fonte (no monorepo)", { skip: !existsSync(SOURCE_URL) && "espelho público: só a cópia existe" }, () => {
    assert.equal(readFileSync(CASES_URL, "utf8"), readFileSync(SOURCE_URL, "utf8"));
  });

  it("user_hash: os vetores batem com a assinatura que o servidor do cliente gera", () => {
    for (const v of CASES.user_hash) {
      assert.equal(serverSideSign(v.secret, v.user_external_id, v.customer_external_id, v.ts), v.expected);
    }
  });

  for (const f of CASES.frames) {
    it(`frames: ${f.name}`, () => {
      // Rastro neutro → rastro do Chrome (de dentro para fora). Biblioteca em JS mora em node_modules.
      const toJs = (file: string) => file.replace("site-packages", "node_modules");
      const stack = ["Error: x", ...f.runtime_order.map((r: any) => `    at ${r.function} (${toJs(r.file)}:${r.line}:1)`)].join("\n");
      const frames = monitor.parseStack(stack, "https://app.cliente.com").map(({ col: _col, ...rest }) => rest);
      assert.deepEqual(frames, f.expected.map((e: any) => ({ ...e, file: toJs(e.file) })));
    });
  }
});

describe("send", () => {
  let server: TestServer | null = null;
  afterEach(async () => {
    monitor.close();
    await sleep(50);
    await server?.close();
    server = null;
  });

  for (const c of CASES.send) {
    it(c.name, { todo: CORE_TODO[c.name] }, async () => {
      server = await startServer();
      server.replies.push(...c.requests.map((r: any) => r.respond));
      monitor.init({
        key: c.init.key,
        release: c.init.release,
        environment: c.init.environment,
        ignore: c.init.ignore,
        baseUrl: server.url,
        autoCapture: false,
      });
      if (c.set_user) {
        const u = c.set_user;
        const hash = u.user_hash ?? serverSideSign(c.init.signing_secret, u.user_external_id, u.customer_external_id, u.ts);
        monitor.setUser({ externalId: u.user_external_id, userHash: hash }, { externalId: u.customer_external_id });
      }
      for (const b of c.breadcrumbs ?? []) monitor.addBreadcrumb(b.category, b.message, b.level);
      for (let i = 0; i < (c.repeat ?? 1); i += 1) doCapture(c.capture);
      monitor.flush();
      await server.waitFor(c.requests.length, c.requests.length > 1 ? 4000 : 1500);
      await sleep(150);

      assert.equal(server.requests.length, c.requests.length, "número de requisições");
      c.requests.forEach((r: any, i: number) => {
        const got = server!.requests[i]!;
        const exp = r.expect;
        assert.equal(got.method, exp.method);
        assert.equal(got.path, exp.path);
        assert.equal(got.query.key, exp.headers["X-bFocus-Monitor-Key"], "chave na query");
        assert.equal(got.headers["x-bfocus-monitor-key"], undefined, "sem header customizado (preflight)");
        assert.equal(got.headers["content-type"], "text/plain", "text/plain: sem preflight");
        for (const [k, prefix] of Object.entries(exp.header_prefix)) {
          assert.equal(got.headers[k.toLowerCase()], undefined, k);
          assert.ok(got.body.events[0].sdk.name.startsWith(prefix as string), "sdk.name");
        }
        assert.ok(Array.isArray(got.body.events) && got.body.events.length === 1, "corpo {events: [1 evento]}");
        const event = got.body.events[0];
        for (const [path, value] of Object.entries(exp.event)) {
          assert.deepEqual(getPath(event, path), value === "$version" ? monitor.VERSION : value, path);
        }
        assert.equal(event.sdk.name, "bfocus-monitor-browser");
        if (i > 0) assert.equal(got.rawBody, server!.requests[i - 1]!.rawBody, "nova tentativa com o mesmo corpo");
      });

      const before = server.requests.length;
      if (c.then_capture) {
        doCapture(c.then_capture);
        monitor.flush();
        await sleep(300);
      }
      assert.equal(server.requests.length, before, c.after === "disabled" ? "depois do 401 nada mais sai" : "nada a mais");
    });
  }
});

describe("heartbeat", () => {
  for (const c of CASES.heartbeat) {
    it(c.name, async () => {
      const server = await startServer();
      useStorage(memoryStorage());
      try {
        server.heartbeatReplies.push(c.respond);
        monitor.init({ key: c.init.key, release: c.init.release, environment: c.init.environment, baseUrl: server.url, autoCapture: false });
        await server.waitForHeartbeats(1, 2000);
        await sleep(50);
        assert.equal(server.heartbeats.length, 1, "um sinal de vida no init");
        assert.equal(server.requests.length, 0, "nenhum evento");
        const got = server.heartbeats[0]!;
        const exp = c.expect;
        assert.equal(got.method, exp.method);
        assert.equal(got.path, exp.path);
        assert.equal(got.query.key, exp.headers["X-bFocus-Monitor-Key"], "chave na query");
        assert.equal(got.headers["content-type"], "text/plain", "text/plain: sem preflight");
        for (const [k] of Object.entries(exp.header_prefix)) assert.equal(got.headers[k.toLowerCase()], undefined, k);
        for (const [path, value] of Object.entries(exp.body)) {
          assert.deepEqual(getPath(got.body, path), value === "$version" ? monitor.VERSION : value, path);
        }
        for (const path of exp.body_present) assert.ok(getPath(got.body, path), `${path} presente`);
        assert.equal(got.body.sdk.name, "bfocus-monitor-browser");
        assert.equal(got.body.host, undefined, "navegador não manda host");
      } finally {
        monitor.close();
        useStorage(null);
        await sleep(30);
        await server.close();
      }
    });
  }
});
