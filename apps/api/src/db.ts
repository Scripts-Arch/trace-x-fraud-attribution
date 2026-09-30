/**
 * Minimal JSON-file-backed persistence (zero native deps, demo-reliable).
 * Tables are kept in memory and flushed to disk on mutation.
 */
import * as fs from "fs";
import * as path from "path";

interface DbShape {
  users: unknown[];
  cases: unknown[];
  traces: unknown[];
  alerts: unknown[];
  ncrpQueue: unknown[];
  sahyogOutbox: unknown[];
  batches: unknown[];
}

const EMPTY: DbShape = {
  users: [], cases: [], traces: [], alerts: [], ncrpQueue: [], sahyogOutbox: [],
  batches: [],
};

export class Store {
  private data: DbShape;
  private file: string;

  constructor(file: string) {
    this.file = file;
    this.data = this.load();
  }

  private load(): DbShape {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, "utf-8"));
        return { ...structuredClone(EMPTY), ...raw };
      }
    } catch {
      /* fall through to fresh db */
    }
    return structuredClone(EMPTY);
  }

  get tables(): DbShape {
    return this.data;
  }

  flush(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}
