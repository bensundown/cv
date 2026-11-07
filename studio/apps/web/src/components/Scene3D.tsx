import type { Scene, SceneObject } from '@sn/core';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface Scene3DHandle {
  capture: () => Promise<Blob | null>;
}

/** Plan (x, y) mm, elevation z mm → three.js (x, y-up, z) metres. */
const V = (x: number, y: number, z: number) => new THREE.Vector3(x / 1000, z / 1000, -y / 1000);

/** Physical geometry comes only from the scene; materials here are display-only. */
export const Scene3D = forwardRef<Scene3DHandle, { scene: Scene; viewpoint: string; aesthetic: string | null }>(function Scene3D({ scene, viewpoint, aesthetic }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{ renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls; three: THREE.Scene } | null>(null);

  useImperativeHandle(ref, () => ({
    capture: () =>
      new Promise((res) => {
        const s = state.current;
        if (!s) return res(null);
        s.renderer.render(s.three, s.camera);
        s.renderer.domElement.toBlob((b) => res(b), 'image/png');
      }),
  }));

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const three = new THREE.Scene();
    three.background = new THREE.Color('#0A0A0B');
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.1, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    state.current = { renderer, camera, controls, three };
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(three, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      state.current = null;
    };
  }, []);

  // Rebuild content when the scene changes.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const g = new THREE.Group();
    g.name = 'content';
    const old = s.three.getObjectByName('content');
    if (old) s.three.remove(old);
    s.three.add(g);
    const gold = /gold/i.test(aesthetic ?? '');
    const accent = new THREE.Color(gold ? '#C9A24A' : '#FA2158');

    g.add(new THREE.HemisphereLight('#9AA6C8', '#202020', 1.1));
    g.add(new THREE.AmbientLight('#ffffff', 0.25));
    const ceilMm = scene.venue.ceilingHeight.value;
    const wallH = ceilMm ?? 4000;

    // Floor + walls
    const room = scene.venue.roomPolygon;
    const shape = new THREE.Shape(room.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000)));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: '#2B2B30', roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: '#202024', roughness: 0.9, transparent: ceilMm === null, opacity: ceilMm === null ? 0.35 : 1, side: THREE.DoubleSide });
    room.forEach((p, i) => {
      const q = room[(i + 1) % room.length]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(len / 1000, wallH / 1000), wallMat);
      const mid = V((p.x + q.x) / 2, (p.y + q.y) / 2, wallH / 2);
      w.position.copy(mid);
      w.rotation.y = Math.atan2(q.y - p.y, q.x - p.x);
      g.add(w);
    });
    for (const o of scene.objects.filter((x) => x.kind === 'obstacle' && x.polygon)) {
      const sh = new THREE.Shape(o.polygon!.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000)));
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: o.size.z / 1000, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: '#2A2A2E' }));
      m.rotation.x = -Math.PI / 2;
      g.add(m);
    }

    const box = (o: SceneObject, mat: THREE.Material, inset = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(o.size.x - inset, 1) / 1000, Math.max(o.size.z, 1) / 1000, Math.max(o.size.y - inset, 1) / 1000), mat);
      m.position.copy(V(o.position.x, o.position.y, o.position.z + o.size.z / 2));
      m.rotation.y = (o.rotationDeg * Math.PI) / 180;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const stage = scene.objects.find((o) => o.kind === 'stage');
    if (stage) box({ ...stage, size: { ...stage.size, z: stage.size.z - 30 } }, new THREE.MeshStandardMaterial({ color: '#0B0B0C', roughness: 0.95 }), 10);
    const deckMat = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.35, metalness: 0.1 });
    const shortMat = new THREE.MeshStandardMaterial({ color: '#B3103C', wireframe: true });
    for (const o of scene.objects.filter((x) => x.kind === 'stage_deck')) box(o, o.supply === 'SHORTFALL' ? shortMat : deckMat, 4);
    if (stage) {
      // Stage-edge accent strip (display only).
      const strip = new THREE.Mesh(new THREE.BoxGeometry(stage.size.x / 1000, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.2 }));
      const fx = stage.position.x + scene.frame.n.x * (stage.size.y / 2);
      const fy = stage.position.y + scene.frame.n.y * (stage.size.y / 2);
      strip.position.copy(V(fx, fy, stage.size.z - 10));
      strip.rotation.y = (stage.rotationDeg * Math.PI) / 180;
      g.add(strip);
    }

    // LED wall: cabinets + emissive content texture.
    const plan = scene.ledPlan;
    const cabs = scene.objects.filter((o) => o.kind === 'led_cabinet');
    if (plan && cabs.length) {
      const cv = document.createElement('canvas');
      cv.width = Math.min(2048, plan.cols * 64);
      cv.height = Math.round((cv.width * plan.rows * plan.cabinetHeightMm) / (plan.cols * plan.cabinetWidthMm));
      const ctx = cv.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 0, cv.width, cv.height);
      grad.addColorStop(0, '#050505');
      grad.addColorStop(0.5, gold ? '#3A2A08' : '#3A0716');
      grad.addColorStop(1, '#050505');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = gold ? '#E6C36A' : '#FA2158';
      ctx.font = `800 ${Math.round(cv.height * 0.16)}px "Plus Jakarta Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('YOUR CONTENT HERE', cv.width / 2, cv.height / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (let c = 1; c < plan.cols; c++) ctx.strokeRect((c * cv.width) / plan.cols, 0, 0.5, cv.height);
      for (let r = 1; r < plan.rows; r++) ctx.strokeRect(0, (r * cv.height) / plan.rows, cv.width, 0.5);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const wall = scene.objects.find((o) => o.kind === 'led_wall')!;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(wall.size.x / 1000, wall.size.z / 1000), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      const fpos = { x: wall.position.x + scene.frame.n.x * (wall.size.y / 2 + 2), y: wall.position.y + scene.frame.n.y * (wall.size.y / 2 + 2) };
      face.position.copy(V(fpos.x, fpos.y, wall.position.z + wall.size.z / 2));
      // Face the audience: plane normal = stage-frame inward normal n (works for CW and CCW rooms).
      face.rotation.y = Math.atan2(scene.frame.n.x, -scene.frame.n.y);
      g.add(face);
      const cabMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6, metalness: 0.4 });
      for (const c of cabs) box(c, c.supply === 'SHORTFALL' ? shortMat : cabMat, 2);
      const glow = new THREE.PointLight(gold ? '#E6C36A' : '#FA2158', 300, 25, 2);
      glow.position.copy(V(fpos.x + scene.frame.n.x * 1500, fpos.y + scene.frame.n.y * 1500, wall.position.z + wall.size.z / 2));
      g.add(glow);
    }

    // Lighting fixtures (positions from the scene) + display-only beam cones.
    const fixtures = scene.objects.filter((o) => o.kind === 'light_fixture');
    if (fixtures.length) {
      const f = scene.frame;
      const local = (lx: number, ly: number, z: number) => V(f.origin.x + f.u.x * lx + f.n.x * ly, f.origin.y + f.u.y * lx + f.n.y * ly, z);
      const dramatic = scene.lightingPlan?.look === 'dramatic';
      const bodyMat = new THREE.MeshStandardMaterial({ color: '#18181B', roughness: 0.5, metalness: 0.6 });
      const beamColor = new THREE.Color(gold ? '#FFD9A0' : dramatic ? '#FA2158' : '#E8EEFF');
      const beamMat = new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: dramatic ? 0.13 : 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const down = new THREE.Vector3(0, -1, 0);
      fixtures.forEach((o, i) => {
        box(o, bodyMat);
        const lx = Number(o.meta?.lx ?? 0);
        const ly = Number(o.meta?.ly ?? 0);
        const top = o.position.z + o.size.z;
        const from = local(lx, ly, top);
        const to =
          o.meta?.group === 'upstage'
            ? dramatic
              ? local(lx * 2.6 + (i % 2 ? 2500 : -2500), ly + 7000, top + 11000)
              : local(lx * 1.4, ly + 14000, top + 6500)
            : local(lx * 0.5, ly - 2500, top + 1500);
        const dir = to.clone().sub(from);
        const len = Math.min(dir.length(), 18);
        const cone = new THREE.ConeGeometry(o.meta?.group === 'upstage' ? (dramatic ? 0.35 : 0.9) : 1.4, len, 24, 1, true);
        cone.translate(0, -len / 2, 0);
        const beam = new THREE.Mesh(cone, beamMat);
        beam.position.copy(from);
        beam.quaternion.setFromUnitVectors(down, dir.normalize());
        g.add(beam);
      });
    }

    // Stairs & rails (display: stairs as a block, rails as a thin bar at handrail height).
    const stairMat = new THREE.MeshStandardMaterial({ color: '#1B1B1E', roughness: 0.6 });
    const railMat = new THREE.MeshStandardMaterial({ color: '#9A9AA0', metalness: 0.8, roughness: 0.3 });
    for (const o of scene.objects.filter((x) => x.kind === 'stage_accessory')) {
      if (o.meta?.type === 'rail') box({ ...o, position: { ...o.position, z: o.position.z + 950 }, size: { ...o.size, z: 50 } }, railMat);
      else box(o, stairMat);
    }

    // Loudspeakers & stage box (physical boxes are placeholders where dimensions are unknown).
    const cabMatA = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.8 });
    for (const o of scene.objects.filter((x) => x.kind === 'speaker' || x.kind === 'audio_device')) box(o, cabMatA, 10);

    // FOH & tables
    const foh = scene.objects.find((o) => o.kind === 'foh');
    if (foh) box(foh, new THREE.MeshStandardMaterial({ color: '#1C2440', roughness: 0.7 }));
    const cloth = new THREE.MeshStandardMaterial({ color: '#EDEDED', roughness: 0.8 });
    const centre = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6 });
    for (const t of scene.objects.filter((o) => o.kind === 'table')) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(t.size.x / 2000, t.size.x / 2000, t.size.z / 1000, 32), cloth);
      m.position.copy(V(t.position.x, t.position.y, t.size.z / 2));
      m.receiveShadow = true;
      g.add(m);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.25, 12), centre);
      c.position.copy(V(t.position.x, t.position.y, t.size.z + 125));
      g.add(c);
    }

    // Low-level house lighting over the audience (display only).
    const rb = room.reduce((a, p) => ({ minX: Math.min(a.minX, p.x), maxX: Math.max(a.maxX, p.x), minY: Math.min(a.minY, p.y), maxY: Math.max(a.maxY, p.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    for (const fx of [0.3, 0.7]) for (const fy of [0.3, 0.7]) {
      const h = new THREE.PointLight('#FFD9A0', 350, 30, 2);
      h.position.copy(V(rb.minX + (rb.maxX - rb.minX) * fx, rb.minY + (rb.maxY - rb.minY) * fy, wallH * 0.9));
      g.add(h);
    }
    // Indicative stage lighting (display only; lighting design is not generated yet).
    if (stage) {
      for (const k of [-0.35, 0, 0.35]) {
        const sp = new THREE.SpotLight(gold ? '#FFE2A8' : '#FFFFFF', 2500, 45, Math.PI / 7, 0.5, 2);
        const px = stage.position.x + scene.frame.u.x * stage.size.x * k + scene.frame.n.x * 9000;
        const py = stage.position.y + scene.frame.u.y * stage.size.x * k + scene.frame.n.y * 9000;
        sp.position.copy(V(px, py, Math.min(wallH - 300, 7000)));
        sp.target.position.copy(V(stage.position.x + scene.frame.u.x * stage.size.x * k, stage.position.y + scene.frame.u.y * stage.size.x * k, stage.size.z));
        sp.castShadow = true;
        g.add(sp, sp.target);
      }
      const wash = new THREE.PointLight(accent, 400, 30, 2);
      wash.position.copy(V(stage.position.x, stage.position.y, wallH * 0.8));
      g.add(wash);
    }
  }, [scene, aesthetic]);

  // Camera viewpoint.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const vp = scene.viewpoints.find((v) => v.id === viewpoint) ?? scene.viewpoints[0];
    if (!vp) return;
    s.camera.position.copy(V(vp.eye.x, vp.eye.y, vp.eye.z));
    s.controls.target.copy(V(vp.target.x, vp.target.y, vp.target.z));
    s.controls.update();
  }, [scene, viewpoint]);

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />;
});
