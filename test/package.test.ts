/** O pacote construído: ESM e CJS com tipos, subpaths, zero dependências e a versão travada. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import * as esm from "@bfocus/monitor";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const RELEASE = new URL("../../release.json", import.meta.url);
const require = createRequire(import.meta.url);

const RUNTIME_EXPORTS = [
  "SDK_NAME",
  "VERSION",
  "addBreadcrumb",
  "captureException",
  "captureMessage",
  "close",
  "flush",
  "init",
  "parseStack",
  "setTag",
  "setUser",
];

describe("pacote", () => {
  it("VERSION == package.json; sdk.name do contrato", () => {
    assert.equal(esm.VERSION, PKG.version);
    assert.equal(esm.SDK_NAME, "bfocus-monitor-browser");
  });

  it("versão igual à de monitor/release.json (no monorepo)", { skip: !existsSync(RELEASE) && "espelho público" }, () => {
    assert.equal(JSON.parse(readFileSync(RELEASE, "utf8")).version, PKG.version);
  });

  it("ESM e CJS expõem a mesma API; subpaths react e vue", () => {
    assert.deepEqual(Object.keys(esm).sort(), RUNTIME_EXPORTS);
    const cjs = require("@bfocus/monitor");
    assert.deepEqual(Object.keys(cjs).filter((k) => k !== "__esModule" && k !== "default").sort(), RUNTIME_EXPORTS);
    assert.equal(typeof require("@bfocus/monitor/react").ErrorBoundary, "function");
    assert.equal(typeof require("@bfocus/monitor/vue").vueErrorHandler, "function");
  });

  it("o index não importa React nem Vue (React só no subpath)", () => {
    for (const dir of ["esm", "cjs"]) {
      for (const f of ["index", "client", "core", "vue"]) {
        const src = readFileSync(new URL(`../dist/${dir}/${f}.js`, import.meta.url), "utf8");
        assert.doesNotMatch(src, /from ['"]react['"]|require\(['"]react['"]\)|['"]vue['"]/, `${dir}/${f}.js`);
      }
    }
    const r = spawnSync(process.execPath, ["-e", "require('@bfocus/monitor'); console.log(Object.keys(require.cache).some((k) => /node_modules[\\\\/]react[\\\\/]/.test(k)))"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.stdout.trim(), "false");
  });

  it("o snippet do painel roda: import * as monitor, init, setUser (no init só o sinal de vida)", () => {
    const code = `import * as monitor from '@bfocus/monitor';
const calls = []; globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(null, { status: 204 }) };
Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
const userHash = 'v2.1.abc';
monitor.init({ key: 'bf_mon_x', release: '1.4.2', environment: 'production' });
monitor.setUser({ externalId: 'u-123', userHash }, { externalId: 'cliente-9' });
console.log(calls.join(' '));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "https://api.bfocus.com.br/api/v1/monitor/heartbeat?key=bf_mon_x");
  });

  it("dist/cjs é CommonJS e há .d.ts para tudo", () => {
    assert.deepEqual(JSON.parse(readFileSync(new URL("../dist/cjs/package.json", import.meta.url), "utf8")), { type: "commonjs" });
    for (const dir of ["esm", "cjs"]) for (const f of ["index", "react", "vue"]) {
      assert.ok(existsSync(new URL(`../dist/${dir}/${f}.d.ts`, import.meta.url)), `${dir}/${f}.d.ts`);
    }
  });

  it("manifesto: exports, files, MIT, react peer opcional e zero dependências de runtime", () => {
    assert.equal(PKG.name, "@bfocus/monitor");
    assert.equal(PKG.license, "MIT");
    assert.deepEqual(PKG.files, ["dist", "README.md", "LICENSE"]);
    assert.deepEqual(Object.keys(PKG.exports).sort(), [".", "./package.json", "./react", "./vue"]);
    assert.equal(Object.keys(PKG.dependencies ?? {}).length, 0);
    assert.deepEqual(PKG.peerDependenciesMeta, { react: { optional: true } });
    assert.ok(existsSync(new URL("../LICENSE", import.meta.url)) && existsSync(new URL("../README.md", import.meta.url)));
  });
});
