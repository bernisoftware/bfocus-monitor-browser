/** A API do pacote sobre o núcleo: singleton, init, captura automática na página simulada. */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as monitor from "@bfocus/monitor";
import { sleep, startServer, type TestServer } from "./helpers/server.js";
import { memoryStorage, useStorage } from "./helpers/storage.js";

useStorage(null);

let server: TestServer | null = null;
const g = globalThis as any;

afterEach(async () => {
  monitor.close();
  await sleep(30);
  delete g.window;
  delete g.history;
  delete g.location;
  await server?.close();
  server = null;
});

describe("init", () => {
  it("chave vazia é erro de argumento imediato", () => {
    assert.throws(() => monitor.init({ key: "" }), TypeError);
    assert.throws(() => monitor.init(undefined as any), TypeError);
  });

  it("antes do init nada lança", () => {
    monitor.captureException(new Error("x"));
    monitor.captureMessage("x");
    monitor.setUser({ externalId: "u" });
    monitor.setTag("a", "b");
    monitor.addBreadcrumb("a", "b");
    monitor.flush();
    monitor.close();
  });

  it("no init só o sinal de vida; ambiente padrão production; sdk do pacote; init de novo troca a configuração", async () => {
    server = await startServer();
    monitor.init({ key: "bf_mon_a", release: "1.0.0", baseUrl: server.url, autoCapture: false });
    await sleep(50);
    assert.equal(server.requests.length, 0);
    monitor.init({ key: "bf_mon_b", release: "2.0.0", baseUrl: server.url, autoCapture: false });
    monitor.setTag("modulo", "fiscal");
    monitor.captureException(new TypeError("boom"));
    await server.waitFor(1, 2000);
    const [req] = server.requests;
    assert.equal(req!.query.key, "bf_mon_b");
    const [ev] = req!.body.events;
    assert.equal(ev.environment, "production");
    assert.equal(ev.release, "2.0.0");
    assert.deepEqual(ev.sdk, { name: "bfocus-monitor-browser", version: monitor.VERSION });
    assert.deepEqual(ev.tags, { modulo: "fiscal" });
  });
});

describe("captura automática (página simulada)", () => {
  it("error e unhandledrejection da página viram evento; close para de escutar", async () => {
    server = await startServer();
    const win = new EventTarget() as any;
    g.window = win;
    g.history = { pushState() {} };
    g.location = { origin: "https://app.cliente.com", href: "https://app.cliente.com/pedidos?token=x", pathname: "/pedidos" };
    monitor.init({ key: "k", baseUrl: server.url });

    const err = new RangeError("fora do intervalo");
    err.stack = "RangeError: fora do intervalo\n    at calc (https://app.cliente.com/assets/index.js:10:5)";
    const e1 = Object.assign(new Event("error"), { error: err, message: err.message });
    win.dispatchEvent(e1);
    const e2 = Object.assign(new Event("unhandledrejection"), { reason: "texto" });
    win.dispatchEvent(e2);
    monitor.flush();
    await server.waitFor(1, 2000);
    const evs = server.requests.flatMap((r) => r.body.events);
    assert.deepEqual(evs.map((e: any) => e.exception.type), ["RangeError", "UnhandledRejection"]);
    assert.equal(evs[0].exception.frames[0].inApp, true);
    assert.ok(evs[0].url.startsWith("https://app.cliente.com/pedidos"));

    monitor.close();
    server.requests.length = 0;
    win.dispatchEvent(Object.assign(new Event("error"), { error: new Error("depois"), message: "depois" }));
    await sleep(1200);
    assert.equal(server.requests.length, 0);
  });

  it("url sem query string (BRIEF §4)", async () => {
    server = await startServer();
    g.window = new EventTarget();
    g.history = { pushState() {} };
    g.location = { origin: "https://app.cliente.com", href: "https://app.cliente.com/p?token=x", pathname: "/p" };
    monitor.init({ key: "k", baseUrl: server.url });
    monitor.captureException(new Error("q"));
    monitor.flush();
    await server.waitFor(1, 2000);
    assert.equal(server.requests[0]!.body.events[0].url, "https://app.cliente.com/p");
  });
});

describe("sinal de vida", () => {
  it("1 no init; no máximo 1 a cada 30 min por aparelho; instance guardado", async () => {
    server = await startServer();
    const store = memoryStorage();
    useStorage(store);
    try {
      monitor.init({ key: "k1", release: "1.0.0", baseUrl: server.url, autoCapture: false });
      await server.waitForHeartbeats(1, 2000);
      monitor.init({ key: "k1", release: "1.0.0", baseUrl: server.url, autoCapture: false });
      monitor.flush();
      await sleep(150);
      assert.equal(server.heartbeats.length, 1, "segundo init em menos de 30 min não manda");
      const instance = server.heartbeats[0]!.body.instance;
      assert.ok(typeof instance === "string" && instance.length >= 8);
      assert.equal(store.getItem("bf_mon_device"), instance);
      store.setItem("bf_mon_hb_k1", String(Date.now() - 31 * 60 * 1000));
      monitor.init({ key: "k1", baseUrl: server.url, autoCapture: false });
      await server.waitForHeartbeats(2, 2000);
      assert.equal(server.heartbeats[1]!.body.instance, instance, "mesmo aparelho, mesmo instance");
    } finally {
      useStorage(null);
    }
  });

  it("sem armazenamento: 1 por init", async () => {
    server = await startServer();
    monitor.init({ key: "k", baseUrl: server.url, autoCapture: false });
    monitor.init({ key: "k", baseUrl: server.url, autoCapture: false });
    await server.waitForHeartbeats(2, 2000);
    assert.equal(server.heartbeats.length, 2);
  });

  it("401 no sinal de vida desliga o monitor até o próximo init", async () => {
    server = await startServer();
    server.heartbeatReplies.push({ status: 401, body: { error: "MONITOR_KEY_INVALID" } });
    monitor.init({ key: "k", baseUrl: server.url, autoCapture: false });
    await server.waitForHeartbeats(1, 2000);
    await sleep(50);
    monitor.captureException(new Error("depois do 401"));
    monitor.flush();
    await sleep(200);
    assert.equal(server.requests.length, 0);
    monitor.init({ key: "k", baseUrl: server.url, autoCapture: false });
    monitor.captureException(new Error("novo init"));
    monitor.flush();
    await server.waitFor(1, 2000);
    assert.equal(server.requests.length, 1);
  });
});
