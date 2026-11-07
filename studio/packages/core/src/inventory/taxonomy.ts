/**
 * Engineering taxonomy and product-name hints.
 *
 * The original product group is always preserved; the engineering category is
 * an additional classification. Category guesses and dimensions parsed from a
 * product name are HINTS (status ESTIMATED, source name_parse) — never
 * manufacturer specifications. Users correct categories on the equipment page.
 *
 * Rules are ORDERED: specific accessories and non-equipment are matched before
 * broad families (e.g. "AluStage Deck Clamp" is an accessory, not a deck;
 * "AluStage 2m QUAD 290 Truss" is truss, not staging; "32 Amp Cable" is power
 * cable, not an amplifier).
 */
import type { Confidence } from '../provenance.js';

export const ENGINEERING_CATEGORIES = [
  'LED_PANEL',
  'LED_PROCESSOR',
  'LED_MOUNTING',
  'STAGE_DECK',
  'STAGE_DECK_SHAPED', // curved / triangle / circle platforms — never used for rectangular tiling
  'STAGE_LEG',
  'STAGE_ACCESSORY',
  'SCENIC',
  'TRUSS',
  'TRUSS_CONNECTOR',
  'TRUSS_ACCESSORY',
  'RIGGING_HARDWARE',
  'SPEAKER_LINE_ARRAY',
  'SPEAKER_POINT_SOURCE',
  'SUBWOOFER',
  'SPEAKER_MOUNTING',
  'AMPLIFIER',
  'MIXING_CONSOLE',
  'STAGE_BOX',
  'MICROPHONE',
  'AUDIO_ACCESSORY',
  'LIGHTING_FIXTURE',
  'LIGHTING_CONSOLE',
  'DMX_DISTRIBUTION',
  'SPECIAL_EFFECTS',
  'VIDEO_CAMERA',
  'VIDEO_SWITCHER',
  'VIDEO_SIGNAL',
  'DISPLAY',
  'COMPUTER_NETWORK',
  'POWER_DISTRIBUTION',
  'CABLE',
  'STAND',
  'COVER',
  'PACKAGE', // bundles of other items — never allocated as equipment
  'SERVICE_OR_CONSUMABLE', // certificates, consumables, labour, internet — not equipment
  'OTHER',
] as const;
export type EngineeringCategory = (typeof ENGINEERING_CATEGORIES)[number];

/** Categories that are not physical, allocatable equipment. */
export const NON_EQUIPMENT_CATEGORIES: EngineeringCategory[] = ['PACKAGE', 'SERVICE_OR_CONSUMABLE'];

interface Rule {
  cat: EngineeringCategory;
  re: RegExp;
  /** Only applies when the product group matches. */
  group?: RegExp;
}

