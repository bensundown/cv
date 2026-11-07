import { describe, expect, it } from 'vitest';
import { matchSpecLibrary, RELATIONSHIP_LIBRARY, SPEC_KEY_MAP, SPEC_LIBRARY } from '../src/index.js';

describe('spec library', () => {
  const ids = (name: string) => matchSpecLibrary(name).map((e) => e.id);
  it('matches exact models only (never a Pro for a base model)', () => {
    expect(ids('NOVASTAR VX1000')).toEqual(['novastar-vx1000']);
    expect(ids('NovaStar VX1000 Pro')).toEqual([]);
    expect(ids('Novastar VX600')).toEqual(['novastar-vx600']);
    expect(ids('Novastar VX2000Pro All-in-One LED Display Controller')).toEqual(['novastar-vx2000pro']);
    expect(ids('Leyard – 2.6MM LED Panel 500mm x 500mm')).toEqual(['leyard-ln2.6']);
    expect(ids('Leyard – 3.9MM Outdoor LED Panel 500mm x 500mm')).toEqual([]);
    expect(ids('Beamz 75B Moving Head')).toEqual(['beamz-fuze75b']);
    expect(ids('Beamz 2812 Fuze Wash')).toEqual(['beamz-fuze2812']);
    expect(ids('Beamz LCB-14')).toEqual(['beamz-lcb14']);
    expect(ids('FBT MUSE210LA 2X10" + 2X1" ACTIVE LINE ARRAY')).toEqual(['fbt-muse210la']);
    expect(ids('FBT MS-F210 Flying Bar or Stakking for Muse 210LA')).toEqual([]);
    expect(ids('Beamz LCB14C')).toEqual([]);
    expect(ids('Chamsys MagicQ (MQ50) [ Lighting Console ]')).toEqual(['chamsys-mq50']);
    expect(ids('Chamsys Quick Q-20')).toEqual(['chamsys-quickq20']);
    expect(ids('AvoLights T3 Lighting Console')).toEqual(['avolites-t3']);
  });
  it('every value uses a known spec key, has a source URL and is never VERIFIED', () => {
    for (const e of SPEC_LIBRARY) {
      for (const s of e.specs) {
        expect(SPEC_KEY_MAP.has(s.key)).toBe(true);
        expect(s.url).toMatch(/^https:\/\//);
        expect(['PROVISIONAL', 'ESTIMATED']).toContain(s.status);
      }
    }
  });
  it('derived and inferred values are ESTIMATED', () => {
    const get = (id: string, key: string) => SPEC_LIBRARY.find((e) => e.id === id)!.specs.find((s) => s.key === key)!;
    expect(get('beamz-fuze75b', 'max_power_w').status).toBe('ESTIMATED');
    expect(get('novastar-vx600', 'pixels_per_port').status).toBe('ESTIMATED');
    expect(get('novastar-vx2000pro', 'pixels_per_port').status).toBe('PROVISIONAL');
    expect(get('leyard-ln2.6', 'max_power_w').status).toBe('ESTIMATED');
  });
  it('Leyard 2.6 → Novastar relationship matches the right models only', () => {
    const r = RELATIONSHIP_LIBRARY.find((x) => x.id === 'leyard26-novastar')!;
    expect(r.from.test('Leyard – 2.6MM LED Panel 500mm x 500mm')).toBe(true);
    expect(r.from.test('Leyard – 3.9MM Outdoor LED Panel 500mm x 500mm')).toBe(false);
    for (const p of ['NOVASTAR VX1000', 'Novastar VX600', 'Novastar VX2000Pro All-in-One']) expect(r.to.test(p)).toBe(true);
  });
  it('LN frames mount both Leyard 2.6 and 3.9 panels, 1 per metre of width (ESTIMATED)', () => {
    const r = RELATIONSHIP_LIBRARY.find((x) => x.id === 'leyard-ln-frames')!;
    expect(r.from.test('Leyard – 2.6MM LED Panel 500mm x 500mm')).toBe(true);
    expect(r.from.test('Leyard – 3.9MM Outdoor LED Panel 1m x 500mm')).toBe(true);
    expect(r.to.test('LN Led Screen Hanging And Stacking Frame')).toBe(true);
    expect(r.status).toBe('ESTIMATED');
  });
});
