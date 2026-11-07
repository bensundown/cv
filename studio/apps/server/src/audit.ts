import type { SessionUser } from './auth.js';
import type { Q } from './db.js';

export async function audit(q: Q, user: SessionUser | null, action: string, entityType: string, entityId: string | null, detail: Record<string, unknown> = {}) {
  await q.query('INSERT INTO audit_event(tenant_id, user_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5,$6)', [
    user?.tenantId ?? null,
    user?.id ?? null,
    action,
    entityType,
    entityId,
    JSON.stringify(detail),
  ]);
}