// Order matters: first match wins.
const RULES: Rule[] = [
  // Not equipment
  { cat: 'PACKAGE', re: /\bpackage\b|\bpax\b/i },
  { cat: 'PACKAGE', re: /./, group: /^packages?$/i },
  { cat: 'SERVICE_OR_CONSUMABLE', re: /\bcoc\b|consumables?|comsumables|\binternet\b|afrihost|peplink internet|\bpackers?\b|labou?r|transport|crew\b|batter(y|ies)\b(?!.*(par|lcb|light))/i },
  { cat: 'OTHER', re: /\bpodium\b(?! mic)|lectern|clicker|presenter/i },
  { cat: 'DISPLAY', re: /\b\d+ ?(inch|'|"|″) tv\b|\btv with\b/i },
  // Covers & soft goods before the things they cover
  { cat: 'COVER', re: /\bsocks\b|\bcovers?\b|cowel|cowl/i },
  // Special effects before lighting (foggers often contain "LED")
  { cat: 'SPECIAL_EFFECTS', re: /haze[rs]?|\bhaze\b|fogg?er|smoke machine|snow machine|confetti|sparklers?|cold spark|powershot|co2 jet|bubble machine/i },
  // LED: accessories in the LED group / with LED words before panels
  { cat: 'LED_MOUNTING', re: /(\bled\b|leyard).*(frame|feet|foot|legs?|bracing|clamps?|fly ?bar|flying bar|hanging bar|ground ?stack|bumper)/i },
  { cat: 'LED_MOUNTING', re: /frame|feet|foot|legs?|bracing|clamps?|fly ?bar|pipes?/i, group: /led/i },
  { cat: 'CABLE', re: /\b(cat|powercon|power|link|links|cable)\b/i, group: /led cabl/i },
  { cat: 'LED_PROCESSOR', re: /\bnovastar\b|\bvx ?\d{3,4}|mctrl|led (display )?(processor|controller)|sending card|nova ?pro/i },
  { cat: 'LED_PANEL', re: /\bleyard\b.*(panel|cabinet|\d(\.\d)?\s?mm)|\bled (panel|cabinet|tile)s?\b|\bp\d(\.\d)?\b.*(panel|cabinet)/i },
  // Truss before staging (AluStage makes both)
  { cat: 'TRUSS_ACCESSORY', re: /base ?plates?|top ?plates?/i },
  { cat: 'TRUSS_CONNECTOR', re: /grenade|r-?clips?|truss pins?|\bov ?pins?\b|\bpins?\b|spigots?|couplers?|half coupler|truss clamps?/i },
  { cat: 'TRUSS', re: /\btruss\b|quad ?290|\bov ?40\b|\bf3[1-4]\b|\bh30\b|corner ?block|ground support/i },
  { cat: 'RIGGING_HARDWARE', re: /chain ?hoist|\bhoist|\bmotor\b|shackles?|span ?sets?|round ?slings?|wire rope|steel ?wire/i },
  // Staging
  { cat: 'STAGE_ACCESSORY', re: /stairs?|steps?\b|handrails?|guard ?rails?|\bclamps?\b|level(l)?ers?|skirt|dance ?floor/i, group: /stag|dance|facing/i },
  { cat: 'STAGE_ACCESSORY', re: /stage (stairs|steps)|handrails?|deck (clamp|level)|leg clamp|dance ?floor/i },
  { cat: 'SCENIC', re: /facings?|theat(er|re) flats?|\bflats?\b|abs .*sheet|backdrop|drape/i },
  { cat: 'STAGE_DECK_SHAPED', re: /(curved|hexa|triangle|triangular|circle|circular|round|quarter).*(deck|platform|stage)|(deck|platform|stage).*(curved|hexa|triangle|circle)/i },
  { cat: 'STAGE_LEG', re: /\blegs?\b/i },
  { cat: 'STAGE_DECK', re: /\bdecks?\b|stage platform|\briser\b|alustage\s*\d+(?:[.,]\d+)?\s*m?\s*x\s*\d/i },
  // Power before audio ("32 Amp Cable" is not an amplifier)
  { cat: 'POWER_DISTRIBUTION', re: /\bdistro\b|distribution board|generator|\bups\b|\d+ ?kva\b/i },
  { cat: 'CABLE', re: /\b\d+ ?a(mp)?s?\b.*(cable|cabeling|cabling)|(cable|cabeling|cabling).*\b\d+ ?amps?\b|\d+ ?amp ?cable/i },
  // Video & computers (HDMI splitter is video, not DMX)
  { cat: 'VIDEO_SIGNAL', re: /\bhdmi\b|\bsdi\b|converter|extender|\bext\b|distribution amp|scaler|decimator|fib(re|er)|capture( card)?/i },
  { cat: 'VIDEO_SWITCHER', re: /switcher|\batem\b|vision mixer|roland v-?\d/i },
  { cat: 'VIDEO_CAMERA', re: /camera|camcorders?|\bptz\b|\ba7 ?i?v\b|\bfx[369]\b/i },
  // Lighting control & data
  { cat: 'DMX_DISTRIBUTION', re: /\bdmx\b|art-?net|\bsacn\b|e-?node|netron|datastream|dmx splitter/i },
  { cat: 'LIGHTING_CONSOLE', re: /lighting (console|controller|desk)|grand ?ma|avolights|avolites|chamsys|magicq|onyx (lighting|nx touch)|dot2|sweetlight|quick ?q|universe controller/i },
  { cat: 'COMPUTER_NETWORK', re: /laptop|\bmac( studio| mini)?\b|\bpc\b(?! audio)|server|keyboard|mouse|vmix|unifi|mikrotik|microtik|\bswitch\b|gateway|router|network switch|\bnas\b/i },
  // Audio
  { cat: 'STAGE_BOX', re: /stage ?box|\bdx ?16[48]\b|\bar ?24\d\d\b|\bab ?16[48]\b|\bdt ?16[48]\b|\bdx ?32\b/i },
  { cat: 'MIXING_CONSOLE', re: /\bmixer\b|mixing (desk|console)|sound desk|\bsq-? ?\d|\bqu-? ?\d|\bcq-? ?\d|\bzed ?i?-?\d|xenyx|livepad|dlive|avantis|\bx32\b|\bm32\b/i },
  { cat: 'SPEAKER_MOUNTING', re: /fly(ing)? ?bar|stacking frames?|stakking|pole mounts?|rigging frame|speaker bracket/i },
  { cat: 'STAND', re: /\bstands?\b|wind ?up/i },
  { cat: 'SUBWOOFER', re: /\bsubs?\b|subwoofer|\d18 ?s[ab]?\b|218sa|subline/i },
  { cat: 'SPEAKER_LINE_ARRAY', re: /line ?array|\b210 ?la\b|muse ?210/i },
  { cat: 'AUDIO_ACCESSORY', re: /\bdi\b|di box|sound ?card|audio interface|in-ear|\biem\b|earamp|intercom|dj controller|ddj-|solidcom/i },
  { cat: 'MICROPHONE', re: /\bmics?\b|microphone|\bsm5[78]\b|beta ?5[78]|lapel|headsets?|head set|\bme2\b|body ?packs?|handheld|ew-?d|countryman|podium mic|drum mic/i },
  { cat: 'AMPLIFIER', re: /amplifier|power amp\b/i },
  { cat: 'SPEAKER_POINT_SOURCE', re: /speaker|wedge|\bvha ?\d|horizon|full ?range|x-?pro ?\d|x ?lite ?1\d\d|column array|vertus|top\/monitor|monitor speaker/i },
  // Displays (TVs, projectors, screens, computer monitors) — after speakers' "monitor speaker"
  { cat: 'DISPLAY', re: /\btv\b|television|projector|projection screen|screen grandview|\d+ ?(inch|"|'|″)(\s|$)|\b\d+ ?inch\b|\bmonitor\b/i },
  // Lighting fixtures
  { cat: 'LIGHTING_FIXTURE', re: /moving ?heads?|\bspot\b|\bwash\b|\bbeam\b|\bpar\b|par ?can|parcan|profile|strobe|blinder|fresnel|uplight|flood ?light|led ?bar|\blcb\b|pixel ?bar|gig ?bar|led tube|batten/i },
  { cat: 'LIGHTING_FIXTURE', re: /./, group: /^lights$/i },
  // Cables (generic)
  { cat: 'CABLE', re: /cable|cabling|\blead\b|loom|\bxlr\b|\bcat ?5e?\b|\bcat ?6\b|\bcat (black|grey|gray|yellow|blue|red)\b|powercons?|trucons?|kettle|multiplug|cable track|reel|jack to jack|pc audio|\bpower\b/i },
  // Group fallbacks for remaining items
  { cat: 'MICROPHONE', re: /./, group: /^microphones?$/i },
  { cat: 'VIDEO_CAMERA', re: /./, group: /^cameras?$/i },
  { cat: 'SPEAKER_POINT_SOURCE', re: /./, group: /^pa speakers?$/i },
  { cat: 'COMPUTER_NETWORK', re: /./, group: /^(computers?|network)$/i },
];

export function guessCategory(product: string, productGroup: string | null): { category: EngineeringCategory; status: Confidence; note: string } {
  const g = productGroup ?? '';
  for (const r of RULES) {
    if (r.group && !r.group.test(g)) continue;
    if (r.re.test(product)) {
      return { category: r.cat, status: 'ESTIMATED', note: r.group ? `Matched within product group “${g}” (${r.cat})` : `Keyword match on product name (${r.cat})` };
    }
  }
  return { category: 'OTHER', status: 'UNKNOWN', note: 'No category rule matched — set the category on the equipment page' };
}

export const KNOWN_MANUFACTURERS = [
  'Leyard', 'Novastar', 'FBT', 'Allen & Heath', 'AluStage', 'StagePlus', 'Prolyte', 'Global Truss', 'Chauvet', 'Robe', 'Martin', 'Clay Paky',
  'Elation', 'ADJ', 'Beamz', 'Avolites', 'ChamSys', 'MA Lighting', 'Onyx', 'Antari', 'MagicFX', 'Shure', 'Sennheiser', 'Samson', 'Audix',
  'Klark Teknik', 'DBX', 'Focusrite', 'Behringer', 'RCF', 'Hollyland', 'Pioneer', 'Blackmagic', 'Roland', 'RGBlink', 'Pixelhue', 'Sony',
  'Panasonic', 'Epson', 'Da-Lite', 'Elite', 'Samsung', 'Hisense', 'JVC', 'Lexuco', 'Dell', 'Asus', 'Apple', 'HP', 'MSI', 'Ubiquiti', 'Lectrix',
  'Roxton', 'Yamaha', 'Midas', 'QSC', 'JBL', 'd&b', 'L-Acoustics', 'Absen', 'ROE',
] as const;

const MANUFACTURER_ALIASES: [RegExp, string][] = [
  [/\ba ?& ?h\b|allen\s*(&|and)\s*heath/i, 'Allen & Heath'],
  [/\bbeamz(pro)?\b/i, 'Beamz'],
  [/chauvet(dj)?/i, 'Chauvet'],
  [/\bgrand ?ma\b|\bdot2\b/i, 'MA Lighting'],
  [/\bunifi\b/i, 'Ubiquiti'],
  [/\brgb ?link\b/i, 'RGBlink'],
  [/\bmac (studio|mini)\b/i, 'Apple'],
  [/\bstage ?plus\b/i, 'StagePlus'],
];

export function guessManufacturer(product: string): string | null {
  for (const [re, m] of MANUFACTURER_ALIASES) if (re.test(product)) return m;
  const p = ` ${product.toLowerCase().replace(/[–—-]/g, ' ')} `;
  for (const m of KNOWN_MANUFACTURERS) {
    if (p.includes(` ${m.toLowerCase()} `)) return m;
  }
  return null;
}

export interface NameHints {
  pixelPitchMm?: number;
  cabinetWidthMm?: number;
  cabinetHeightMm?: number;
  deckWidthMm?: number;
  deckDepthMm?: number;
  legHeightMm?: number;
  /** Adjustable legs, e.g. "400-600mm". */
  legHeightMinMm?: number;
  legHeightMaxMm?: number;
  trussLengthMm?: number;
  outdoor?: boolean;
  /** True when a size pair had no units and metres were inferred. */
  unitInferred?: boolean;
}

const num = (s: string) => Number(s.replace(',', '.'));
const toMm = (v: number, unit: string) => (unit === 'm' ? v * 1000 : unit === 'cm' ? v * 10 : v);

/** "500mm x 500mm", "1m x 500mm", "2M X 1M", "500 x 500mm", "1x 0.5" (unitless → metres if both ≤ 10). */
export function parseSizePair(s: string): { a: number; b: number; inferred: boolean } | null {
  const m = s.replace(/×/g, 'x').match(/(\d+(?:[.,]\d+)?)\s?(mm|cm|m)?\s?x\s?(\d+(?:[.,]\d+)?)\s?(mm|cm|m)?(?![a-z])/i);
  if (!m) return null;
  const u1 = m[2]?.toLowerCase();
  const u2 = m[4]?.toLowerCase();
  const a = num(m[1]!);
  const b = num(m[3]!);
  if (!u1 && !u2) {
    if (a <= 10 && b <= 10) return { a: a * 1000, b: b * 1000, inferred: true };
    if (a >= 100 && b >= 100) return { a, b, inferred: true }; // e.g. "500 x 500" → mm
    return null;
  }
  return { a: toMm(a, u1 ?? u2!), b: toMm(b, u2 ?? u1!), inferred: false };
}

/**
 * Extract dimensional hints from a product name. These are never treated as
 * better than ESTIMATED until a user confirms them against the physical item
 * or the manufacturer datasheet.
 */
export function parseNameHints(product: string, category: EngineeringCategory): NameHints {
  const h: NameHints = {};
  const s = product.replace(/×/g, 'x');
  const pair = parseSizePair(s);
  if (category === 'LED_PANEL') {
    const pitch = s.match(/\bp\s?(\d+(?:[.,]\d+)?)\b/i) ?? s.match(/(\d+(?:[.,]\d+)?)\s?mm\b(?!\s*x)/i);
    if (pitch && num(pitch[1]!) < 30) h.pixelPitchMm = num(pitch[1]!);
    if (pair) {
      h.cabinetWidthMm = pair.a;
      h.cabinetHeightMm = pair.b;
      if (pair.inferred) h.unitInferred = true;
    }
    if (/outdoor/i.test(s)) h.outdoor = true;
  }
  if (category === 'STAGE_DECK' && pair) {
    h.deckWidthMm = Math.max(pair.a, pair.b);
    h.deckDepthMm = Math.min(pair.a, pair.b);
    if (pair.inferred) h.unitInferred = true;
  }
  if (category === 'STAGE_LEG') {
    const range = s.match(/(\d+(?:[.,]\d+)?)\s?(mm|cm|m)?\s?(?:-|–|to)\s?(\d+(?:[.,]\d+)?)\s?(mm|cm|m)\b/i);
    if (range) {
      const u2 = range[4]!.toLowerCase();
      h.legHeightMinMm = toMm(num(range[1]!), range[2]?.toLowerCase() ?? u2);
      h.legHeightMaxMm = toMm(num(range[3]!), u2);
    } else {
      const single = s.match(/(\d+(?:[.,]\d+)?)\s?(mm|cm|m)\b/i);
      if (single) h.legHeightMm = toMm(num(single[1]!), single[2]!.toLowerCase());
    }
  }
  if (category === 'TRUSS') {
    const single = s.match(/(\d+(?:[.,]\d+)?)\s?m\b/i);
    if (single) h.trussLengthMm = num(single[1]!) * 1000;
  }
  return h;
}
