import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';

const pool = createPool();
await migrate(pool, () => undefined);
const app = await buildApp(pool, { logger: true });
await app.listen({ port: config.port, host: config.host });
if (!config.setupToken && config.host !== '127.0.0.1' && config.host !== 'localhost') {
  app.log.warn('SETUP_TOKEN is not set while listening on a non-loopback address. Set it before first-run setup.');
}
