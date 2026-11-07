/**
 * Rule-based brief interpretation and conversational revision commands.
 *
 * This is the deterministic baseline. An LLM interpreter (pending decision
 * D-004) will propose the same `BriefExtraction` / `DesignOp` structures; the
 * structures are validated and applied by deterministic code either way.
 */
import type { Confidence, Source } from '../provenance.js';
import { normalizeParams } from './generate.js';
import type { DesignParams } from './types.js';

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5 };
const NUM = String.raw`(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)`;
const toNum = (s: string) => WORDS[s.toLowerCase()] ?? Number(s.replace(',', '.'));
const UNIT = String.raw`\s*(mm|cm|m|metres?|meters?)?`;
const toMmU = (n: number, unit: string | undefined, dflt: 'm' | 'mm' = 'm') => {
  const u = (unit ?? dflt).toLowerCase();
  return u.startsWith('mm') ? n : u.startsWith('cm') ? n * 10 : n * 1000;
};

export interface Extracted {
  path: string; // DesignParams path
  value: unknown;
  text: string; // matched brief text (evidence)
}

export interface BriefExtraction {
  extracted: Extracted[];
  venueName: string | null;
  requests: string[]; // recognised but not yet designable (lighting, sound…)
}

const pair = (label: string) => new RegExp(String.raw`${NUM}${UNIT}\s*(?:x|×|by)\s*${NUM}${UNIT}\s*(?:${label})`, 'i');

export function parseBrief(text: string): BriefExtraction {
  const ex: Extracted[] = [];
  const t = text.replace(/\s+/g, ' ');
  const g = t.match(new RegExp(String.raw`(\d[\d\s,]*)\s*(?:guests|pax|people|delegates|attendees|persons)`, 'i'));
  if (g) ex.push({ path: 'guests', value: Number(g[1]!.replace(/[\s,]/g, '')), text: g[0] });

  const st = t.match(pair(String.raw`(?:\w+\s){0,2}stage`));
  if (st) {
    const a = toMmU(toNum(st[1]!), st[2] ?? st[4]);
    const b = toMmU(toNum(st[3]!), st[4]);
    ex.push({ path: 'stage.widthMm', value: Math.max(a, b), text: st[0] });
    ex.push({ path: 'stage.depthMm', value: Math.min(a, b), text: st[0] });
  }
  const sh = t.match(new RegExp(String.raw`stage[^.]{0,30}?${NUM}${UNIT}\s*(?:high|height|tall)`, 'i')) ?? t.match(new RegExp(String.raw`${NUM}${UNIT}\s*(?:high|height)\s*stage`, 'i'));
  if (sh) ex.push({ path: 'stage.heightMm', value: toMmU(toNum(sh[1]!), sh[2]), text: sh[0] });

  const led = t.match(pair(String.raw`(?:\w+\s){0,2}(?:led|screen|video wall)`));
  if (led) {
    ex.push({ path: 'led.widthMm', value: toMmU(toNum(led[1]!), led[2] ?? led[4]), text: led[0] });
    ex.push({ path: 'led.heightMm', value: toMmU(toNum(led[3]!), led[4]), text: led[0] });
    ex.push({ path: 'led.enabled', value: true, text: led[0] });
  } else if (/\bno (led|screen)\b/i.test(t)) ex.push({ path: 'led.enabled', value: false, text: 'no LED' });

  const evt = t.match(/\b(gala(?: dinner)?|conference|awards?(?: ceremony| evening)?|product launch|wedding|concert|festival|exhibition|year[- ]end function|banquet)\b/i);
  if (evt) ex.push({ path: 'eventType', value: evt[1]!.toLowerCase(), text: evt[0] });
  const aest = t.match(/\b([a-z]+(?:[- ]and[- ]| & )[a-z]+)\s+aesthetic\b/i) ?? t.match(/\b(\w+(?:\s\w+)?)\s+(?:aesthetic|theme|look)\b/i);
  if (aest) ex.push({ path: 'aesthetic', value: aest[1]!, text: aest[0] });
  if (/\btheatre[- ]style\b|\bcinema seating\b/i.test(t)) ex.push({ path: 'seating.style', value: 'none', text: 'theatre style (not yet supported: seating omitted)' });
  const lit = t.match(/\b(?:intelligent |moving |stage )?lighting\b/i);
  if (lit && !/\bno lighting\b/i.test(t)) ex.push({ path: 'lighting.enabled', value: true, text: lit[0] });
  const drama = t.match(/\b(dramatic|theatrical|concert[- ]style)\b/i);
  if (drama) ex.push({ path: 'lighting.look', value: 'dramatic', text: drama[0] });
  const movers = t.match(/(\d+)\s*(?:moving heads?|movers|moving lights?)/i);
  if (movers) ex.push({ path: 'lighting.movingHeads', value: Number(movers[1]), text: movers[0] });
  if (/\btechnical mode\b|\bfor construction\b/i.test(t)) ex.push({ path: 'mode', value: 'technical', text: 'technical mode' });

  const venue = t.match(/\b(?:at|in)\s+(?:the\s+)?([A-Z][\w'&-]*(?:\s+(?:[A-Z][\w'&-]*|of|and|&))*\s+(?:Convention Centre|Center|Centre|Hotel|Hall|Arena|Theatre|Stadium|Ballroom|Venue|Estate|Dome|Expo))/);
  const requests: string[] = [];
  for (const [re, label] of [
    [/\blighting\b/i, 'Lighting design'],
    [/\b(sound|audio|pa)\b/i, 'Audio / PA design'],
    [/\bfoh\b|front of house/i, 'FOH position'],
    [/\b(camera|stream|imag)\b/i, 'Video / camera'],
    [/\btruss\b|rigging/i, 'Truss / rigging'],
  ] as const)
    if (re.test(t)) requests.push(label);
  return { extracted: ex, venueName: venue ? venue[1]!.trim() : null, requests };
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] as Record<string, unknown>;
  o[parts.at(-1)!] = value;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

