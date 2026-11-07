import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { ZodError } from 'zod';
import { csrfGuard, HttpError, loadSessionUser, SESSION_COOKIE } from './auth.js';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { equipmentRoutes } from './routes/equipment.js';
import { inventoryRoutes } from './routes/inventory.js';
import { projectRoutes } from './routes/projects.js';
import { venueRoutes } from './routes/venues.js';

export async function buildApp(pool: pg.Pool, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024, trustProxy: false });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });
  await app.register(rateLimit, { global: false });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req: FastifyRequest) => {
    req.user = await loadSessionUser(pool, req.cookies[SESSION_COOKIE]);
  });
  app.addHook('onRequest', (req, reply, done) => (req.url.startsWith('/api/') ? csrfGuard(req, reply, done) : done()));
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, detail: err.detail });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', detail: err.issues });
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  await app.register(async (api) => {
    await authRoutes(api, pool);
    await inventoryRoutes(api, pool);
    await equipmentRoutes(api, pool);
    await venueRoutes(api, pool);
    await projectRoutes(api, pool);
  }, { prefix: '/api' });

  app.get('/healthz', async () => ({ ok: true }));

  if (config.webDist && fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html', path.resolve(config.webDist!))));
  }
  return app;
}
