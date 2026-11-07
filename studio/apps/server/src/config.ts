import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://sn:sn@127.0.0.1:5432/sound_ninja',
  storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage')),
  /** When set, first-run admin setup requires this token. Always set it on any network-reachable deployment. */
  setupToken: process.env.SETUP_TOKEN ?? null,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionDays: Number(process.env.SESSION_DAYS ?? 7),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
  webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : null,
};