/** Apply extracted brief values to params, recording provenance (brief = PROVISIONAL). */
export function applyBrief(params: DesignParams, b: BriefExtraction): DesignParams {
  const next = normalizeParams(structuredClone(params));
  for (const e of b.extracted) {
    setPath(next as unknown as Record<string, unknown>, e.path, e.value);
    next.sources[e.path] = { status: 'PROVISIONAL', source: { kind: 'brief', note: `Brief: “${e.text}”` } };
  }
  return next;
}

// ---- Revision commands -----------------------------------------------------------------------

export type DesignOp = { op: 'set'; path: string; value: unknown; note: string } | { op: 'add'; path: string; delta: number; note: string };

export interface CommandResult {
  ops: DesignOp[];
  reply: string;
  viewpoint?: string;
  recognised: boolean;
}

const UNSUPPORTED: [RegExp, string][] = [
  [/moving heads?|fixtures?|lighting|dramatic|beams?|wash/i, 'I can change lighting with: “add lighting”, “remove the lighting”, “make the lighting more dramatic”, “standard lighting”, “use fewer / more moving heads”, “8 moving heads”, “4 washes”. Colours, focus, front light and truss positions are not designed yet.'],
  [/curved/i, 'Curved LED layouts are not supported yet: curving needs verified curve-capable cabinets and their connecting hardware in the relationship database.'],
  [/(three|3|several|multiple) .*(designs|options|alternatives)/i, 'Generating multiple alternative designs is not implemented yet. You can branch manually by revising from an earlier revision.'],
  [/(rental|budget|cost|price).*(\d+\s*%|reduce|lower)/i, 'Budget optimisation is not implemented yet. The schedule shows indicative rental value at listed rates only.'],
  [/speaker|sub|audio|sound|pa\b/i, 'Audio design is not generated yet (planned for Phase 3).'],
];

