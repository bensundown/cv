import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { audit } from '../audit.js';
import { createSession, destroySession, hashPassword, HttpError, requirePerm, ROLES, SESSION_COOKIE, verifyPassword } from '../auth.js';
import { config } from '../config.js';
import { many, one, tx } from '../db.js';

const Password = z.string().min(12, 'Password must be at least 12 characters').max(200);

export async function authRoutes(app: FastifyInstance, pool: pg.Pool) {
  const setCookie = (reply: import('fastify').FastifyReply, token: string, expires: Date) =>
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/', expires });

  app.get('/setup/status', async () => {
    const n = (await one<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM app_user'))!.n;
    return { needsSetup: n === 0, requiresToken: !!config.setupToken };
  });

  /** First-run: create the tenant and first admin. Disabled once any user exists. */
  app.post('/setup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ email: z.string().email(), name: z.string().min(1).max(100), password: Password, organisation: z.string().min(1).max(100).default('Sound Ninja'), setupToken: z.string().optional() }).parse(req.body);
    if (config.setupToken && b.setupToken !== config.setupToken) throw new HttpError(403, 'Invalid setup token');
    const user = await tx(pool, async (c) => {
      await c.query('LOCK TABLE app_user IN EXCLUSIVE MODE');
      const n = (await one<{ n: number }>(c, 'SELECT count(*)::int AS n FROM app_user'))!.n;
      if (n > 0) throw new HttpError(409, 'Setup already completed');
      const t = (await one<{ id: string }>(c, 'INSERT INTO tenant(name) VALUES ($1) RETURNING id', [b.organisation]))!;
      const u = (await one<{ id: string }>(c, `INSERT INTO app_user(tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,'admin') RETURNING id`, [t.id, b.email.toLowerCase(), b.name, await hashPassword(b.password)]))!;
      await c.query('INSERT INTO audit_event(tenant_id, user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5)', [t.id, u.id, 'setup.completed', 'tenant', t.id]);
      return u;
    });
    const s = await createSession(pool, user.id);
    setCookie(reply, s.token, s.expires);
    return { ok: true };
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ email: z.string().email(), password: z.string().max(200) }).parse(req.body);
    const u = await one<{ id: string; password_hash: string; disabled: boolean; tenant_id: string }>(pool, 'SELECT id, password_hash, disabled, tenant_id FROM app_user WHERE email=$1', [b.email.toLowerCase()]);
    const ok = u && !u.disabled && (await verifyPassword(b.password, u.password_hash));
    if (!ok) {
      await pool.query('INSERT INTO audit_event(tenant_id, action, entity_type, detail) VALUES ($1,$2,$3,$4)', [u?.tenant_id ?? null, 'auth.login.failed', 'app_user', JSON.stringify({ email: b.email.toLowerCase() })]);
      throw new HttpError(401, 'Invalid email or password');
    }
    const s = await createSession(pool, u.id);
    setCookie(reply, s.token, s.expires);
    await pool.query('INSERT INTO audit_event(tenant_id, user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5)', [u.tenant_id, u.id, 'auth.login', 'app_user', u.id]);
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) await destroySession(pool, t);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    if (!req.user) throw new HttpError(401, 'Not signed in');
    return req.user;
  });

  app.get('/users', async (req) => {
    const u = requirePerm(req, 'users.manage');
    return many(pool, 'SELECT id, email, name, role, disabled, created_at FROM app_user WHERE tenant_id=$1 ORDER BY created_at', [u.tenantId]);
  });

  app.post('/users', async (req) => {
    const u = requirePerm(req, 'users.manage');
    const b = z.object({ email: z.string().email(), name: z.string().min(1).max(100), password: Password, role: z.enum(ROLES as [string, ...string[]]) }).parse(req.body);
    const row = await one<{ id: string }>(pool, 'INSERT INTO app_user(tenant_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING RETURNING id', [u.tenantId, b.email.toLowerCase(), b.name, await hashPassword(b.password), b.role]);
    if (!row) throw new HttpError(409, 'A user with that email exists');
    await audit(pool, u, 'user.created', 'app_user', row.id, { email: b.email, role: b.role });
    return row;
  });

  app.get('/audit', async (req) => {
    const u = requirePerm(req, 'audit.read');
    const q = z.object({ entityType: z.string().optional(), entityId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return many(
      pool,
      `SELECT a.id, a.at, a.action, a.entity_type, a.entity_id, a.detail, u.email FROM audit_event a LEFT JOIN app_user u ON u.id=a.user_id
       WHERE a.tenant_id=$1 AND ($2::text IS NULL OR a.entity_type=$2) AND ($3::text IS NULL OR a.entity_id=$3) ORDER BY a.id DESC LIMIT $4`,
      [u.tenantId, q.entityType ?? null, q.entityId ?? null, q.limit],
    );
  });
}
