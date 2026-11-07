/**
 * Protected object storage. Local filesystem implementation, content-addressed by SHA-256.
 * The interface matches what an S3-compatible backend needs (put/get by key), so it can be
 * swapped without touching callers. Files are only served through authenticated routes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { one, type Q } from './db.js';

export interface StoredFile {
  id: string;
  sha256: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
}

export const ALLOWED_MIME: Record<string, string[]> = {
  inventory: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.ms-excel',
    'application/octet-stream',
  ],
  plan: ['application/pdf', 'image/png', 'image/jpeg'],
  render: ['image/png'],
};

function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip'; // xlsx container
  return null;
}

/** Determine a trusted MIME type from content + extension (never trust the client header alone). */
export function detectMime(buf: Buffer, filename: string): string {
  const s = sniff(buf);
  const ext = path.extname(filename).toLowerCase();
  if (s === 'application/zip' && ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (s) return s;
  if (ext === '.csv') return 'text/csv';
  return 'application/octet-stream';
}

export async function putFile(q: Q, tenantId: string, userId: string | null, buf: Buffer, originalName: string, mime: string): Promise<StoredFile> {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const key = path.join(sha256.slice(0, 2), sha256);
  const full = path.join(config.storageDir, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf, { flag: 'w' });
  const safeName = path.basename(originalName).replace(/[^\w.\- ()]/g, '_').slice(0, 200);
  return (await one<StoredFile>(
    q,
    `INSERT INTO stored_file(tenant_id, sha256, original_name, mime_type, size_bytes, storage_key, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenantId, sha256, safeName, mime, buf.length, key, userId],
  ))!;
}

export async function readFile(f: Pick<StoredFile, 'storage_key'>): Promise<Buffer> {
  const full = path.resolve(config.storageDir, f.storage_key);
  if (!full.startsWith(config.storageDir + path.sep)) throw new Error('Invalid storage key');
  return fs.readFile(full);
}
