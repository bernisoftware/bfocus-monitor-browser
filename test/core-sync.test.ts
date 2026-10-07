/**
 * src/core.ts é CÓPIA do núcleo do widget (widget/src/monitor/core.ts, a fonte única do código de
 * captura do navegador). No monorepo, esta suíte falha se a cópia divergir — rode
 * `npm run sync:core`. No espelho público (sem o widget), pula.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const WIDGET_CORE = new URL("../../../widget/src/monitor/core.ts", import.meta.url);
const COPY = new URL("../src/core.ts", import.meta.url);
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("núcleo", () => {
  it("src/core.ts é igual a widget/src/monitor/core.ts", { skip: !existsSync(WIDGET_CORE) && "espelho público: sem o widget" }, () => {
    assert.equal(readFileSync(COPY, "utf8"), readFileSync(WIDGET_CORE, "utf8"), "cópia divergente: rode `npm run sync:core`");
  });

  it("SDK_VERSION do núcleo == versão do package.json", () => {
    const m = /export const SDK_VERSION = '([^']+)'/.exec(readFileSync(COPY, "utf8"));
    assert.equal(m?.[1], PKG.version);
  });
});
