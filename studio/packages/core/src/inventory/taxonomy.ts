/**
 * Engineering taxonomy and product-name hints.
 *
 * The original product group is always preserved; the engineering category is
 * an additional classification. Category guesses and dimensions parsed from a
 * product name are HINTS (status ESTIMATED, source name_parse) — never
 * manufacturer specifications.
 */
import type { Confidence } from '../provenance.js';

export const ENGINEERING_CATEGORIES = [
  'LED_PANEL',
  'LED_PROCESSOR',
  'LED_MOUNTING',
  'STAGE_DECK',
  'STAGE_LEG',
  'STAGE_ACCESSORY',
  'TRUSS',
  'TRUSS_CONNECTOR',
  'RIGGING_HARDWARE',
  'SPEAKER_LINE_ARRAY',
  'SPEAKER_POINT_SOURCE',
  'SUBWOOFER',
  'AMPLIFIER',
  'MIXING_CONSOLE',
  'STAGE_BOX',
  'MICROPHONE',
  'LIGHTING_FIXTURE',
  'LIGHTING_CONSOLE',
  'DMX_DISTRIBUTION',
  'VIDEO_CAMERA',
  'VIDEO_SWITCHER',
  'VIDEO_SIGNAL',
  'DISPLAY',
  'POWER_DISTRIBUTION',
  'CABLE',
  'OTHER',
] as const;
export type EngineeringCategory = (typeof ENGINEERING_CATEGORIES)[number];

interface Rule {
  cat: EngineeringCategory;
  any: RegExp;
}
// Order matters: more specific rules first.
const RULES: Rule[] = [
  { cat: 'LED_PROCESSOR', any: /\b(novastar|vx\s?\d{3,4}|mctrl|led processor|video processor|sending card|nova\s?pro)\b/i },
  { cat: 'LED_MOUNTING', any: /\b(led).*(fly ?bar|flying bar|hanging bar|ground ?stack|bumper|support)|\b(fly ?bar|ground ?stack)\b/i },
  { cat: 'LED_PANEL', any: /\b(led (panel|cabinet|tile|screen)|leyard|\bp\d(\.\d)?\b|\d(\.\d)?\s?mm .*(panel|cabinet|indoor|outdoor))/i },
  { cat: 'STAGE_LEG', any: /\b(stage )?legs?\b|\bleg\b/i },
  { cat: 'STAGE_DECK', any: /\b(deck|stage platform|riser|alustage)\b/i },
  { cat: 'STAGE_ACCESSORY', any: /\b(stair|steps|handrail|skirt|stage clamp|guard ?rail)\b/i },
  { cat: 'TRUSS_CONNECTOR', any: /\b(half coupler|coupler|spigot|conical|fork|pin|truss clamp)\b/i },
  { cat: 'TRUSS', any: /\b(truss|quad ?290|ov ?40|f34|h30|ground support|corner block)\b/i },
  { cat: 'RIGGING_HARDWARE', any: /\b(chain ?hoist|motor|shackle|steel|span ?set|round ?sling|wire rope)\b/i },
  { cat: 'SUBWOOFER', any: /\b(sub|subwoofer|218sa|\d18s)\b/i },
  { cat: 'SPEAKER_LINE_ARRAY', any: /\b(line ?array|210la|\bla\b|muse 210)\b/i },
  { cat: 'AMPLIFIER', any: /\b(amp|amplifier)\b/i },
  { cat: 'STAGE_BOX', any: /\b(stage ?box|dx168|ar2412|ab168|dt168|dx32)\b/i },
  { cat: 'MIXING_CONSOLE', any: /\b(console|mixer|desk|sq-?\d|dlive|qu-?\d|avantis|x32|m32)\b/i },
  { cat: 'SPEAKER_POINT_SOURCE', any: /\b(speaker|monitor|wedge|vha|horizon|top|full ?range)\b/i },
  { cat: 'MICROPHONE', any: /\b(mic|microphone|sm58|beta ?58|lapel|headset|wireless)\b/i },
  { cat: 'LIGHTING_CONSOLE', any: /\b(grandma|grand ?ma|avolites|chamsys|lighting console|light desk)\b/i },
  { cat: 'DMX_DISTRIBUTION', any: /\b(dmx|art-?net|splitter|node|sacn)\b/i },
  { cat: 'LIGHTING_FIXTURE', any: /\b(moving head|spot|wash|beam|par|profile|strobe|blinder|fresnel|uplighter|fixture|led bar|pixel bar)\b/i },
  { cat: 'VIDEO_CAMERA', any: /\b(camera|camcorder|ptz)\b/i },
  { cat: 'VIDEO_SWITCHER', any: /\b(switcher|atem|vision mixer|roland v-?\d)\b/i },
  { cat: 'VIDEO_SIGNAL', any: /\b(hdmi|sdi|converter|extender|distribution amp|scaler|decimator|fibre|fiber)\b/i },
  { cat: 'DISPLAY', any: /\b(tv|television|display|monitor screen|projector|projection screen)\b/i },
  { cat: 'POWER_DISTRIBUTION', any: /\b(distro|power distribution|generator|ups|16a|32a|63a|cee|powercon)\b/i },
  { cat: 'CABLE', any: /\b(cable|lead|loom|xlr|cat ?6|cat ?5|extension)\b/i },
];

