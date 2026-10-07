// Copia o núcleo do navegador do widget (a FONTE ÚNICA, widget/src/monitor/core.ts) para
// src/core.ts. A cópia existe porque o espelho público recebe só monitor/browser; no monorepo,
// test/core-sync.test.ts FALHA se a cópia divergir do arquivo do widget.
//   npm run sync:core
import { copyFileSync, existsSync } from "node:fs";

const source = new URL("../../../widget/src/monitor/core.ts", import.meta.url);
const target = new URL("../src/core.ts", import.meta.url);

if (!existsSync(source)) {
  console.error("✗ widget/src/monitor/core.ts não encontrado (rode no monorepo).");
  process.exit(1);
}
copyFileSync(source, target);
console.log("✓ src/core.ts atualizado a partir do widget");
