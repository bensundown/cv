/**
 * Minimal .xlsx reader (no dependencies): unzips with the browser's DecompressionStream and reads
 * shared strings + one worksheet into rows of cell values. Enough for inventory exports
 * (text, numbers, booleans, inline strings, formulas' cached values).
 */

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
}

function readZipDirectory(buf: ArrayBuffer): Map<string, ZipEntry> {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a valid .xlsx file (zip directory not found).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    out.set(name, { name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: ArrayBuffer, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf);
  const start = e.localOffset + 30 + dv.getUint16(e.localOffset + 26, true) + dv.getUint16(e.localOffset + 28, true);
  const data = new Uint8Array(buf, start, e.compSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error(`Unsupported compression in ${e.name}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

const xmlDoc = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const byTag = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagNameNS('*', tag));

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(buf: ArrayBuffer, preferredSheet = 'inventory'): Promise<unknown[][]> {
  const dir = readZipDirectory(buf);
  const get = async (n: string) => {
    const e = dir.get(n);
    return e ? readEntry(buf, e) : null;
  };
  const shared: string[] = [];
  const ss = await get('xl/sharedStrings.xml');
  if (ss) for (const si of byTag(xmlDoc(ss), 'si')) shared.push(byTag(si, 't').map((t) => t.textContent ?? '').join(''));

  // Pick the sheet: "Inventory" if present, else the first.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wbXml = await get('xl/workbook.xml');
  const relsXml = await get('xl/_rels/workbook.xml.rels');
  if (wbXml && relsXml) {
    const sheets = byTag(xmlDoc(wbXml), 'sheet');
    const pick = sheets.find((s) => (s.getAttribute('name') ?? '').trim().toLowerCase() === preferredSheet) ?? sheets[0];
    const rid = pick?.getAttribute('r:id') ?? pick?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = byTag(xmlDoc(relsXml), 'Relationship').find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheetXml = await get(sheetPath);
  if (!sheetXml) throw new Error('The workbook has no readable worksheet.');
  const rows: unknown[][] = [];
  for (const row of byTag(xmlDoc(sheetXml), 'row')) {
    const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
    const out: unknown[] = [];
    let next = 0;
    for (const c of byTag(row, 'c')) {
      const ref = c.getAttribute('r');
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      const t = c.getAttribute('t');
      const v = byTag(c, 'v')[0]?.textContent ?? null;
      let val: unknown = null;
      if (t === 's') val = v !== null ? shared[Number(v)] ?? null : null;
      else if (t === 'inlineStr') val = byTag(c, 't').map((x) => x.textContent ?? '').join('');
      else if (t === 'b') val = v === '1';
      else if (t === 'str' || t === 'e') val = v;
      else if (v !== null) val = Number.isFinite(Number(v)) ? Number(v) : v;
      out[ci] = val;
    }
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = null;
    rows[r] = out;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}