export function guessCategory(product: string, productGroup: string | null): { category: EngineeringCategory; status: Confidence; note: string } {
  const text = `${product} ${productGroup ?? ''}`;
  // Product name first; group as fallback context.
  for (const r of RULES) if (r.any.test(product)) return { category: r.cat, status: 'ESTIMATED', note: `Keyword match on product name (${r.cat})` };
  for (const r of RULES) if (r.any.test(text)) return { category: r.cat, status: 'ESTIMATED', note: `Keyword match on product group (${r.cat})` };
  return { category: 'OTHER', status: 'UNKNOWN', note: 'No category keyword matched' };
}

export const KNOWN_MANUFACTURERS = [
  'Leyard',
  'Novastar',
  'FBT',
  'Allen & Heath',
  'AluStage',
  'Prolyte',
  'Global Truss',
  'Chauvet',
  'Robe',
  'Martin',
  'Clay Paky',
  'Elation',
  'ADJ',
  'Avolites',
  'ChamSys',
  'MA Lighting',
  'Shure',
  'Sennheiser',
  'Blackmagic',
  'Roland',
  'Sony',
  'Panasonic',
  'Yamaha',
  'Behringer',
  'Midas',
  'QSC',
  'JBL',
  'd&b',
  'L-Acoustics',
  'Pioneer',
  'Absen',
  'ROE',
] as const;

export function guessManufacturer(product: string): string | null {
  const p = product.toLowerCase();
  for (const m of KNOWN_MANUFACTURERS) {
    const k = m.toLowerCase();
    if (p.startsWith(k) || p.includes(` ${k} `) || p.includes(`${k} `)) return m;
  }
  if (/\ba&h\b|allen\s*&?\s*heath/i.test(product)) return 'Allen & Heath';
  return null;
}

export interface NameHints {
  pixelPitchMm?: number;
  cabinetWidthMm?: number;
  cabinetHeightMm?: number;
  deckWidthMm?: number;
  deckDepthMm?: number;
  legHeightMm?: number;
  trussLengthMm?: number;
  outdoor?: boolean;
}

const num = (s: string) => Number(s.replace(',', '.'));

/**
 * Extract dimensional hints from a product name. These are never treated as
 * better than PROVISIONAL (and are reported as ESTIMATED until a user confirms
 * them against the physical item or the manufacturer datasheet).
 */
export function parseNameHints(product: string, category: EngineeringCategory): NameHints {
  const h: NameHints = {};
  const s = product.replace(/×/g, 'x');
  const pitch = s.match(/\bp\s?(\d+(?:[.,]\d+)?)\b/i) ?? s.match(/(\d+(?:[.,]\d+)?)\s?mm\b(?!\s*x)/i);
  const mmPair = s.match(/(\d{2,4})\s?(?:mm)?\s?x\s?(\d{2,4})\s?mm?/i);
  const mPair = s.match(/(\d+(?:[.,]\d+)?)\s?m\s?x\s?(\d+(?:[.,]\d+)?)\s?m\b/i);
  const pairMm = mPair ? [num(mPair[1]!) * 1000, num(mPair[2]!) * 1000] : mmPair ? [num(mmPair[1]!), num(mmPair[2]!)] : null;

  if (category === 'LED_PANEL') {
    if (pitch && num(pitch[1]!) < 30) h.pixelPitchMm = num(pitch[1]!);
    if (pairMm) {
      h.cabinetWidthMm = pairMm[0];
      h.cabinetHeightMm = pairMm[1];
    }
    if (/outdoor/i.test(s)) h.outdoor = true;
  }
  if (category === 'STAGE_DECK' && pairMm) {
    h.deckWidthMm = Math.max(pairMm[0]!, pairMm[1]!);
    h.deckDepthMm = Math.min(pairMm[0]!, pairMm[1]!);
  }
  if (category === 'STAGE_LEG') {
    const single = s.match(/(\d+(?:[.,]\d+)?)\s?(mm|cm|m)\b/i);
    if (single) {
      const v = num(single[1]!);
      const unit = single[2]!.toLowerCase();
      h.legHeightMm = unit === 'm' ? v * 1000 : unit === 'cm' ? v * 10 : v;
    }
  }
  if (category === 'TRUSS') {
    const single = s.match(/(\d+(?:[.,]\d+)?)\s?m\b/i);
    if (single) h.trussLengthMm = num(single[1]!) * 1000;
  }
  return h;
}
