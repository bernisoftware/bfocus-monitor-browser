/** Subpaths de framework: React (ErrorBoundary) e Vue (vueErrorHandler). */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement, isValidElement } from "react";
import * as monitor from "@bfocus/monitor";
import { ErrorBoundary } from "@bfocus/monitor/react";
import { vueErrorHandler } from "@bfocus/monitor/vue";
import { sleep, startServer, type TestServer } from "./helpers/server.js";
import { useStorage } from "./helpers/storage.js";

useStorage(null);

let server: TestServer | null = null;
afterEach(async () => {
  monitor.close();
  await sleep(30);
  await server?.close();
  server = null;
});

async function setup() {
  server = await startServer();
  monitor.init({ key: "k", baseUrl: server.url, autoCapture: false });
  return server;
}

describe("React ErrorBoundary", () => {
  it("captura no componentDidCatch, mostra o fallback e reinicia", async () => {
    const s = await setup();
    const child = createElement("span", null, "ok");
    const seen: unknown[] = [];
    const b = new ErrorBoundary({ children: child, fallback: createElement("p", null, "Algo deu errado"), tags: { tela: "pedidos" }, onError: (e) => seen.push(e) });
    assert.equal(b.render(), child);
    const err = new Error("render quebrou");
    b.state = ErrorBoundary.getDerivedStateFromError(err);
    b.componentDidCatch(err, { componentStack: "\n    at Pedidos" });
    const fb = b.render();
    assert.ok(isValidElement(fb) && (fb as any).type === "p");
    assert.deepEqual(seen, [err]);
    monitor.flush();
    await s.waitFor(1, 2000);
    const [ev] = s.requests[0]!.body.events;
    assert.equal(ev.exception.message, "render quebrou");
    assert.deepEqual(ev.tags, { tela: "pedidos" });
  });

  it("fallback como função recebe o erro e o resetError", () => {
    const b = new ErrorBoundary({ fallback: ({ error }) => `falhou: ${(error as Error).message}` });
    b.state = ErrorBoundary.getDerivedStateFromError(new Error("x"));
    assert.equal(b.render(), "falhou: x");
    assert.equal(new ErrorBoundary({}).render(), null);
  });
});

describe("Vue vueErrorHandler", () => {
  it("captura e encadeia o handler anterior", async () => {
    const s = await setup();
    const calls: unknown[][] = [];
    const handler = vueErrorHandler((err, inst, info) => calls.push([err, inst, info]));
    const err = new Error("vue quebrou");
    handler(err, null, "render function");
    assert.deepEqual(calls, [[err, null, "render function"]]);
    monitor.flush();
    await s.waitFor(1, 2000);
    const [ev] = s.requests[0]!.body.events;
    assert.equal(ev.exception.message, "vue quebrou");
    assert.equal(ev.tags["vue.info"], "render function");
  });

  it("sem handler anterior, o erro continua no console", () => {
    const orig = console.error;
    const logged: unknown[] = [];
    console.error = (e: unknown) => logged.push(e);
    try {
      const err = new Error("y");
      vueErrorHandler()(err, null, "");
      assert.deepEqual(logged, [err]);
    } finally {
      console.error = orig;
    }
  });
});