export function interpretCommand(text: string): CommandResult {
  const t = text.trim();
  const ops: DesignOp[] = [];
  const note = `User: “${t}”`;
  let m: RegExpMatchArray | null;

  if ((m = t.match(/view (?:from|of) (?:the )?(vip|front|foh|back|rear|overview)/i))) {
    const map: Record<string, string> = { vip: 'front-tables', front: 'front-tables', foh: 'foh', back: 'rear', rear: 'rear', overview: 'overview' };
    return { ops, reply: `Switching the 3D view to ${m[1]}.`, viewpoint: map[m[1]!.toLowerCase()], recognised: true };
  }
  const delta = (target: 'stage' | 'led') =>
    t.match(new RegExp(String.raw`(?:make |set )?(?:the )?${target === 'stage' ? 'stage' : '(?:led|screen|wall)'}[^\d]*?${NUM}${UNIT}\s*(wider|narrower|deeper|shallower|taller|higher|shorter|lower)`, 'i'));
  for (const target of ['stage', 'led'] as const) {
    if ((m = delta(target))) {
      const d = toMmU(toNum(m[1]!), m[2]);
      const dir = m[3]!.toLowerCase();
      const sign = ['narrower', 'shallower', 'shorter', 'lower'].includes(dir) ? -1 : 1;
      const axis = ['wider', 'narrower'].includes(dir) ? 'widthMm' : target === 'stage' ? (['taller', 'higher', 'lower', 'shorter'].includes(dir) ? 'heightMm' : 'depthMm') : 'heightMm';
      ops.push({ op: 'add', path: `${target}.${axis}`, delta: sign * d, note });
    }
  }
  if (!ops.length) {
    if ((m = t.match(new RegExp(String.raw`stage[^\d]*${NUM}${UNIT}\s*(?:x|×|by)\s*${NUM}${UNIT}`, 'i')))) {
      ops.push({ op: 'set', path: 'stage.widthMm', value: toMmU(toNum(m[1]!), m[2] ?? m[4]), note });
      ops.push({ op: 'set', path: 'stage.depthMm', value: toMmU(toNum(m[3]!), m[4]), note });
    }
    if ((m = t.match(new RegExp(String.raw`(?:led|screen|wall)[^\d]*${NUM}${UNIT}\s*(?:x|×|by)\s*${NUM}${UNIT}`, 'i')))) {
      ops.push({ op: 'set', path: 'led.widthMm', value: toMmU(toNum(m[1]!), m[2] ?? m[4]), note });
      ops.push({ op: 'set', path: 'led.heightMm', value: toMmU(toNum(m[3]!), m[4]), note });
      ops.push({ op: 'set', path: 'led.enabled', value: true, note });
    }
    if ((m = t.match(new RegExp(String.raw`stage (?:height )?(?:to |at |height of )?${NUM}${UNIT}\s*(?:high|height|tall)?$`, 'i'))) && /height|high|raise|lower/i.test(t)) {
      ops.push({ op: 'set', path: 'stage.heightMm', value: toMmU(toNum(m[1]!), m[2]), note });
    }
  }
  // Lighting
  const LN = String.raw`(\d+|one|two|three|four|five|six|seven|eight|nine|ten)`;
  if ((m = t.match(new RegExp(String.raw`\b(?:use |with )?${LN}?\s*(fewer|less|more)\s+(?:moving heads?|movers|moving lights?|beams?)`, 'i')))) {
    const n = m[1] ? toNum(m[1]) : 2;
    ops.push({ op: 'add', path: 'lighting.movingHeads', delta: /more/i.test(m[2]!) ? n : -n, note });
    ops.push({ op: 'set', path: 'lighting.enabled', value: true, note });
  } else if ((m = t.match(new RegExp(String.raw`\b${LN}\s*(?:moving heads?|movers|moving lights?)`, 'i')))) {
    ops.push({ op: 'set', path: 'lighting.movingHeads', value: toNum(m[1]!), note });
    ops.push({ op: 'set', path: 'lighting.enabled', value: true, note });
  }
  if ((m = t.match(new RegExp(String.raw`\b${LN}\s*(?:stage )?wash(?:es|lights?)?\b`, 'i')))) {
    ops.push({ op: 'set', path: 'lighting.stageWashes', value: toNum(m[1]!), note });
    ops.push({ op: 'set', path: 'lighting.enabled', value: true, note });
  }
  if (/\b(more dramatic|dramatic lighting|make it dramatic|concert look)\b/i.test(t)) {
    ops.push({ op: 'set', path: 'lighting.look', value: 'dramatic', note });
    ops.push({ op: 'set', path: 'lighting.enabled', value: true, note });
  }
  if (/\b(less dramatic|standard lighting|softer lighting|subtle lighting)\b/i.test(t)) ops.push({ op: 'set', path: 'lighting.look', value: 'standard', note });
  if (/\b(remove|no|without) (the )?lighting\b/i.test(t)) ops.push({ op: 'set', path: 'lighting.enabled', value: false, note });
  else if (/\badd (the )?lighting\b/i.test(t)) ops.push({ op: 'set', path: 'lighting.enabled', value: true, note });
  if ((m = t.match(/(?:move|put|place) (?:the )?foh (?:to |at |in )?(?:the )?(back|rear|middle|centre|center|default|auto)/i))) {
    const v = m[1]!.toLowerCase();
    ops.push({ op: 'set', path: 'foh.position', value: v === 'back' || v === 'rear' ? 'back' : v === 'default' || v === 'auto' ? 'auto' : 'middle', note });
  }
  if ((m = t.match(/(\d[\d\s,]*)\s*(?:guests|pax|people)/i))) ops.push({ op: 'set', path: 'guests', value: Number(m[1]!.replace(/[\s,]/g, '')), note });
  if (/\b(remove|no|delete|without) (the )?(led|screen)\b/i.test(t)) ops.push({ op: 'set', path: 'led.enabled', value: false, note });
  if (/\badd (an? )?(led|screen)\b/i.test(t)) ops.push({ op: 'set', path: 'led.enabled', value: true, note });
  if ((m = t.match(/(?:stage|put the stage) on wall (\d+)/i))) ops.push({ op: 'set', path: 'stageWall', value: Number(m[1]) - 1, note });
  if (/\btechnical mode\b/i.test(t)) ops.push({ op: 'set', path: 'mode', value: 'technical', note });
  if (/\bconcept mode\b/i.test(t)) ops.push({ op: 'set', path: 'mode', value: 'concept', note });

  if (ops.length) return { ops, reply: `Applied ${ops.length} change${ops.length > 1 ? 's' : ''}: ${ops.map(describeOp).join('; ')}.`, recognised: true };
  for (const [re, reply] of UNSUPPORTED) if (re.test(t)) return { ops, reply, recognised: false };
  return {
    ops,
    recognised: false,
    reply:
      'I didn’t recognise a change I can make yet. Supported: “make the stage 2 m wider”, “make the lighting more dramatic”, “use fewer moving heads”, “stage 12 m x 6 m”, “stage height 1 m”, “LED 10 m x 3 m”, “make the LED 1 m taller”, “move FOH to the back”, “600 guests”, “remove the LED”, “put the stage on wall 2”, “technical mode”, “show me the view from the VIP tables”.',
  };
}

