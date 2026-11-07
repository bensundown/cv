/**
 * Offline / desktop entry point: embedded PGlite database + local file storage + the web UI,
 * served on 127.0.0.1 only. Environment must be set BEFORE this module is imported
 * (config.ts reads it at import time) — the desktop shell does that.
 */
import { buildApp } from './app.js';
import { createPglitePool } from './db-pglite.js';
import { migrate } from './migrate.js';

export interface EmbeddedOptions {
  /** Directory for the embedded database. */
  dbDir: string;
  /** 0 = any free port. */
  port?: number;
  log?: (msg: string) => void;
}

export async function startEmbedded(opts: EmbeddedOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const pool = await createPglitePool(opts.dbDir);
  const applied = await migrate(pool, (m) => opts.log?.(m));
  if (applied.length) opts.log?.(`Database ready (${applied.length} migration(s) applied)`);
  const app = await buildApp(pool, { logger: false });
  await app.listen({ port: opts.port ?? 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}
