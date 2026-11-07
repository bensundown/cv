export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

async function handle<T>(r: Response): Promise<T> {
  if (r.ok) {
    const ct = r.headers.get('content-type') ?? '';
    return (ct.includes('application/json') ? r.json() : r.text()) as Promise<T>;
  }
  let msg = `${r.status} ${r.statusText}`;
  let detail: unknown;
  try {
    const j = await r.json();
    msg = j.error ?? msg;
    detail = j.detail;
  } catch {
    /* not json */
  }
  throw new ApiError(r.status, msg, detail);
}

const H = { 'X-SN-Request': '1' };

export const api = {
  get: <T>(url: string) => fetch(`/api${url}`, { credentials: 'same-origin' }).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(`/api${url}`, { method: 'POST', credentials: 'same-origin', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  put: <T>(url: string, body: unknown) =>
    fetch(`/api${url}`, { method: 'PUT', credentials: 'same-origin', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  patch: <T>(url: string, body: unknown) =>
    fetch(`/api${url}`, { method: 'PATCH', credentials: 'same-origin', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  del: <T>(url: string) => fetch(`/api${url}`, { method: 'DELETE', credentials: 'same-origin', headers: H }).then((r) => handle<T>(r)),
  upload: <T>(url: string, file: Blob, filename: string, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', file, filename);
    return fetch(`/api${url}`, { method: 'POST', credentials: 'same-origin', headers: H, body: fd }).then((r) => handle<T>(r));
  },
};

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'inventory_manager' | 'designer' | 'technical_reviewer' | 'viewer';
}

const PERMS: Record<string, Me['role'][]> = {
  'inventory.import': ['admin', 'inventory_manager'],
  'inventory.confirm_qty': ['admin', 'inventory_manager'],
  'equipment.edit': ['admin', 'inventory_manager', 'technical_reviewer'],
  'equipment.verify': ['admin', 'technical_reviewer'],
  'venue.edit': ['admin', 'designer', 'technical_reviewer'],
  'project.edit': ['admin', 'designer', 'technical_reviewer'],
  'project.approve': ['admin', 'technical_reviewer'],
  'users.manage': ['admin'],
};
/** UI hint only — the server enforces permissions. */
export const can = (me: Me | null, p: string) => !!me && (PERMS[p]?.includes(me.role) ?? false);
