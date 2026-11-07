/**
 * Embedded PostgreSQL (PGlite, Postgres compiled to WebAssembly) behind the subset of the
 * node-postgres Pool API the server uses: query(), connect() → client.query()/release(), end().
 *
 * Used by the offline desktop app so no database server has to be installed. PGlite is a single
 * connection, so a mutex serialises access: a client from connect() holds the lock until release(),
 * which keeps transactions (BEGIN … COMMIT) from interleaving between concurrent requests.
 */
import { PGlite, types } from '@electric-sql/pglite';
import fs from 'node:fs';
import type pg from 'pg';

class Mutex {
  private chain: Promise<void> = Promise.resolve();
  lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.chain;
    this.chain = prev.then(() => next);
    return prev.then(() => release);
  }
}

type Result = { rows: unknown[]; rowCount: number };

/** gen_random_uuid() is core since PG13; PGlite has no pgcrypto, so this statement is skipped. */
const adapt = (sql: string) => sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/gi, '-- (pgcrypto not needed: gen_random_uuid is core)');

export async function createPglitePool(dataDir: string): Promise<pg.Pool> {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create({
    dataDir,
    parsers: {
      [types.NUMERIC]: (v: string) => (v === null ? null : Number(v)),
      [types.INT8]: (v: string) => (v === null ? null : Number(v)),
    },
  });
  const mutex = new Mutex();
  const run = async (text: string, params?: unknown[]): Promise<Result> => {
    if (params && params.length) {
      const r = await db.query(adapt(text), params as never[]);
      return { rows: r.rows as unknown[], rowCount: r.affectedRows ?? r.rows.length };
    }
    const all = await db.exec(adapt(text));
    const last = all.at(-1);
    return { rows: (last?.rows ?? []) as unknown[], rowCount: last?.affectedRows ?? last?.rows.length ?? 0 };
  };
  const pool = {
    async query(text: string, params?: unknown[]) {
      const release = await mutex.lock();
      try {
        return await run(text, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await mutex.lock();
      let released = false;
      return {
        query: (text: string, params?: unknown[]) => run(text, params),
        release: () => {
          if (!released) {
            released = true;
            release();
          }
        },
      };
    },
    async end() {
      await db.close();
    },
  };
  return pool as unknown as pg.Pool;
}