export function describeOp(o: DesignOp): string {
  const fmt = (p: string, v: unknown) => (p.endsWith('Mm') && typeof v === 'number' ? `${(v / 1000).toFixed(2)} m` : String(v));
  return o.op === 'set' ? `${o.path} → ${fmt(o.path, o.value)}` : `${o.path} ${o.delta >= 0 ? '+' : '−'}${fmt(o.path, Math.abs(o.delta))}`;
}

/** Apply ops to params. `stageWall` is returned separately (it belongs to the venue binding). */
export function applyOps(params: DesignParams, ops: DesignOp[], status: Confidence = 'PROVISIONAL'): { params: DesignParams; stageWall?: number; errors: string[] } {
  const next = normalizeParams(structuredClone(params));
  const errors: string[] = [];
  let stageWall: number | undefined;
  for (const o of ops) {
    if (o.path === 'stageWall') {
      stageWall = o.op === 'set' ? (o.value as number) : undefined;
      continue;
    }
    const src: Source = { kind: 'user_entry', note: o.note };
    if (o.op === 'set') setPath(next as unknown as Record<string, unknown>, o.path, o.value);
    else {
      const cur = getPath(next, o.path);
      const base = typeof cur === 'number' ? cur : null;
      if (base === null) {
        errors.push(`${o.path} has no current value to adjust`);
        continue;
      }
      const v = base + o.delta;
      const min = o.path.startsWith('lighting.') ? 0 : 1;
      if (v < min) {
        errors.push(o.path.startsWith('lighting.') ? `${o.path} cannot go below 0 (currently ${base})` : `${o.path} would become ${v} mm`);
        continue;
      }
      setPath(next as unknown as Record<string, unknown>, o.path, v);
    }
    next.sources[o.path] = { status, source: src };
  }
  return { params: next, ...(stageWall !== undefined ? { stageWall } : {}), errors };
}
