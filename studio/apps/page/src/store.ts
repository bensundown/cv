/**
 * Storage for the page edition. Uses the artifact database when the page runs inside Claude
 * (kept across devices and republishes), otherwise the browser's own storage.
 */
type Json = Record<string, unknown>;
interface DocSnap { id: string; exists: boolean; data(): Json | undefined }
interface DocRef { get(): Promise<DocSnap>; set(d: Json): Promise<void>; delete(): Promise<void> }
interface Coll { get(): Promise<{ docs: DocSnap[] }> }
interface Db { doc(path: string): DocRef; collection(path: string): Coll }
interface ClaudeHost { use(name: string): Promise<unknown> }

export const claudeHost = (): ClaudeHost | null => (window as unknown as { claude?: ClaudeHost }).claude ?? null;

export async function useCapability<T>(name: string): Promise<T | null> {
  const c = claudeHost();
  if (!c) return null;
  try {
    return (await c.use(name)) as T | null;
  } catch {
    return null;
  }
}

export interface Store {
  kind: 'cloud' | 'browser' | 'memory';
  get<T>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  del(path: string): Promise<void>;
  list<T>(collection: string): Promise<{ id: string; data: T }[]>;
}

const LS = 'sn-studio:';
function browserStore(): Store {
  const mem = new Map<string, string>();
  let ls: Storage | null = null;
  try {
    ls = window.localStorage;
    ls.setItem(LS + 'probe', '1');
  } catch {
    ls = null;
  }
  const read = (k: string) => (ls ? ls.getItem(LS + k) : mem.get(k) ?? null);
  const write = (k: string, v: string | null) => {
    try {
      if (v === null) (ls ? ls.removeItem(LS + k) : mem.delete(k));
      else ls ? ls.setItem(LS + k, v) : mem.set(k, v);
    } catch {
      if (v !== null) mem.set(k, v);
    }
  };
  const keys = () => (ls ? Object.keys(ls).filter((k) => k.startsWith(LS)).map((k) => k.slice(LS.length)) : [...mem.keys()]);
  return {
    kind: ls ? 'browser' : 'memory',
    async get<T>(p: string) {
      const v = read(p);
      return v ? (JSON.parse(v) as T) : null;
    },
    async set(p, v) {
      write(p, JSON.stringify(v));
    },
    async del(p) {
      write(p, null);
    },
    async list<T>(c: string) {
      return keys()
        .filter((k) => k.startsWith(c + '/') && k.split('/').length === 2)
        .map((k) => ({ id: k.split('/')[1]!, data: JSON.parse(read(k)!) as T }));
    },
  };
}

function cloudStore(db: Db): Store {
  // Values are wrapped so arrays and primitives can be stored as documents.
  return {
    kind: 'cloud',
    async get<T>(p: string) {
      const s = await db.doc(p).get();
      return s.exists ? ((s.data()?.v ?? null) as T | null) : null;
    },
    async set(p, v) {
      await db.doc(p).set({ v: JSON.parse(JSON.stringify(v)) });
    },
    async del(p) {
      await db.doc(p).delete();
    },
    async list<T>(c: string) {
      const q = await db.collection(c).get();
      return q.docs.filter((d) => d.exists).map((d) => ({ id: d.id, data: d.data()?.v as T }));
    },
  };
}

export async function openStore(): Promise<Store> {
  const db = await Promise.race([useCapability<Db>('db'), new Promise<null>((r) => setTimeout(() => r(null), 10000))]);
  if (db) {
    try {
      await db.doc('settings/main').get();
      return cloudStore(db);
    } catch {
      /* fall back */
    }
  }
  return browserStore();
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
