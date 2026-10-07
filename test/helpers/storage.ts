/** localStorage em memória para os testes (o do Node 25 pede --localstorage-file e avisa). */
export function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

/** Troca o localStorage global (null = navegador sem armazenamento). */
export function useStorage(s: Storage | null): void {
  Object.defineProperty(globalThis, "localStorage", { value: s ?? undefined, configurable: true, writable: true });
}
