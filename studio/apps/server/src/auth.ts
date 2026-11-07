import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { one, type Q } from './db.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type Role = 'admin' | 'inventory_manager' | 'designer' | 'technical_reviewer' | 'viewer';
export const ROLES: Role[] = ['admin', 'inventory_manager', 'designer', 'technical_reviewer', 'viewer'];

/** Permission → roles. Single source of truth for authorisation. */
export const PERMISSIONS = {
  'inventory.read': ['admin', 'inventory_manager', 'designer', 'technical_reviewer', 'viewer'],
  'inventory.import': ['admin', 'inventory_manager'],
  'inventory.confirm_qty': ['admin', 'inventory_manager'],
  'equipment.edit': ['admin', 'inventory_manager', 'technical_reviewer'],
  'equipment.verify': ['admin', 'technical_reviewer'],
  'venue.edit': ['admin', 'designer', 'technical_reviewer'],
  'project.read': ['admin', 'inventory_manager', 'designer', 'technical_reviewer', 'viewer'],
  'project.edit': ['admin', 'designer', 'technical_reviewer'],
  'project.approve': ['admin', 'technical_reviewer'],
  'users.manage': ['admin'],
  'audit.read': ['admin', 'technical_reviewer'],
} as const satisfies Record<string, Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export interface SessionUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, got);
}

export const SESSION_COOKIE = 'sn_session';
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function createSession(q: Q, userId: string): Promise<{ token: string; expires: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await q.query('INSERT INTO user_session(token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), userId, expires]);
  return { token, expires };
}

export async function destroySession(q: Q, token: string) {
  await q.query('DELETE FROM user_session WHERE token_hash=$1', [sha256(token)]);
}

export async function loadSessionUser(q: Q, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await one<{ id: string; tenant_id: string; email: string; name: string; role: Role }>(
    q,
    `SELECT u.id, u.tenant_id, u.email, u.name, u.role FROM user_session s JOIN app_user u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > now() AND NOT u.disabled`,
    [sha256(token)],
  );
  return row ? { id: row.id, tenantId: row.tenant_id, email: row.email, name: row.name, role: row.role } : null;
}

export function can(user: SessionUser | null, perm: Permission): boolean {
  return !!user && (PERMISSIONS[perm] as readonly Role[]).includes(user.role);
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

/** Route guard: throws 401/403. Usage: `requirePerm(req, 'inventory.import')` */
export function requirePerm(req: FastifyRequest, perm: Permission): SessionUser {
  if (!req.user) throw new HttpError(401, 'Not signed in');
  if (!can(req.user, perm)) throw new HttpError(403, `Your role (${req.user.role}) does not have permission: ${perm}`);
  return req.user;
}

/**
 * CSRF defence for cookie sessions: state-changing requests must carry a custom header
 * (cannot be set cross-origin without CORS, which is not enabled) plus SameSite=Strict cookies.
 */
export function csrfGuard(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-sn-request'] !== '1') {
    reply.code(403).send({ error: 'Missing X-SN-Request header' });
    return;
  }
  done();
}
