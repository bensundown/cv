/**
 * AI help through the viewer's own Claude account (artifact `sample` capability):
 *  - venue research (rooms, dimensions, ceiling heights) with the basis for each figure;
 *  - turning free-text requests into design operations the deterministic engine applies.
 * Every researched figure keeps its confidence and basis so the design shows what is unverified.
 */
import type { DesignOp, DesignParams } from '@sn/core';
import { useCapability } from './store';

type SampleFn = ((input: unknown, opts?: object) => Promise<{ text: string }>) & { json<T>(input: unknown, opts?: object): Promise<T> };

let samplePromise: Promise<SampleFn | null> | null = null;
export const getSample = () => (samplePromise ??= useCapability<SampleFn>('sample'));

export interface ResearchedRoom {
  name: string;
  lengthM: number | null;
  widthM: number | null;
  ceilingM: number | null;
  areaM2: number | null;
  banquet: number | null;
  theatre: number | null;
  confidence: 'documented' | 'approximate' | 'unknown';
  basis: string;
}
export interface VenueResearch {
  venue: string;
  location: string;
  summary: string;
  rooms: ResearchedRoom[];
  notes: string[];
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

export async function researchVenue(query: string, guests: number | null, onText?: (t: string) => void): Promise<VenueResearch> {
  const sample = await getSample();
  if (!sample) throw new Error('Venue research needs this page to be open in Claude (it asks Claude using your account). Enter the room size by hand instead.');
  const prompt = `You are a venue researcher for Sound Ninja, an AV, staging and LED production company in South Africa.
Research this venue: "${query}".${guests ? ` The event has about ${guests} guests.` : ''}
List the function rooms, halls or ballrooms an event production company would use there, most likely first${guests ? ' (rooms that fit the guest count first)' : ''}.
For each room give its length and width in metres, ceiling height in metres, floor area in m², banquet and theatre capacity, using published venue fact sheets, conference brochures, or well-known figures.
Be strict about confidence:
- "documented": you recall a published figure for this exact room.
- "approximate": derived from area or capacity, or from memory you are unsure of.
- "unknown": you do not know; use null for the numbers.
Never present a guess as documented. In "basis", say where each figure comes from (for example "venue fact sheet: 1 200 m², 4.5 m ceiling" or "estimated from 600 banquet capacity at ~1.5 m² per guest").
If you only know the area, estimate length and width with a typical 3:2 ratio and mark it "approximate".
Reply with only JSON in this shape:
{"venue":"","location":"","summary":"one sentence","rooms":[{"name":"","lengthM":0,"widthM":0,"ceilingM":0,"areaM2":0,"banquet":0,"theatre":0,"confidence":"documented|approximate|unknown","basis":""}],"notes":["things to check on a site visit"]}`;
  const r = await sample.json<Partial<VenueResearch>>(prompt, { modelTier: 'complex', onText: onText ? ({ text }: { text: string }) => onText(text) : undefined });
  const rooms = (Array.isArray(r.rooms) ? r.rooms : []).map((x): ResearchedRoom => {
    const conf = x?.confidence === 'documented' || x?.confidence === 'approximate' ? x.confidence : 'unknown';
    return { name: String(x?.name ?? 'Main room'), lengthM: n(x?.lengthM), widthM: n(x?.widthM), ceilingM: n(x?.ceilingM), areaM2: n(x?.areaM2), banquet: n(x?.banquet), theatre: n(x?.theatre), confidence: conf, basis: String(x?.basis ?? '') };
  });
  return { venue: String(r.venue ?? query), location: String(r.location ?? ''), summary: String(r.summary ?? ''), rooms, notes: Array.isArray(r.notes) ? r.notes.map(String) : [] };
}

const PATHS = `stage.widthMm, stage.depthMm, stage.heightMm (null = engine picks), stage.upstageClearanceMm, stage.offsetAlongWallMm, stage.stairs (0-4), stage.edgeProtection (bool),
led.enabled (bool), led.widthMm, led.heightMm, led.bottomAboveStageMm, led.setbackFromStageRearMm,
foh.position ('auto'|'middle'|'back'), foh.widthMm, foh.depthMm,
seating.style ('rounds'|'none'), seating.seatsPerTable, seating.tableDiameterMm, seating.pitchMm, seating.frontClearanceMm,
lighting.enabled (bool), lighting.look ('standard'|'dramatic'), lighting.movingHeads (int|null), lighting.stageWashes (int|null),
audio.enabled (bool), audio.system ('auto'|'line_array'|'point_source'), audio.boxesPerSide (int|null), audio.subsPerSide (int|null), audio.wirelessHandheld (int), audio.wirelessHeadset (int),
guests (int), eventType (string), aesthetic (string), mode ('concept'|'technical'), stageWall (1-based wall number of the room the stage backs onto)`;

export interface AiCommand {
  ops: DesignOp[];
  reply: string;
  viewpoint?: string;
}

export async function aiCommand(text: string, params: DesignParams, context: string): Promise<AiCommand> {
  const sample = await getSample();
  if (!sample) throw new Error('offline');
  const current = {
    stage: params.stage,
    led: params.led,
    foh: params.foh,
    seating: params.seating,
    lighting: params.lighting,
    audio: params.audio,
    guests: params.guests,
    eventType: params.eventType,
    aesthetic: params.aesthetic,
    mode: params.mode,
  };
  const prompt = `You control the Sound Ninja event design engine. All lengths are millimetres. The engine computes all geometry, counts and checks; you only set parameters.
Settable paths:
${PATHS}
Current parameters: ${JSON.stringify(current)}
Context: ${context}
The user says: "${text}"
Turn the request into parameter changes. Use "set" for absolute values and "add" with "delta" for relative changes of numbers. If the user wants to look from somewhere in 3D, set "viewpoint" to one of overview, front-tables, foh, rear. If nothing can be set, reply helpfully with no ops.
Reply with only JSON: {"ops":[{"op":"set","path":"stage.widthMm","value":12000},{"op":"add","path":"led.widthMm","delta":2000}],"reply":"one or two sentences telling the user what changed","viewpoint":null}`;
  const r = await sample.json<{ ops?: { op: string; path: string; value?: unknown; delta?: number }[]; reply?: string; viewpoint?: string | null }>(prompt, { modelTier: 'default', cache: false });
  const ops: DesignOp[] = [];
  for (const o of r.ops ?? []) {
    if (!o || typeof o.path !== 'string') continue;
    if (o.op === 'add' && typeof o.delta === 'number') ops.push({ op: 'add', path: o.path, delta: o.delta, note: `User via AI: “${text}”` });
    else if (o.op === 'set') ops.push({ op: 'set', path: o.path, value: o.value ?? null, note: `User via AI: “${text}”` });
  }
  return { ops, reply: String(r.reply ?? 'Done.'), ...(r.viewpoint ? { viewpoint: r.viewpoint } : {}) };
}
