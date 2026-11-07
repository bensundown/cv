import type { ReactNode } from 'react';

export function Badge({ s, title }: { s: string | null | undefined; title?: string }) {
  const v = s ?? 'UNKNOWN';
  return (
    <span className={`badge st-${v}`} title={title}>
      {v.replace(/_/g, ' ')}
    </span>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="alert error" role="alert">{msg}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="small muted" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export const STATUS_OPTIONS = ['VERIFIED', 'PROVISIONAL', 'ESTIMATED', 'UNKNOWN'] as const;

export const m = (mm: number | null | undefined, d = 2) => (mm === null || mm === undefined ? '—' : `${(mm / 1000).toFixed(d)} m`);
