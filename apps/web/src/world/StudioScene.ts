import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AgentView, InvocationView, WorldSnapshot } from '@company-os/contracts';
import {
  departmentPresence,
  HQ_MAP,
  meetingSeats,
  visualIntent,
  type Anchor,
  type Furniture,
  type Room,
  type Tile,
  type VisualIntent,
} from '@company-os/world';
import { appearanceOf, bubbleFor, hash, moodOf, pastel, stateLabel, studioPath } from './studio';
import { buildCharacter, outfitColor, type Character } from './character';
import { brandIcon } from '../components/cockpit/AppIcon';
import type { CameraView, HqWorldView, Selection, WorldCallbacks } from './types';

/**
 * QG « studio » en 3D (Three.js). Projection purement visuelle du snapshot : positions, poses,
 * bulles et écrans découlent des événements backend (agents, tâches, invocations, réunions).
 * La vie de bureau (café, discussion…) ne concerne que les agents réellement inoccupés et
 * n'est jamais présentée comme du travail : bulles en pointillés, sans effet métier.
 */

const W = HQ_MAP.cols;
const D = HQ_MAP.rows;
const SPEED = 2.4; // tuiles / s
const VIEWS: Record<CameraView, { el: number; az: number; zoom: number }> = {
  top: { el: 0.98, az: 0, zoom: 1 },
  tq: { el: 0.72, az: 0.55, zoom: 1 },
  close: { el: 0.85, az: -0.2, zoom: 2.3 },
};

interface Avatar {
  agent: AgentView;
  ch: Character;
  g: THREE.Group;
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  ring: THREE.Mesh;
  halo: THREE.Mesh;
  mats: THREE.MeshStandardMaterial[];
  alpha: number;
  intent: VisualIntent | null;
  targetKey: string;
  path: { x: number; z: number }[];
  pose: string;
  rot: number;
  t: number;
  bubble: HTMLDivElement;
  bubbleText: string;
  bubbleKind: string;
  bubbleSince: number;
  who: HTMLDivElement;
  link: HTMLDivElement;
  hovered: boolean;
  /** Orientation à l'arrivée (radians), ou null. */
  face: number | null;
}

const MATS = new Map<string, THREE.MeshStandardMaterial>();
const GEOS = new Map<string, THREE.BufferGeometry>();
const std = (c: string, r = 0.85): THREE.MeshStandardMaterial => {
  const k = `${c}|${r}`;
  let m = MATS.get(k);
  if (!m) MATS.set(k, (m = new THREE.MeshStandardMaterial({ color: c, roughness: r })));
  return m;
};
const FLAT = new Map<string, THREE.MeshStandardMaterial>();
/** Feuillage à facettes : un matériau partagé par couleur (fusion du décor possible). */
const flatStd = (c: string): THREE.MeshStandardMaterial => {
  let m = FLAT.get(c);
  if (!m)
    FLAT.set(
      c,
      (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true })),
    );
  return m;
};
/**
 * Fusionne le décor fixe : une géométrie par matériau (et par mode d'ombre). Les matériaux restent
 * partagés, donc les recolorations (pôle, nuit, écrans) continuent de s'appliquer. Divise les appels
 * de dessin par ~20 : indispensable sans carte graphique.
 */
function mergeStatic(root: THREE.Object3D, skip: Set<THREE.Object3D>): void {
  root.updateMatrixWorld(true);
  const groups = new Map<
    string,
    { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }
  >();
  const victims: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D): void => {
    if (skip.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material) && m.visible) {
      const g = m.geometry.index ? m.geometry : null;
      if (g && g.attributes['uv'] && g.attributes['normal']) {
        const key = `${m.material.uuid}|${m.castShadow}`;
        let e = groups.get(key);
        if (!e) groups.set(key, (e = { mat: m.material, cast: m.castShadow, geos: [] }));
        const c = g.clone();
        for (const name of Object.keys(c.attributes))
          if (!['position', 'normal', 'uv'].includes(name)) c.deleteAttribute(name);
        c.applyMatrix4(m.matrixWorld);
        e.geos.push(c);
        victims.push(m);
      }
    }
    for (const ch of o.children) visit(ch);
  };
  visit(root);
  for (const v of victims) v.removeFromParent();
  for (const e of groups.values()) {
    const merged = mergeGeometries(e.geos, false);
    e.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mm = new THREE.Mesh(merged, e.mat);
    mm.castShadow = e.cast;
    mm.receiveShadow = true;
    mm.matrixAutoUpdate = false;
    root.add(mm);
  }
}
const geo = <T extends THREE.BufferGeometry>(k: string, f: () => T): T => {
  let g = GEOS.get(k) as T | undefined;
  if (!g) GEOS.set(k, (g = f()));
  return g;
};
const B = (w: number, h: number, d: number) =>
  geo(`b${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
const C = (rt: number, rb: number, h: number, s = 18) =>
  geo(`c${rt}:${rb}:${h}:${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const S = (r: number) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12));

function mesh(
  g: THREE.BufferGeometry,
  m: THREE.Material,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
  cast = true,
): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = cast;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
function canvasTex(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat?: [number, number],
): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}
const shade = (hex: string, l: number): string => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, l);
  return `#${c.getHexString()}`;
};

/** Parquet clair tressé (bâtons rompus simplifiés), commun à tout le bâtiment. */
function parquetTex(repeat: [number, number]): THREE.CanvasTexture {
  let seed = 5;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const base = '#e6c9a0';
  return canvasTex(
    256,
    256,
    (g) => {
      g.fillStyle = shade(base, -0.06);
      g.fillRect(0, 0, 256, 256);
      for (let cy = 0; cy < 4; cy++)
        for (let cx = 0; cx < 4; cx++) {
          const hz = (cx + cy) % 2 === 0;
          for (let k = 0; k < 4; k++) {
            g.fillStyle = shade(base, (rnd() - 0.5) * 0.05);
            if (hz) g.fillRect(cx * 64 + 1, cy * 64 + k * 16 + 1, 62, 14);
            else g.fillRect(cx * 64 + k * 16 + 1, cy * 64 + 1, 14, 62);
          }
        }
    },
    repeat,
  );
}
function grassTex(): THREE.CanvasTexture {
  let seed = 9;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return canvasTex(
    128,
    128,
    (g) => {
      g.fillStyle = '#94c97c';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 1200; i++) {
        g.fillStyle = shade('#94c97c', (rnd() - 0.5) * 0.08);
        g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
      }
    },
    [50, 42],
  );
}
/**
 * Tapis en niveaux de gris (bordure, couture pointillée, motif léger) : la couleur du matériau le
 * teinte, ce qui permet de recolorer une zone quand un pôle s'y installe.
 */
function rugTex(w: number, d: number, motif: string, r: number): THREE.CanvasTexture {
  const Wp = 512;
  const Hp = Math.max(64, Math.round((512 * d) / w));
  const k = Wp / w;
  const t = canvasTex(Wp, Hp, (g) => {
    g.fillStyle = '#ececec';
    g.fillRect(0, 0, Wp, Hp);
    g.fillStyle = '#ffffff';
    const step = 22;
    for (let y = step; y < Hp - step; y += step)
      for (let x = step; x < Wp - step; x += step) {
        const odd = (x / step + y / step) % 2 === 1;
        if (motif === 'dots' && !odd) {
          g.beginPath();
          g.arc(x, y, 2.6, 0, 7);
          g.fill();
        } else if (motif === 'diamonds' && !odd) {
          g.beginPath();
          g.moveTo(x, y - 6);
          g.lineTo(x + 6, y);
          g.lineTo(x, y + 6);
          g.lineTo(x - 6, y);
          g.fill();
        } else if (motif === 'stripes' && (y / step) % 3 === 0 && x === step) {
          g.fillRect(step, y - 2, Wp - 2 * step, 4);
        }
      }
    const rr = r * k;
    const inset = (m: number): void => {
      g.beginPath();
      g.roundRect(m, m, Wp - 2 * m, Hp - 2 * m, Math.max(2, rr - m));
    };
    g.lineWidth = 12;
    g.strokeStyle = '#c4c4c4';
    inset(6);
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = '#fafafa';
    g.setLineDash([10, 7]);
    inset(20);
    g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / w, 1 / d);
  return t;
}
/** Tapis aux coins arrondis posé au sol (forme plane, UV en unités du monde). */
function roundRug(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  r: number,
  m: THREE.MeshStandardMaterial,
): THREE.Mesh {
  const w = x1 - x0;
  const d = z1 - z0;
  const sh = new THREE.Shape();
  sh.moveTo(r, 0);
  sh.lineTo(w - r, 0);
  sh.quadraticCurveTo(w, 0, w, r);
  sh.lineTo(w, d - r);
  sh.quadraticCurveTo(w, d, w - r, d);
  sh.lineTo(r, d);
  sh.quadraticCurveTo(0, d, 0, d - r);
  sh.lineTo(0, r);
  sh.quadraticCurveTo(0, 0, r, 0);
  m.side = THREE.DoubleSide;
  const mm = new THREE.Mesh(new THREE.ShapeGeometry(sh), m);
  mm.rotation.x = Math.PI / 2;
  mm.position.set(x0, 0.02, z0);
  mm.receiveShadow = true;
  return mm;
}
function neonTex(text: string, color = '#ff5fa2'): THREE.CanvasTexture {
  return canvasTex(512, 96, (g) => {
    g.clearRect(0, 0, 512, 96);
    g.font = `800 ${text.length > 12 ? 44 : 64}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.strokeText(text, 256, 70);
    g.fillStyle = '#ffffff';
    g.fillText(text, 256, 70);
  });
}
interface Kpis {
  running: number;
  working: number;
  agents: number;
  done: number;
  approvals: number;
}
/** Indicateurs réels pour le mur d'écrans (aucune valeur inventée). */
export function kpisOf(world: WorldSnapshot): Kpis {
  const active = world.agents.filter((a) => a.status !== 'deactivated');
  return {
    running: world.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length,
    working: active.filter((a) => ['working', 'using_tool', 'thinking'].includes(a.activity))
      .length,
    agents: active.length,
    done: world.tasks.filter((t) => t.status === 'succeeded').length,
    approvals: world.approvals.filter((a) => a.status === 'pending').length,
  };
}
function drawKpis(g: CanvasRenderingContext2D, k: Kpis | null): void {
  g.fillStyle = '#0f1420';
  g.fillRect(0, 0, 640, 220);
  g.fillStyle = '#6ee7b7';
  g.font = '700 22px Inter, system-ui, sans-serif';
  g.fillText('● EN DIRECT', 22, 36);
  g.fillStyle = '#93a4c8';
  g.font = '500 18px Inter, system-ui, sans-serif';
  g.fillText('Tableau de bord du QG', 170, 36);
  const cells: [string, string][] = k
    ? [
        ['Missions en cours', String(k.running)],
        ['Agents au travail', `${k.working}/${k.agents}`],
        ['Missions réussies', String(k.done)],
        ['Validations', String(k.approvals)],
      ]
    : [];
  cells.forEach(([label, v], i) => {
    const x = 22 + i * 154;
    g.fillStyle = '#18213a';
    g.fillRect(x, 58, 140, 140);
    g.fillStyle = '#ffffff';
    g.font = '800 52px Inter, system-ui, sans-serif';
    g.fillText(v, x + 12, 128);
    g.fillStyle = '#93a4c8';
    g.font = '500 16px Inter, system-ui, sans-serif';
    g.fillText(label, x + 12, 176);
  });
}

export class StudioScene implements HqWorldView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private world = new THREE.Group();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  private labels: HTMLDivElement;
  private target = new THREE.Vector3(W / 2, 0, D / 2);
  private az = 0;
  private el = VIEWS.top.el;
  private dist = 60;
  private homeDist = 60;
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Zone cadrée : locaux occupés (l'aile d'extension n'entre dans le cadre qu'une fois utilisée). */
  private bounds = { x0: 0, z0: 0, x1: W, z1: D };
  private night = false;
  private reduced = false;
  private raf = 0;
  private lowPower = false;
  private lastRender = 0;
  private motion: 'eco' | 'fluide' = 'eco';
  private paused = false;
  /** Quelque chose a changé depuis la dernière image (caméra, données, survol…). */
  private dirty = true;
  private last = 0;
  private ro: ResizeObserver;
  private avatars = new Map<string, Avatar>();
  private screens = new Map<string, THREE.MeshBasicMaterial>();
  private roomFloors = new Map<string, THREE.MeshStandardMaterial>();
  private roomPills = new Map<string, HTMLButtonElement>();
  private meetingPill: HTMLButtonElement;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private lamps: THREE.PointLight[] = [];
  private lampShades: THREE.MeshStandardMaterial[] = [];
  private windows: THREE.MeshBasicMaterial[] = [];
  private screensDecor: THREE.MeshBasicMaterial[] = [];
  private wallBands = new Map<string, THREE.MeshStandardMaterial>();
  private kpiScreen: { tex: THREE.CanvasTexture; key: string } | null = null;
  private neon: THREE.MeshBasicMaterial | null = null;
  private vacuum: {
    g: THREE.Group;
    to: { x: number; z: number };
    led: THREE.MeshBasicMaterial;
  } | null = null;
  private selection: Selection | null = null;
  private highlight: string | null = null;
  private linksMode = false;
  private lastWorld: WorldSnapshot | null = null;
  private lastNow = Date.now();
  private firstSync = true;
  private beams: { m: THREE.Mesh; life: number }[] = [];
  private drag: {
    x: number;
    y: number;
    az: number;
    el: number;
    pan: boolean;
    moved: number;
  } | null = null;
  private hovered: Avatar | null = null;
  private ray = new THREE.Raycaster();
  private v3 = new THREE.Vector3();
  drawnLinks: { agentId: string; toolId: string }[] = [];
  hiddenLinks = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly cb: WorldCallbacks,
  ) {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Sans carte graphique (rendu logiciel) : mode économe, pour garder l'interface fluide.
    this.lowPower = softwareRenderer();
    // Signalé à l'interface : le verre dépoli (flou) est remplacé par un fond plus opaque.
    if (this.lowPower) document.documentElement.dataset['lowgpu'] = '1';
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.lowPower,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = !this.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'studio-canvas';
    host.appendChild(this.canvas);
    this.labels = document.createElement('div');
    this.labels.className = 'studio-labels';
    host.appendChild(this.labels);
    this.meetingPill = document.createElement('button');
    this.meetingPill.className = 'studio-meeting';
    this.meetingPill.hidden = true;
    this.labels.appendChild(this.meetingPill);
    this.scene.add(this.world);
    this.hemi = new THREE.HemisphereLight('#fffaf2', '#cbb79d', 1.7);
    this.sun = new THREE.DirectionalLight('#fff3e0', 2.6);
    this.buildLights();
    this.buildStatic();
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.applyLight();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
    this.labels.remove();
  }

  // ------------------------------------------------------------------ décor
  private buildLights(): void {
    this.scene.add(this.hemi);
    this.sun.position.set(W * 0.25, 40, D * 0.9);
    this.sun.target.position.set(W / 2, 0, D / 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(3072, 3072);
    Object.assign(this.sun.shadow.camera, {
      left: -40,
      right: 40,
      top: 36,
      bottom: -36,
      near: 2,
      far: 140,
    });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    for (const r of HQ_MAP.rooms) {
      const l = new THREE.PointLight('#ffd7a3', 0, 14, 1.5);
      l.position.set((r.rect.x0 + r.rect.x1 + 1) / 2, 3.4, (r.rect.y0 + r.rect.y1 + 1) / 2);
      this.scene.add(l);
      this.lamps.push(l);
    }
  }

  private buildStatic(): void {
    const w = this.world;
    this.buildOutdoor();
    // Socle et parquet clair tressé, unique pour tout le bâtiment (salles comprises).
    mesh(B(W, 0.3, D), std('#d8cfc3'), W / 2, -0.16, D / 2, w);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 1, D - 1),
      new THREE.MeshStandardMaterial({
        map: parquetTex([(W - 1) / 4.8, (D - 1) / 4.8]),
        roughness: 0.82,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, D / 2);
    floor.receiveShadow = true;
    w.add(floor);
    this.buildWalls();
    // Mur nord (haut) : panneaux d'accent des salles, baies vitrées, enseigne et écrans réels.
    for (const room of HQ_MAP.rooms.filter((r) => r.rect.y0 === 1)) {
      const { x0, x1 } = room.rect;
      const band = new THREE.MeshStandardMaterial({
        color: pastel(room.color, 0.25),
        roughness: 0.9,
      });
      mesh(B(x1 - x0 + 0.6, 1.5, 0.04), band, (x0 + x1 + 1) / 2, 1.45, 0.62, w, false);
      this.wallBands.set(room.id, band);
      if (room.id === 'ceo') this.kpiWall(x0 + 1.2, x1 - 0.2, 0.66);
      else if (room.id === 'focus') this.livingWall(x0 + 0.6, x1 + 0.4, 0.66);
      else if (room.id !== 'entry' && room.id !== 'library')
        for (let x = x0 + 1.6; x <= x1 - 0.6; x += 2.6) {
          const glass = new THREE.MeshBasicMaterial({ color: '#cfe8ff' });
          this.windows.push(glass);
          mesh(B(2.1, 1.0, 0.03), std('#2b2b30', 0.5), x, 1.7, 0.66, w, false);
          mesh(B(2.0, 0.9, 0.03), glass, x, 1.7, 0.68, w, false);
        }
    }
    // Porte d'entrée vitrée.
    const doorGlass = new THREE.MeshBasicMaterial({ color: '#cfe8ff' });
    this.windows.push(doorGlass);
    mesh(B(0.96, 2.1, 0.06), doorGlass, 5.5, 1.05, 0.5, w, false);
    mesh(B(1.1, 0.1, 0.12), std('#2b2b30', 0.5), 5.5, 2.12, 0.5, w, false);
    // Enseigne néon de l'accueil (personnalisable).
    this.neon = new THREE.MeshBasicMaterial({
      color: '#ff5fa2',
      transparent: true,
      map: neonTex('LIVING HQ'),
    });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), this.neon);
    neon.position.set(3.0, 2.25, 0.7);
    w.add(neon);
    this.buildVacuum();
    for (const room of HQ_MAP.rooms) this.buildRoom(room);
    for (const f of HQ_MAP.furniture) {
      this.build = this.layerFor(f.roomId);
      this.buildFurniture(f);
    }
    this.build = this.world;
    this.buildMeetingTable();
    for (const a of Object.values(HQ_MAP.anchors)) {
      this.build = this.layerFor(a.roomId);
      if (a.kind === 'desk') this.deskChair(a);
      if (a.kind === 'meeting_seat') this.meetingChair(a);
    }
    this.build = this.world;
    // Décor fixe fusionné (hors locaux libres, masquables, et hors robot aspirateur, mobile).
    const skip = new Set<THREE.Object3D>();
    for (const l of this.annexLayers.values()) skip.add(l.furn).add(l.free);
    if (this.vacuum) skip.add(this.vacuum.g);
    mergeStatic(this.world, skip);
    for (const l of this.annexLayers.values()) {
      mergeStatic(l.furn, new Set());
      mergeStatic(l.free, new Set());
    }
  }

  /** Calque de construction : les locaux libres ont leur propre groupe (masqué tant qu'il est vide). */
  private build: THREE.Object3D = this.world;
  private outdoor: THREE.Group | null = null;
  private annexLayers = new Map<
    string,
    { furn: THREE.Group; free: THREE.Group; rug: THREE.Mesh | null }
  >();
  private layerFor(roomId: string | null): THREE.Object3D {
    if (!roomId?.startsWith('annex')) return this.world;
    let l = this.annexLayers.get(roomId);
    if (!l) {
      l = { furn: new THREE.Group(), free: new THREE.Group(), rug: null };
      this.world.add(l.furn, l.free);
      this.annexLayers.set(roomId, l);
    }
    return l.furn;
  }

  /** Murs bas « coupés » (sauf la façade nord, haute) tirés des tuiles de murs du plan. */
  private buildWalls(): void {
    const walls = new Set(HQ_MAP.wallTiles.map((t) => `${t.x},${t.y}`));
    const has = (x: number, y: number): boolean => walls.has(`${x},${y}`);
    const body = std('#f4ede2', 0.9);
    const cap = std('#d8ccb9', 0.8);
    const LOW = 1.15;
    const seg = (x0: number, z0: number, x1: number, z1: number, h: number): void => {
      const horiz = z0 === z1;
      const len = horiz ? x1 - x0 : z1 - z0;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      mesh(B(horiz ? len : 0.22, h, horiz ? 0.22 : len), body, cx, h / 2, cz, this.world);
      mesh(
        B(horiz ? len + 0.04 : 0.28, 0.06, horiz ? 0.28 : len + 0.04),
        cap,
        cx,
        h + 0.03,
        cz,
        this.world,
        false,
      );
    };
    // Segments horizontaux puis verticaux (tronçons d'au moins deux tuiles).
    for (let y = 0; y < D; y++) {
      let x = 0;
      while (x < W) {
        if (!has(x, y) || !has(x + 1, y)) {
          x++;
          continue;
        }
        const s0 = x;
        while (has(x + 1, y)) x++;
        seg(s0 + 0.5, y + 0.5, x + 0.5, y + 0.5, y === 0 ? 2.7 : LOW);
        // Fenêtres côté extérieur sur les façades basses (sud).
        if (y === D - 1)
          for (let k = s0 + 1.5; k < x - 0.5; k += 3) {
            const glass = new THREE.MeshBasicMaterial({ color: '#cfe8ff' });
            this.windows.push(glass);
            mesh(B(1.8, 0.55, 0.02), glass, k, 0.62, y + 0.62, this.world, false);
          }
        x++;
      }
    }
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < D) {
        if (!has(x, y) || !has(x, y + 1)) {
          y++;
          continue;
        }
        const s0 = y;
        while (has(x, y + 1)) y++;
        seg(x + 0.5, Math.max(s0 + 0.5, 0.6), x + 0.5, y + 0.5, LOW);
        if (x === 0 || x === W - 1)
          for (let k = s0 + 2; k < y - 0.5; k += 3) {
            const glass = new THREE.MeshBasicMaterial({ color: '#cfe8ff' });
            this.windows.push(glass);
            mesh(B(0.02, 0.55, 1.8), glass, x === 0 ? 0.38 : W - 0.38, 0.62, k, this.world, false);
          }
        y++;
      }
    }
  }

  /** Extérieur décoratif : pelouse, arbres, potager, serre, terrain de sport, route. */
  private buildOutdoor(): void {
    const o = new THREE.Group();
    this.scene.add(o);
    this.outdoor = o;
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 220),
      new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(W / 2, -0.32, D / 2);
    grass.receiveShadow = true;
    o.add(grass);
    const flat = (x0: number, z0: number, x1: number, z1: number, c: string, y = -0.3): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), std(c, 1));
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      m.receiveShadow = true;
      o.add(m);
    };
    flat(-3, -3, W + 3, D + 3, '#ddd0b8');
    flat(3, -12, 8, -3, '#ddd0b8', -0.29); // allée vers l'entrée
    flat(-60, D + 10, W + 60, D + 15, '#6f7378', -0.29);
    for (let x = -58; x < W + 58; x += 4) flat(x, D + 12.35, x + 2, D + 12.65, '#f2f2f2', -0.28);
    // Terrain de sport (est).
    flat(W + 5, 4, W + 19, 32, '#e0866a', -0.29);
    flat(W + 7, 8, W + 17, 28, '#9cc49a', -0.285);
    flat(W + 5, 17.95, W + 19, 18.05, '#ffffff', -0.28);
    for (const z of [4.8, 31.2]) {
      mesh(C(0.08, 0.08, 3, 8), std('#444', 0.5), W + 12, 1.2, z, o);
      mesh(B(1.6, 1, 0.1), std('#ffffff', 0.5), W + 12, 2.6, z + (z < 10 ? 0.15 : -0.15), o);
    }
    // Potager et serre (nord).
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 2; j++) {
        const x = 14 + i * 4.2;
        const z = -10 + j * 3;
        mesh(B(3.2, 0.35, 1.8), std('#8a5a36', 0.9), x, -0.12, z, o);
        for (let k = 0; k < 8; k++)
          mesh(
            S(0.2),
            std(k % 2 ? '#5aa05b' : '#77b866', 0.9),
            x - 1.2 + (k % 4) * 0.8,
            0.15,
            z - 0.4 + Math.floor(k / 4) * 0.8,
            o,
            false,
          );
      }
    {
      const gm = new THREE.MeshStandardMaterial({
        color: '#d8f0ff',
        roughness: 0.1,
        transparent: true,
        opacity: 0.45,
      });
      mesh(B(7, 2.4, 4.5), gm, 34, 0.9, -10, o, false);
      const r1 = mesh(B(7.2, 0.12, 2.6), std('#e6e6e6', 0.5), 34, 2.45, -10.9, o, false);
      r1.rotation.x = -0.5;
      const r2 = mesh(B(7.2, 0.12, 2.6), std('#e6e6e6', 0.5), 34, 2.45, -9.1, o, false);
      r2.rotation.x = 0.5;
      for (let k = 0; k < 6; k++) mesh(S(0.35), std('#5aa05b', 0.9), 31.5 + k, 0.2, -10, o, false);
    }
    // Arbres (graine fixe : la scène est identique à chaque chargement).
    let seed = 11;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const trunk = std('#7a5233', 0.9);
    const leaves = [std('#3f7f45', 0.9), std('#4b8f4f', 0.9), std('#5aa05b', 0.9)];
    for (let i = 0; i < 44; i++) {
      let x: number;
      let z: number;
      do {
        x = -24 + rnd() * (W + 50);
        z = -22 + rnd() * (D + 50);
      } while (
        (x > -6 && x < W + 6 && z > -6 && z < D + 6) ||
        (z > D + 8 && z < D + 17) ||
        (x > W + 3 && x < W + 21 && z > 2 && z < 34) ||
        (x > 10 && x < 40 && z > -14 && z < -6)
      );
      const s = 0.8 + rnd() * 0.6;
      mesh(C(0.18 * s, 0.25 * s, 1.4 * s, 8), trunk, x, 0.4 * s, z, o, false);
      if (i % 3) {
        for (let k = 0; k < 3; k++)
          mesh(
            geo(`cone${k}`, () => new THREE.ConeGeometry(1.3 - k * 0.3, 2.2 - k * 0.4, 8)),
            leaves[k]!,
            x,
            (1.9 + k * 0.85) * s,
            z,
            o,
            false,
          ).scale.setScalar(s);
      } else {
        mesh(
          geo('icoT', () => new THREE.IcosahedronGeometry(1.25, 1)),
          leaves[2]!,
          x,
          2.1 * s,
          z,
          o,
          false,
        ).scale.setScalar(s);
      }
    }
    // Bancs et range-vélos devant l'entrée.
    for (const x of [1.5, 9.5]) mesh(B(2, 0.1, 0.6), std('#a8794f', 0.8), x, 0.2, -4.2, o);
    mergeStatic(o, new Set());
  }

  private buildRoom(room: Room): void {
    const { x0, y0, x1, y1 } = room.rect;
    const open = room.kind === 'department' && !room.walls;
    const inset = open ? 0.2 : 0.55;
    const free = room.id.startsWith('annex');
    const m = new THREE.MeshStandardMaterial({
      roughness: 1,
      map: rugTex(
        x1 - x0 + 1 - 2 * inset,
        y1 - y0 + 1 - 2 * inset,
        room.motif ?? 'dots',
        open ? 1.5 : 1.1,
      ),
    });
    m.color.set(pastel(room.color, 0.25));
    const rug = roundRug(
      x0 + inset,
      y0 + inset,
      x1 + 1 - inset,
      y1 + 1 - inset,
      open ? 1.5 : 1.1,
      m,
    );
    rug.userData['roomId'] = room.id;
    if (free) {
      this.layerFor(room.id);
      const l = this.annexLayers.get(room.id)!;
      l.furn.add(rug);
      l.rug = rug;
      // Local libre : contour pointillé et « + » au sol.
      const dm = new THREE.MeshStandardMaterial({
        color: '#a58ef0',
        roughness: 1,
        transparent: true,
        opacity: 0.6,
      });
      const cx = (x0 + x1 + 1) / 2;
      const cz = (y0 + y1 + 1) / 2;
      for (const [a, b, ww, dd] of [
        [cx, cz, 2.2, 0.45],
        [cx, cz, 0.45, 2.2],
      ] as const)
        mesh(B(ww, 0.02, dd), dm, a, 0.03, b, l.free, false);
      for (let x = x0 + 0.8; x < x1 + 0.4; x += 0.7) {
        mesh(B(0.4, 0.02, 0.07), dm, x, 0.025, y0 + 0.75, l.free, false);
        mesh(B(0.4, 0.02, 0.07), dm, x, 0.025, y1 + 0.25, l.free, false);
      }
      for (let z = y0 + 0.8; z < y1 + 0.4; z += 0.7) {
        mesh(B(0.07, 0.02, 0.4), dm, x0 + 0.75, 0.025, z, l.free, false);
        mesh(B(0.07, 0.02, 0.4), dm, x1 + 0.25, 0.025, z, l.free, false);
      }
    } else this.world.add(rug);
    this.roomFloors.set(room.id, m);
    // Étiquette « pastille » (nom réel du pôle pour les zones, nom de la salle sinon).
    const pill = document.createElement('button');
    pill.className = 'studio-zone';
    if (room.kind === 'amenity') pill.classList.add('amenity');
    pill.dataset['room'] = room.id;
    pill.innerHTML = `<i></i><span>${room.label}</span><small></small>`;
    pill.addEventListener('click', () => {
      const dept = this.lastWorld?.departments.find((x) => x.roomId === room.id);
      if (dept) this.cb.onSelect({ kind: 'department', id: dept.id });
      else if (room.id.startsWith('annex')) this.cb.onEmptyRoom?.(room.id);
    });
    this.labels.appendChild(pill);
    this.roomPills.set(room.id, pill);
  }

  private buildFurniture(f: Furniture): void {
    const x = f.x + 0.5;
    const z = f.y + 0.5;
    const w = this.build;
    switch (f.kind) {
      case 'desk': {
        // Îlot : l'écran regarde le siège, cloison verte côté opposé (postes dos à dos).
        const seat = Object.values(HQ_MAP.anchors).find(
          (a) => a.kind === 'desk' && a.facing?.x === f.x && a.facing.y === f.y,
        );
        const dir = seat ? Math.sign(seat.y - f.y) || 1 : 1; // +1 : siège côté +z
        const back = z - dir * 0.47;
        // Matériaux propres à la zone : le style choisi (moderne, chaleureux, tech) les recolore.
        const zm = this.zoneMats(f.roomId ?? '');
        mesh(B(0.98, 0.05, 0.86), zm.top, x, 0.75, z, w);
        mesh(B(0.05, 0.73, 0.8), zm.leg, x - 0.47, 0.37, z, w);
        mesh(B(0.05, 0.73, 0.8), zm.leg, x + 0.47, 0.37, z, w);
        mesh(B(1.0, 0.38, 0.04), zm.part, x, 0.96, back, w);
        // Double écran sur bras, ou écran + ordinateur portable.
        const dual = (f.x + f.y) % 2 === 0;
        const sm = new THREE.MeshBasicMaterial({ color: '#2a3442' });
        for (const ox of dual ? [-0.22, 0.22] : [0]) {
          const mon = mesh(
            B(0.42, 0.27, 0.03),
            std('#1d1f24', 0.4),
            x + ox,
            1.03,
            back + dir * 0.14,
            w,
          );
          mon.rotation.y = dual ? -ox * 0.6 * dir : 0;
          const sc = mesh(B(0.38, 0.23, 0.01), sm, x + ox, 1.03, back + dir * 0.158, w, false);
          sc.rotation.y = mon.rotation.y;
        }
        mesh(B(0.04, 0.2, 0.04), std('#9a9aa2', 0.3), x, 0.86, back + dir * 0.12, w);
        if (!dual) {
          mesh(B(0.3, 0.015, 0.21), std('#c9ccd2', 0.3), x + 0.3, 0.785, z + dir * 0.05, w);
          const lid = mesh(
            B(0.3, 0.2, 0.012),
            std('#c9ccd2', 0.3),
            x + 0.3,
            0.88,
            z - dir * 0.05,
            w,
          );
          lid.rotation.x = dir * 0.25;
        }
        if (seat) this.screens.set(`${seat.x},${seat.y}`, sm);
        mesh(B(0.36, 0.02, 0.12), std('#e4e4e8', 0.5), x, 0.785, z + dir * 0.18, w);
        if ((f.x + f.y) % 3 === 0)
          mesh(C(0.045, 0.045, 0.1, 10), std('#e07a5f'), x + 0.34, 0.83, z, w);
        if ((f.x + f.y) % 2 === 1)
          mesh(B(0.2, 0.005, 0.27), std('#ffffff', 0.9), x - 0.3, 0.78, z + dir * 0.1, w);
        if ((f.x * 3 + f.y) % 4 === 0) this.deskLamp(x - 0.36, back + dir * 0.12);
        break;
      }
      case 'tree':
        // Grand arbre en jardinière ronde, dessiné une fois par groupe de tuiles.
        if (this.firstOf(f)) this.tree(f);
        break;
      case 'booth':
        this.booth(x, z);
        break;
      case 'high_table':
        if (this.firstOf(f)) this.highTable(f);
        break;
      case 'pingpong':
        if (this.firstOf(f)) this.pingpong(f);
        break;
      case 'beanbag': {
        const c = ['#e98a52', '#5b8fd6', '#e8b84a'][(f.x + f.y) % 3] ?? '#e98a52';
        const b = mesh(S(0.36), std(c, 0.95), x, 0.2, z, w);
        b.scale.set(1, 0.6, 1);
        break;
      }
      case 'armchair':
        this.armchair(x, z, (f.x + f.y) % 2 ? '#8a4e36' : '#3f6b5a');
        break;
      case 'round_table':
        if (this.firstOf(f)) this.roundTable(f);
        break;
      case 'foosball':
        if (this.firstOf(f)) this.foosball(f);
        break;
      case 'arcade':
        this.arcade(x, z);
        break;
      case 'bleacher':
        if (this.firstOf(f)) this.bleacher(f);
        break;
      case 'bike_rack':
        this.bike(x, z, (f.x + f.y) % 2 ? '#e05a3a' : '#2f6f9e');
        break;
      case 'fridge':
        this.fridge(x, z);
        break;
      case 'plant':
        this.plant(
          x,
          z,
          0.85 + ((f.x * 7 + f.y * 3) % 5) * 0.1,
          (f.x + f.y) % 2 ? '#c8693f' : '#2f3b3a',
        );
        break;
      case 'whiteboard': {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        w.add(g);
        mesh(B(0.9, 0.62, 0.04), std('#fbfbfb', 0.4), 0, 1.15, 0, g);
        mesh(B(0.04, 1.2, 0.04), std('#9a9a9f'), -0.42, 0.6, 0, g);
        mesh(B(0.04, 1.2, 0.04), std('#9a9a9f'), 0.42, 0.6, 0, g);
        ['#f0b46b', '#f08b8b', '#8fc0a9'].forEach((c, i) =>
          mesh(B(0.16, 0.13, 0.01), std(c), -0.25 + i * 0.25, 1.22, 0.025, g),
        );
        break;
      }
      case 'server': {
        mesh(B(0.7, 1.7, 0.6), std('#2b2d33', 0.4), x, 0.85, z, w);
        for (let i = 0; i < 6; i++)
          mesh(
            B(0.5, 0.04, 0.01),
            new THREE.MeshBasicMaterial({ color: i % 2 ? '#5bd18b' : '#6aa8ff' }),
            x,
            0.4 + i * 0.22,
            z + 0.31,
            w,
            false,
          );
        break;
      }
      case 'counter':
        mesh(B(1.0, 0.95, 0.65), std('#6b4e3a'), x, 0.48, z, w);
        mesh(B(1.04, 0.05, 0.7), std('#d9cbb3', 0.6), x, 0.98, z, w);
        if (f.x % 2) {
          mesh(B(0.42, 0.52, 0.36), std('#3b3f47', 0.4), x, 1.27, z - 0.05, w);
          mesh(
            B(0.1, 0.1, 0.05),
            new THREE.MeshBasicMaterial({ color: '#e05a3a' }),
            x,
            1.4,
            z + 0.14,
            w,
            false,
          );
        }
        break;
      case 'cafe_table':
        mesh(C(0.42, 0.42, 0.05, 24), std('#e9d5b2', 0.6), x, 0.74, z, w);
        mesh(C(0.04, 0.04, 0.7, 8), std('#cfc3b0'), x, 0.37, z, w);
        for (const [dx, dz] of [
          [0.55, 0],
          [-0.55, 0],
        ] as const) {
          mesh(C(0.15, 0.15, 0.05, 14), std('#e08a5a'), x + dx, 0.48, z + dz, w);
          mesh(C(0.025, 0.025, 0.46, 6), std('#3a3a3e'), x + dx, 0.24, z + dz, w);
        }
        break;
      case 'sofa': {
        const c = '#4f7d6d';
        mesh(B(0.95, 0.32, 0.7), std(c, 0.9), x, 0.22, z, w);
        mesh(B(0.95, 0.45, 0.16), std(c, 0.9), x, 0.55, z + 0.28, w);
        mesh(B(0.14, 0.28, 0.7), std(shade(c, -0.05)), x - 0.47, 0.42, z, w);
        break;
      }
      case 'reception':
        mesh(B(1.6, 1.0, 0.6), std('#f4f0ea', 0.6), x + 0.3, 0.5, z, w);
        mesh(B(1.7, 0.05, 0.7), std('#c99a62', 0.6), x + 0.3, 1.02, z, w);
        break;
      case 'bookshelf': {
        // Étagère de livres ; contre un mur nord ou ouest selon la position.
        const vert = !HQ_MAP.furniture.some(
          (g) => g.kind === 'bookshelf' && g.y === f.y && Math.abs(g.x - f.x) === 1,
        );
        const g = new THREE.Group();
        g.position.set(vert ? f.x + 0.2 : x, 0, vert ? z : f.y + 0.2);
        if (vert) g.rotation.y = Math.PI / 2;
        w.add(g);
        mesh(B(1, 1.9, 0.36), std('#8a6240', 0.8), 0, 0.95, 0, g);
        const cols = ['#c2553f', '#365a6e', '#d9a441', '#3f6f5e', '#e8e0d4', '#7a5ea8'];
        for (let r = 0; r < 4; r++)
          for (let k = 0; k < 5; k++)
            mesh(
              B(0.14, 0.3 + ((k + r + f.x) % 3) * 0.04, 0.26),
              std(cols[(k + r + f.x + f.y) % cols.length]!, 0.85),
              -0.38 + k * 0.19,
              0.26 + r * 0.44,
              0.06,
              g,
              false,
            );
        break;
      }
      case 'pool_table':
        if (this.firstOf(f)) {
          const { cx, cz } = this.group(f);
          mesh(B(2.1, 0.18, 1.15), std('#7a4a2a', 0.7), cx, 0.78, cz, w);
          mesh(B(1.86, 0.02, 0.92), std('#2f8a52', 0.9), cx, 0.88, cz, w, false);
          for (const [dx, dz] of [
            [-0.9, -0.45],
            [0.9, -0.45],
            [-0.9, 0.45],
            [0.9, 0.45],
          ] as const)
            mesh(B(0.14, 0.7, 0.14), std('#5b3b26', 0.8), cx + dx, 0.35, cz + dz, w);
          ['#ffd166', '#d9534f', '#1d1d1d', '#ffffff', '#5b6ee1', '#3f8a4a'].forEach((c, k) =>
            mesh(
              S(0.045),
              std(c, 0.3),
              cx - 0.4 + k * 0.16,
              0.93,
              cz - 0.1 + (k % 2) * 0.22,
              w,
              false,
            ),
          );
        }
        break;
      case 'tv': {
        // Grand écran mural (salle de réunion, town hall, salle de jeux).
        if (!this.firstOf(f)) break;
        const { cx } = this.group(f);
        const scr = new THREE.MeshBasicMaterial({ color: '#2f3d58' });
        this.screensDecor.push(scr);
        mesh(B(1.9, 1.1, 0.06), std('#1d1f24', 0.4), cx, 1.35, f.y + 0.12, w, false);
        mesh(B(1.78, 0.98, 0.02), scr, cx, 1.35, f.y + 0.16, w, false);
        mesh(B(1.4, 0.4, 0.4), std('#e9e1d5', 0.6), cx, 0.2, f.y + 0.35, w);
        break;
      }
      case 'exec_desk':
        if (this.firstOf(f)) {
          const { cx, cz } = this.group(f);
          mesh(B(2.2, 0.06, 1.0), std('#5a3a22', 0.55), cx, 0.76, cz, w);
          mesh(B(0.1, 0.74, 0.9), std('#3b2a1e', 0.6), cx - 1.0, 0.37, cz, w);
          mesh(B(0.1, 0.74, 0.9), std('#3b2a1e', 0.6), cx + 1.0, 0.37, cz, w);
          mesh(B(0.56, 0.34, 0.03), std('#1d1f24', 0.4), cx, 1.0, cz - 0.3, w, false);
          this.chairAt(cx, cz - 0.95, 0, '#2b2b2b');
          this.chairAt(cx - 0.5, cz + 1.0, Math.PI, '#c9a26a');
          this.chairAt(cx + 0.5, cz + 1.0, Math.PI, '#c9a26a');
        }
        break;
      case 'kitchen_island':
        mesh(B(1.0, 0.92, 0.9), std('#7cc6fe', 0.6), x, 0.46, z, w);
        mesh(B(1.04, 0.05, 1.1), std('#f7f5f1', 0.4), x, 0.94, z, w);
        mesh(C(0.17, 0.17, 0.05, 12), std('#2c2c2c', 0.4), x, 0.7, z - 0.8, w);
        mesh(C(0.02, 0.02, 0.68, 6), std('#9aa0a8', 0.4), x, 0.34, z - 0.8, w, false);
        break;
      case 'stage':
        mesh(B(1.02, 0.32, 1.02), std('#a7794f', 0.8), x, 0.16, z, w);
        if (this.firstOf(f)) {
          const scr = new THREE.MeshBasicMaterial({ color: '#2f3d58' });
          this.screensDecor.push(scr);
          mesh(B(0.06, 1.3, 3.2), std('#1d1f24', 0.4), f.x + 0.08, 1.3, f.y + 2.5, w, false);
          mesh(B(0.02, 1.2, 3.0), scr, f.x + 0.12, 1.3, f.y + 2.5, w, false);
        }
        break;
      case 'auditorium_seat': {
        const row = f.x - 3;
        mesh(B(0.62, 0.36 + row * 0.06, 0.9), std('#8a5d6a', 0.9), x, 0.18 + row * 0.03, z, w);
        mesh(B(0.5, 0.1, 0.5), std('#b8333e', 0.8), x, 0.42 + row * 0.06, z, w);
        mesh(B(0.12, 0.5, 0.5), std('#b8333e', 0.8), x + 0.24, 0.66 + row * 0.06, z, w);
        break;
      }
      default:
        break;
    }
  }

  /** Mur d'écrans : indicateurs RÉELS de l'entreprise (mis à jour au sync, jamais inventés). */
  private kpiWall(xa: number, xb: number, z0 = 0): void {
    const wdt = xb - xa;
    const tex = canvasTex(640, 220, (g) => drawKpis(g, null));
    this.kpiScreen = { tex, key: '' };
    mesh(
      B(wdt + 0.12, 1.2, 0.05),
      std('#1d1f24', 0.4),
      (xa + xb) / 2,
      1.6,
      z0 + 0.05,
      this.build,
      false,
    );
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(wdt, 1.08),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    scr.position.set((xa + xb) / 2, 1.6, z0 + 0.085);
    this.build.add(scr);
  }
  private livingWall(xa: number, xb: number, z0 = 0): void {
    mesh(
      B(xb - xa + 0.4, 1.5, 0.08),
      std('#5d4a38'),
      (xa + xb) / 2,
      1.5,
      z0 + 0.05,
      this.build,
      false,
    );
    const leaf = [
      std('#3f8a4a', 0.9),
      std('#4f9a57', 0.9),
      std('#2f7a44', 0.9),
      std('#6aa85f', 0.9),
    ];
    for (let x = xa; x < xb; x += 0.22)
      for (let y = 0.85; y < 2.2; y += 0.2) {
        const k = Math.floor((x * 7 + y * 13) * 10) % 4;
        const m = mesh(
          S(0.14),
          leaf[k]!,
          x + ((y * 10) % 2) * 0.1,
          y,
          z0 + 0.12,
          this.build,
          false,
        );
        m.scale.set(1, 0.8, 0.45);
      }
  }
  private buildVacuum(): void {
    const g = new THREE.Group();
    g.position.set(20.5, 0, 18.5);
    this.build.add(g);
    mesh(C(0.2, 0.2, 0.07, 24), std('#f4f4f6', 0.4), 0, 0.05, 0, g);
    const led = new THREE.MeshBasicMaterial({ color: '#5b6ee1' });
    mesh(C(0.05, 0.05, 0.02, 10), led, 0, 0.095, 0.08, g, false);
    this.vacuum = { g, to: { x: 20.5, z: 18.5 }, led };
  }
  private stepVacuum(dt: number, t: number): void {
    const v = this.vacuum;
    if (!v || this.reduced) return;
    const p = v.g.position;
    const dx = v.to.x - p.x;
    const dz = v.to.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      // Nouvelle destination praticable dans l'allée centrale (aucun effet métier).
      for (let k = 0; k < 12; k++) {
        const c = { x: 11 + Math.random() * 34, z: 17.2 + Math.random() * 1.6 };
        if (HQ_MAP.isWalkable({ x: Math.floor(c.x), y: Math.floor(c.z) })) {
          v.to = c;
          break;
        }
      }
      return;
    }
    p.x += (dx / d) * 0.6 * dt;
    p.z += (dz / d) * 0.6 * dt;
    v.g.rotation.y = Math.atan2(dx, dz);
    v.led.color.set(Math.sin(t / 250) > 0 ? '#5b6ee1' : '#a8b4ff');
  }
  private plant(x: number, z: number, size: number, pot: string): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.build.add(g);
    mesh(C(0.2 * size, 0.16 * size, 0.38 * size, 14), std(pot), 0, 0.19 * size, 0, g);
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + size * 3;
      const leaf = mesh(
        S(0.2 * size),
        flatStd(k % 2 ? '#4f9a57' : '#3f8a4a'),
        Math.sin(a) * 0.22 * size,
        (0.52 + (k % 3) * 0.13) * size,
        Math.cos(a) * 0.22 * size,
        g,
      );
      leaf.scale.set(0.55, 0.12, 1.25);
      leaf.rotation.set(-0.5, a, 0, 'YXZ');
    }
  }

  /** Première tuile (haut-gauche) d'un groupe de meubles du même type. */
  private firstOf(f: Furniture): boolean {
    return !HQ_MAP.furniture.some(
      (g) =>
        g.kind === f.kind && ((g.x === f.x - 1 && g.y === f.y) || (g.x === f.x && g.y === f.y - 1)),
    );
  }
  private group(f: Furniture): { cx: number; cz: number; w: number; d: number } {
    const tiles = HQ_MAP.furniture.filter(
      (g) =>
        g.kind === f.kind &&
        Math.abs(g.x - f.x) <= 3 &&
        Math.abs(g.y - f.y) <= 3 &&
        g.x >= f.x &&
        g.y >= f.y,
    );
    const x1 = Math.max(...tiles.map((t) => t.x)) + 1;
    const y1 = Math.max(...tiles.map((t) => t.y)) + 1;
    return { cx: (f.x + x1) / 2, cz: (f.y + y1) / 2, w: x1 - f.x, d: y1 - f.y };
  }
  private deskLamp(x: number, z: number): void {
    mesh(C(0.06, 0.07, 0.02, 10), std('#2f2f33'), x, 0.79, z, this.build);
    mesh(C(0.012, 0.012, 0.3, 6), std('#2f2f33'), x, 0.93, z, this.build);
    const m = new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.7 });
    this.lampShades.push(m);
    mesh(C(0.05, 0.08, 0.08, 10), m, x, 1.08, z, this.build);
  }
  private tree(f: Furniture): void {
    const { cx, cz, w } = this.group(f);
    const r = w * 0.62;
    mesh(C(r, r, 0.5, 32), std('#f4f0ea', 0.6), cx, 0.25, cz, this.build);
    mesh(C(r - 0.12, r - 0.12, 0.04, 32), std('#5b4330'), cx, 0.51, cz, this.build);
    mesh(C(0.1, 0.14, 2.2, 8), std('#7a5a3c'), cx, 1.5, cz, this.build);
    for (const [dx, y, dz, rr] of [
      [0, 2.8, 0, 0.85],
      [0.45, 2.45, 0.3, 0.65],
      [-0.45, 2.5, -0.2, 0.7],
      [0.1, 3.3, -0.25, 0.6],
      [-0.2, 2.2, 0.45, 0.55],
    ] as const)
      mesh(
        geo(`ico${rr}`, () => new THREE.IcosahedronGeometry(rr, 1)),
        flatStd('#4e9a52'),
        cx + dx,
        y,
        cz + dz,
        this.build,
      );
    // Banquettes rayonnantes autour de la jardinière.
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const g = new THREE.Group();
      g.position.set(cx + Math.sin(a) * (r + 0.28), 0, cz + Math.cos(a) * (r + 0.28));
      g.rotation.y = a;
      this.build.add(g);
      mesh(B(0.3, 0.07, 0.42), std('#e8d2ad', 0.8), 0, 0.36, 0, g);
      mesh(B(0.24, 0.32, 0.05), std('#d7bf98'), 0, 0.16, 0, g);
    }
  }
  private booth(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.build.add(g);
    const dark = std('#2d2b31', 0.5);
    mesh(B(0.94, 2.0, 0.06), dark, 0, 1.0, -0.44, g);
    mesh(B(0.06, 2.0, 0.94), dark, -0.44, 1.0, 0, g);
    mesh(B(0.06, 2.0, 0.94), dark, 0.44, 1.0, 0, g);
    mesh(B(0.94, 0.06, 0.94), dark, 0, 2.0, 0, g);
    mesh(B(0.62, 1.8, 0.04), std('#e0703f', 0.6), -0.12, 0.92, 0.45, g);
    const glass = new THREE.Mesh(
      B(0.22, 1.8, 0.02),
      new THREE.MeshStandardMaterial({
        color: '#a9c6d6',
        transparent: true,
        opacity: 0.45,
        roughness: 0.1,
      }),
    );
    glass.position.set(0.32, 0.92, 0.45);
    g.add(glass);
    mesh(B(0.4, 0.04, 0.24), std('#e9d3b0'), 0, 0.75, -0.3, g);
  }
  private highTable(f: Furniture): void {
    const { cx, cz, w } = this.group(f);
    mesh(B(w - 0.1, 0.05, 0.7), std('#e9d3b0', 0.6), cx, 1.05, cz, this.build);
    mesh(B(0.06, 1.0, 0.5), std('#cfc3b0'), cx - w / 2 + 0.2, 0.52, cz, this.build);
    mesh(B(0.06, 1.0, 0.5), std('#cfc3b0'), cx + w / 2 - 0.2, 0.52, cz, this.build);
    for (let k = 0; k < w; k++) {
      const sx = f.x + k + 0.5;
      for (const dz of [-0.62, 0.62]) {
        mesh(C(0.15, 0.15, 0.05, 14), std('#e08a5a'), sx, 0.72, cz + dz, this.build);
        mesh(C(0.025, 0.025, 0.7, 6), std('#3a3a3e'), sx, 0.36, cz + dz, this.build);
      }
    }
  }
  private pingpong(f: Furniture): void {
    const { cx, cz, w } = this.group(f);
    mesh(B(w - 0.15, 0.05, 0.95), std('#2f6f5a', 0.6), cx, 0.76, cz, this.build);
    mesh(B(0.03, 0.12, 0.95), std('#f4f4f4'), cx, 0.84, cz, this.build);
    mesh(B(w - 0.15, 0.006, 0.02), std('#ffffff'), cx, 0.79, cz, this.build);
    for (const [dx, dz] of [
      [-0.8, -0.38],
      [0.8, -0.38],
      [-0.8, 0.38],
      [0.8, 0.38],
    ] as const)
      mesh(B(0.05, 0.74, 0.05), std('#2f2f33'), cx + dx, 0.37, cz + dz, this.build);
    mesh(S(0.035), std('#ffffff', 0.4), cx + 0.4, 0.82, cz + 0.1, this.build);
  }
  private armchair(x: number, z: number, c: string): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI;
    this.build.add(g);
    mesh(B(0.74, 0.34, 0.68), std(c, 0.9), 0, 0.24, 0, g);
    mesh(B(0.74, 0.46, 0.16), std(c, 0.9), 0, 0.58, -0.27, g);
    mesh(B(0.13, 0.22, 0.62), std(shade(c, -0.04)), -0.32, 0.48, 0.02, g);
    mesh(B(0.13, 0.22, 0.62), std(shade(c, -0.04)), 0.32, 0.48, 0.02, g);
    mesh(B(0.48, 0.07, 0.46), std(shade(c, 0.05), 0.95), 0, 0.44, 0.05, g);
  }
  private foosball(f: Furniture): void {
    const { cx, cz, w } = this.group(f);
    mesh(B(w - 0.35, 0.22, 0.75), std('#7a5640', 0.6), cx, 0.8, cz, this.build);
    mesh(B(w - 0.5, 0.01, 0.6), std('#3d8b4f', 0.8), cx, 0.915, cz, this.build);
    for (const [dx, dz] of [
      [-0.6, -0.3],
      [0.6, -0.3],
      [-0.6, 0.3],
      [0.6, 0.3],
    ] as const)
      mesh(B(0.06, 0.7, 0.06), std('#5d4232'), cx + dx, 0.35, cz + dz, this.build);
    for (let k = 0; k < 6; k++)
      mesh(
        C(0.012, 0.012, 1.0, 6),
        std('#c9c9cf', 0.3),
        cx - 0.55 + k * 0.22,
        0.94,
        cz,
        this.build,
        false,
      ).rotation.x = Math.PI / 2;
  }
  private arcade(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = -Math.PI / 2;
    this.build.add(g);
    mesh(B(0.62, 1.7, 0.6), std('#5b2bb5', 0.5), 0, 0.85, 0, g);
    const scr = new THREE.MeshBasicMaterial({ color: '#59e3ff' });
    this.screensDecor.push(scr);
    mesh(B(0.46, 0.38, 0.02), scr, 0, 1.25, 0.31, g, false);
    mesh(B(0.5, 0.08, 0.22), std('#1f1f24'), 0, 0.92, 0.36, g);
    mesh(
      B(0.62, 0.18, 0.04),
      new THREE.MeshBasicMaterial({ color: '#ff5fa2' }),
      0,
      1.6,
      0.31,
      g,
      false,
    );
  }
  private bleacher(f: Furniture): void {
    const { cx, cz, w } = this.group(f);
    // Gradins en bois (« town hall ») avec coussins colorés.
    for (let k = 0; k < 3; k++) {
      mesh(
        B(w - 0.1, 0.22 * (k + 1), 0.34),
        std('#d8b07a', 0.7),
        cx,
        0.11 * (k + 1),
        cz + 0.34 - k * 0.34,
        this.build,
      );
    }
    const cush = ['#e98a52', '#5b8fd6', '#e8b84a', '#d65c7a'];
    for (let i = 0; i < w * 2; i++)
      mesh(
        B(0.32, 0.05, 0.26),
        std(cush[i % 4]!, 0.95),
        f.x + 0.25 + i * 0.5,
        0.25 + (i % 3) * 0.22,
        cz + 0.34 - (i % 3) * 0.34,
        this.build,
      );
  }
  private bike(x: number, z: number, c: string): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI / 2;
    this.build.add(g);
    for (const dz of [-0.32, 0.32]) {
      const wheel = mesh(
        geo('wheel', () => new THREE.TorusGeometry(0.2, 0.02, 6, 20)),
        std('#1f1f24', 0.5),
        0,
        0.22,
        dz,
        g,
      );
      wheel.rotation.y = Math.PI / 2;
    }
    mesh(B(0.03, 0.03, 0.6), std(c, 0.5), 0, 0.42, 0, g);
    mesh(B(0.03, 0.26, 0.03), std(c, 0.5), 0, 0.32, -0.08, g);
    mesh(B(0.1, 0.03, 0.18), std('#1f1f24'), 0, 0.48, -0.08, g);
  }
  private fridge(x: number, z: number): void {
    mesh(B(0.86, 1.8, 0.6), std('#dfe3e8', 0.3), x, 0.9, z, this.build);
    const glass = new THREE.MeshStandardMaterial({
      color: '#bfe6ff',
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      emissive: '#000000',
    });
    this.lampShades.push(glass);
    mesh(B(0.74, 1.6, 0.02), glass, x, 0.92, z + 0.31, this.build, false);
    const cols = ['#ff7a59', '#ffd166', '#06d6a0', '#118ab2', '#ef476f'];
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 5; k++)
        mesh(
          C(0.035, 0.035, 0.2, 8),
          std(cols[(k + r) % 5]!, 0.5),
          x - 0.28 + k * 0.14,
          0.32 + r * 0.38,
          z + 0.2,
          this.build,
          false,
        );
  }

  private roundTable(f: Furniture): void {
    const { cx, cz } = this.group(f);
    const room = HQ_MAP.rooms.find((r) => r.id === f.roomId);
    this.rug(cx, cz, 3, 3, shade(room?.color ?? '#9fb2dc', 0.08));
    mesh(C(0.62, 0.62, 0.05, 28), std('#e9d5b2', 0.6), cx, 0.74, cz, this.build);
    mesh(C(0.05, 0.05, 0.7, 10), std('#cfc3b0'), cx, 0.37, cz, this.build);
    mesh(B(0.32, 0.02, 0.22), std('#d9dbe0', 0.4), cx + 0.12, 0.78, cz - 0.05, this.build);
    mesh(B(0.2, 0.005, 0.28), std('#ffffff', 0.9), cx - 0.25, 0.775, cz + 0.15, this.build);
    const chair = shade(room?.color ?? '#a9bde6', 0.05);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const g = new THREE.Group();
      g.position.set(cx + Math.sin(a) * 0.95, 0, cz + Math.cos(a) * 0.95);
      g.rotation.y = a + Math.PI;
      this.build.add(g);
      mesh(B(0.42, 0.06, 0.4), std(chair, 0.8), 0, 0.46, 0, g);
      mesh(B(0.4, 0.4, 0.05), std(chair, 0.8), 0, 0.68, -0.19, g);
      for (const [a1, b1] of [
        [-0.17, -0.16],
        [0.17, -0.16],
        [-0.17, 0.16],
        [0.17, 0.16],
      ] as const)
        mesh(B(0.03, 0.44, 0.03), std('#b8a58c'), a1, 0.22, b1, g);
    }
  }

  private buildMeetingTable(): void {
    const tiles = HQ_MAP.furniture.filter((f) => f.kind === 'meeting_table');
    if (!tiles.length) return;
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs) + 1;
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys) + 1;
    const cx = (x0 + x1) / 2;
    const cz = (y0 + y1) / 2;
    this.rug(cx, cz, x1 - x0 + 2.6, y1 - y0 + 2.4, '#b9a2dc');
    mesh(B(x1 - x0 - 0.1, 0.06, y1 - y0 - 0.5), std('#7a5640', 0.6), cx, 0.75, cz, this.build);
    mesh(B(0.12, 0.72, 0.8), std('#5d4232'), x0 + 0.5, 0.36, cz, this.build);
    mesh(B(0.12, 0.72, 0.8), std('#5d4232'), x1 - 0.5, 0.36, cz, this.build);
    for (let x = x0 + 0.5; x < x1; x += 1)
      mesh(B(0.22, 0.01, 0.28), std('#ffffff', 0.9), x, 0.785, cz - 0.25, this.build);
  }

  private rug(x: number, z: number, w: number, d: number, c: string): void {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({
        roughness: 1,
        map: canvasTex(128, Math.max(16, Math.round((128 * d) / w)), (g, cw, ch) => {
          g.fillStyle = c;
          g.fillRect(0, 0, cw, ch);
          g.strokeStyle = 'rgba(255,255,255,.7)';
          g.lineWidth = 3;
          g.strokeRect(8, 8, cw - 16, ch - 16);
          g.strokeRect(14, 14, cw - 28, ch - 28);
        }),
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    m.receiveShadow = true;
    this.build.add(m);
  }

  private chairAt(x: number, z: number, rot: number, color: string): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.build.add(g);
    mesh(B(0.44, 0.07, 0.42), std(color, 0.7), 0, 0.46, 0, g);
    mesh(B(0.42, 0.44, 0.06), std(color, 0.7), 0, 0.73, -0.21, g);
    mesh(C(0.03, 0.03, 0.36, 8), std('#3a3a3e'), 0, 0.26, 0, g);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const l = mesh(
        B(0.26, 0.03, 0.04),
        std('#2f2f33'),
        Math.sin(a) * 0.12,
        0.05,
        Math.cos(a) * 0.12,
        g,
      );
      l.rotation.y = a + Math.PI / 2;
    }
  }
  private deskChair(a: Anchor): void {
    const colors = ['#e8b84a', '#2f2f35', '#3f6fb5', '#d9774a', '#2f2f35'];
    const f = a.facing ?? { x: a.x, y: a.y - 1 };
    const dir = Math.sign(a.y - f.y) || 1;
    // Le siège regarde son bureau, dossier côté opposé.
    this.chairAt(
      a.x + 0.5,
      a.y + 0.5 + dir * 0.05,
      Math.atan2(f.x - a.x, f.y - a.y),
      colors[(a.x + a.y) % colors.length] ?? '#2f2f35',
    );
  }
  private meetingChair(a: Anchor): void {
    const f = a.facing ?? { x: a.x, y: a.y - 1 };
    const rot = Math.atan2(f.x - a.x, f.y - a.y);
    this.chairAt(a.x + 0.5, a.y + 0.5, rot, '#2f2f35');
  }

  // ------------------------------------------------------------------ avatars
  private makeAvatar(
    agent: AgentView,
    at: { x: number; z: number },
    deptColor: string | null,
  ): Avatar {
    const ap = appearanceOf(agent.avatarId);
    // Tenue aux couleurs du pôle (nuancée par personne), expressions selon l'état réel.
    const ch = buildCharacter(ap, outfitColor(deptColor, ap.top, hash(agent.id)));
    const { g, body, legL, legR, armL, armR, head, mats } = ch;
    const ring = new THREE.Mesh(
      geo('ring', () => new THREE.RingGeometry(0.3, 0.38, 28)),
      new THREE.MeshBasicMaterial({ color: '#7c60c9', transparent: true, opacity: 0.95 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    ring.visible = false;
    g.add(ring);
    const halo = new THREE.Mesh(
      geo('halo', () => new THREE.RingGeometry(0.34, 0.5, 28)),
      new THREE.MeshBasicMaterial({ color: '#ce4b61', transparent: true, opacity: 0.8 }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.022;
    halo.visible = false;
    g.add(halo);
    g.traverse((o) => (o.userData['agentId'] = agent.id));
    g.position.set(at.x, 0, at.z);
    this.world.add(g);
    const bubble = document.createElement('div');
    bubble.className = 'studio-bubble';
    bubble.hidden = true;
    const who = document.createElement('div');
    who.className = 'studio-who';
    who.hidden = true;
    const link = document.createElement('div');
    link.className = 'studio-link';
    link.hidden = true;
    this.labels.append(bubble, who, link);
    const av: Avatar = {
      agent,
      ch,
      g,
      body,
      legL,
      legR,
      armL,
      armR,
      head,
      ring,
      halo,
      mats,
      alpha: 1,
      intent: null,
      targetKey: '',
      path: [],
      pose: 'idle',
      rot: 0,
      t: Math.random() * 10,
      bubble,
      bubbleText: '',
      bubbleKind: '',
      bubbleSince: 0,
      who,
      link,
      hovered: false,
      face: null,
    };
    this.avatars.set(agent.id, av);
    return av;
  }

  private removeAvatar(id: string): void {
    const av = this.avatars.get(id);
    if (!av) return;
    this.world.remove(av.g);
    av.mats.forEach((m) => m.dispose());
    av.bubble.remove();
    av.who.remove();
    av.link.remove();
    this.avatars.delete(id);
  }

  /** Point d'arrivée concret pour une intention (siège, place de café, plante voisine…). */
  private spotFor(
    av: Avatar,
    intent: VisualIntent,
  ): { x: number; z: number; key: string; face: number | null } {
    const a = intent.anchor;
    if (intent.life === 'plants') {
      const tile = this.nearPlant(a);
      if (tile)
        return {
          x: tile.x + 0.5,
          z: tile.y + 0.5,
          key: `plant:${tile.x},${tile.y}`,
          face: tile.face,
        };
    }
    let face: number | null = null;
    if (a.facing) face = Math.atan2(a.facing.x - a.x, a.facing.y - a.y);
    if (intent.mode === 'break' && intent.life === 'chat')
      face = av.agent.id < 'm' ? Math.PI / 2 : -Math.PI / 2;
    // Au poste, l'agent est assis légèrement vers son bureau.
    const dz = intent.mode === 'desk' && a.facing ? Math.sign(a.facing.y - a.y) * 0.05 : 0;
    return { x: a.x + 0.5, z: a.y + 0.5 + dz, key: `${a.id}:${intent.life ?? intent.mode}`, face };
  }

  private nearPlant(a: Anchor): (Tile & { face: number }) | null {
    let best: (Tile & { face: number }) | null = null;
    let bd = 1e9;
    for (const f of HQ_MAP.furniture) {
      if (f.kind !== 'plant') continue;
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [-1, 0],
        [0, -1],
      ] as const) {
        const t = { x: f.x + dx, y: f.y + dy };
        if (!HQ_MAP.isWalkable(t)) continue;
        const d = Math.abs(t.x - a.x) + Math.abs(t.y - a.y);
        if (d < bd) {
          bd = d;
          best = { ...t, face: Math.atan2(-dx, -dy) };
        }
      }
    }
    return bd <= 14 ? best : null;
  }

  // ------------------------------------------------------------------ sync
  sync(world: WorldSnapshot, sel: Selection | null, now: number): void {
    this.lastWorld = world;
    this.lastNow = now;
    this.dirty = true;
    this.selection = sel;
    const animateSpawn = !this.firstSync && !this.reduced;
    const activeInv = new Map<string, InvocationView>();
    for (const i of world.invocations)
      if (i.status === 'running' || i.status === 'requested' || i.status === 'authorized')
        activeInv.set(i.agentId, i);
    const tools = new Map(world.tools.map((t) => [t.id, t]));
    const titles = new Map(world.tasks.map((t) => [t.id, t.title]));
    const seats = meetingSeats(world.meetings);
    world.agents.forEach((agent, index) => {
      const intent = visualIntent(agent, index, now, HQ_MAP, seats.get(agent.id) ?? null);
      let av = this.avatars.get(agent.id);
      if (!av) {
        const spawn = HQ_MAP.anchors['entry-spawn'];
        const start =
          animateSpawn && spawn
            ? { x: spawn.x + 0.5, z: spawn.y + 0.5 }
            : intent
              ? { x: intent.anchor.x + 0.5, z: intent.anchor.y + 0.5 }
              : { x: 3.5, z: 23.5 };
        av = this.makeAvatar(
          agent,
          start,
          world.departments.find((d) => d.id === agent.departmentId)?.color ?? null,
        );
        if (animateSpawn) this.beam(start.x, start.z);
      }
      av.agent = agent;
      av.intent = intent;
      av.g.visible = intent !== null;
      if (intent) {
        const spot = this.spotFor(av, intent);
        if (spot.key !== av.targetKey) {
          av.targetKey = spot.key;
          const from = { x: av.g.position.x, z: av.g.position.z };
          av.path = this.reduced || this.firstSync ? [] : studioPath(from, spot, HQ_MAP);
          if (!av.path.length) av.g.position.set(spot.x, 0, spot.z);
          av.face = spot.face;
          if (!av.path.length && spot.face !== null) av.g.rotation.y = spot.face;
        }
      }
      const b = bubbleFor(agent, intent, activeInv.get(agent.id), tools, titles);
      if (b.text !== av.bubbleText) {
        av.bubbleText = b.text;
        av.bubbleKind = b.kind;
        av.bubbleSince = performance.now();
      }
      av.halo.visible = agent.activity === 'blocked';
      const mood = moodOf(agent, now, world.tasks);
      if (mood !== av.ch.mood) av.ch.setMood(mood);
      av.ring.visible = sel?.kind === 'agent' && sel.id === agent.id;
      this.setAlpha(av, this.highlight && agent.departmentId !== this.highlight ? 0.3 : 1);
    });
    for (const id of [...this.avatars.keys()])
      if (!world.agents.some((a) => a.id === id)) this.removeAvatar(id);
    // Écrans des postes : état réel de l'agent assis à son bureau ; logo de l'appli utilisée.
    for (const [seat, sm] of this.screens) {
      const av = [...this.avatars.values()].find(
        (a) =>
          a.intent?.mode === 'desk' &&
          !a.path.length &&
          `${a.intent.anchor.x},${a.intent.anchor.y}` === seat,
      );
      const act = av?.agent.activity;
      const inv = av ? activeInv.get(av.agent.id) : undefined;
      const tool = inv ? tools.get(inv.toolId) : undefined;
      const tex = act === 'using_tool' && tool ? this.appScreen(tool) : null;
      if (sm.map !== tex) {
        sm.map = tex;
        sm.needsUpdate = true;
      }
      sm.color.set(
        tex
          ? '#ffffff'
          : act === 'working' || act === 'thinking'
            ? '#9fe3c0'
            : act === 'blocked'
              ? '#ef5a6f'
              : av
                ? '#9db4d8'
                : '#2a3442',
      );
    }
    // Pastilles des locaux : nom et couleur réels du pôle, présence au poste.
    for (const room of HQ_MAP.rooms) {
      const pill = this.roomPills.get(room.id);
      const floor = this.roomFloors.get(room.id);
      if (!pill) continue;
      const dept = world.departments.find((d) => d.roomId === room.id);
      const name = dept ? dept.name : room.kind === 'department' ? 'Espace libre' : room.label;
      let sub = '';
      if (dept) {
        const { atDesk, total } = departmentPresence(world.agents, dept.id, now, seats);
        sub = `${atDesk}/${total} au poste`;
      } else if (room.id.startsWith('annex')) sub = 'extension possible';
      const color = dept?.color ?? (room.id.startsWith('annex') ? '#b9b0c6' : room.color);
      const html = `<i style="background:${color}"></i><span>${name}</span>${sub ? `<small>${sub}</small>` : ''}`;
      if (pill.innerHTML !== html) pill.innerHTML = html;
      pill.classList.toggle('free', !dept && room.id.startsWith('annex'));
      floor?.color.set(pastel(dept?.color ?? room.color, 0.25));
      // Local libre : mobilier masqué et marquage « + » tant qu'aucun pôle ne s'y installe.
      const layer = this.annexLayers.get(room.id);
      if (layer) {
        layer.furn.visible = !!dept;
        layer.free.visible = !dept;
      }
    }
    // Mur d'écrans : chiffres réels du snapshot.
    if (this.kpiScreen) {
      const k = kpisOf(world);
      const key = JSON.stringify(k);
      if (key !== this.kpiScreen.key) {
        this.kpiScreen.key = key;
        const cv = this.kpiScreen.tex.image as HTMLCanvasElement;
        const g = cv.getContext('2d');
        if (g) drawKpis(g, k);
        this.kpiScreen.tex.needsUpdate = true;
      }
    }
    const m = world.meetings.find((x) => x.status === 'in_progress');
    this.meetingPill.hidden = !m;
    if (m) {
      this.meetingPill.textContent = `◎ ${m.topic}`;
      this.meetingPill.onclick = () => this.cb.onSelect({ kind: 'meeting', id: m.id });
    }
    this.firstSync = false;
  }

  private appScreens = new Map<string, THREE.CanvasTexture>();
  /** Écran d'un bureau aux couleurs de l'application utilisée (logo de marque si connu). */
  private appScreen(tool: {
    id: string;
    code: string;
    color: string;
    app?: string | null;
  }): THREE.CanvasTexture {
    const hit = this.appScreens.get(tool.id);
    if (hit) return hit;
    const icon = brandIcon(tool.app ?? null);
    const tex = canvasTex(128, 72, (g) => {
      g.fillStyle = icon?.hex ?? tool.color;
      g.fillRect(0, 0, 128, 72);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, 0, 128, 10);
      g.fillStyle = '#ffffff';
      if (icon) {
        g.save();
        g.translate(64 - 22, 36 - 22 + 4);
        g.scale(44 / 24, 44 / 24);
        g.fill(new Path2D(icon.path));
        g.restore();
      } else {
        g.font = '800 30px Inter, system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(tool.code.slice(0, 4), 64, 40);
      }
    });
    this.appScreens.set(tool.id, tex);
    return tex;
  }

  /* ---------- personnalisation du QG ---------- */
  private zoneMaterials = new Map<
    string,
    {
      top: THREE.MeshStandardMaterial;
      leg: THREE.MeshStandardMaterial;
      part: THREE.MeshStandardMaterial;
    }
  >();
  private zoneMats(roomId: string) {
    let z = this.zoneMaterials.get(roomId);
    if (!z) {
      z = {
        top: new THREE.MeshStandardMaterial({ color: '#f6f4f0', roughness: 0.6 }),
        leg: new THREE.MeshStandardMaterial({ color: '#c99a62', roughness: 0.85 }),
        part: new THREE.MeshStandardMaterial({ color: '#4f7a62', roughness: 0.9 }),
      };
      this.zoneMaterials.set(roomId, z);
    }
    return z;
  }
  private logoMesh: THREE.Mesh | null = null;

  /** Enseigne néon (texte, couleur), logo au mur et style de mobilier par zone. */
  setBranding(b: {
    neonText: string;
    neonColor: string;
    logo: string | null;
    zoneStyles: Record<string, 'modern' | 'cosy' | 'tech'>;
  }): void {
    if (this.neon) {
      this.neon.map?.dispose();
      this.neon.map = neonTex(b.neonText, b.neonColor);
      this.neon.color.set('#ffffff');
      this.neon.needsUpdate = true;
    }
    const STYLE = {
      modern: ['#f6f4f0', '#c99a62', '#4f7a62'],
      cosy: ['#c79a6b', '#8a5a3c', '#b5835a'],
      tech: ['#2b2d33', '#1d1f24', '#5b6ee1'],
    } as const;
    for (const [roomId, z] of this.zoneMaterials) {
      const [top, leg, part] = STYLE[b.zoneStyles[roomId] ?? 'modern'];
      z.top.color.set(top);
      z.leg.color.set(leg);
      z.part.color.set(part);
      z.part.emissive.set(b.zoneStyles[roomId] === 'tech' ? '#1b2a7a' : '#000000');
    }
    if (this.logoMesh) {
      this.world.remove(this.logoMesh);
      this.logoMesh = null;
    }
    if (b.logo) {
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        const h = 1.1;
        const w = Math.min(2.4, (h * img.width) / Math.max(1, img.height));
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
        );
        m.position.set(7.6, 1.75, 0.7);
        this.world.add(m);
        this.logoMesh = m;
        this.dirty = true;
      };
      img.src = b.logo;
    }
    this.dirty = true;
  }

  private setAlpha(av: Avatar, a: number): void {
    if (av.alpha === a) return;
    av.alpha = a;
    for (const m of av.mats) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a >= 1;
    }
  }

  private beam(x: number, z: number): void {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 3.5, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#c4b5fd',
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    m.position.set(x, 1.75, z);
    this.world.add(m);
    this.beams.push({ m, life: 1.8 });
  }

  // ------------------------------------------------------------------ caméra
  setView(v: CameraView): void {
    const p = VIEWS[v];
    this.az = p.az;
    this.el = p.el;
    this.fitHome();
    this.dist = this.homeDist / p.zoom;
    if (v === 'close') {
      const sel =
        this.selection?.kind === 'agent' ? this.avatars.get(this.selection.id) : undefined;
      this.target.set(sel ? sel.g.position.x : W / 2, 0, sel ? sel.g.position.z : D * 0.32);
    }
    this.place();
  }
  setNight(on: boolean): void {
    this.night = on;
    this.applyLight();
    this.dirty = true;
  }
  setInsets(i: { top: number; right: number; bottom: number; left: number }): void {
    if (JSON.stringify(i) === JSON.stringify(this.insets)) return;
    this.insets = i;
    // Conserve le zoom et le point visé de l'utilisateur ; seul le cadrage de référence change.
    const ratio = this.homeDist ? this.dist / this.homeDist : 1;
    const t = this.target.clone();
    this.fitHome();
    this.dist = this.homeDist * ratio;
    if (ratio < 0.95) this.target.copy(t);
    this.place();
  }
  home(): void {
    this.fitHome();
    this.dist = this.homeDist;
    this.place();
  }
  zoomBy(f: number): void {
    this.dist = Math.max(6, Math.min(this.homeDist * 1.6, this.dist / f));
    this.place();
  }
  focusAgent(id: string): void {
    const av = this.avatars.get(id);
    if (!av) return;
    this.target.set(av.g.position.x, 0, av.g.position.z);
    this.dist = Math.min(this.dist, 18);
    this.place();
  }
  setHighlight(dept: string | null): void {
    this.highlight = dept;
    if (this.lastWorld) this.sync(this.lastWorld, this.selection, this.lastNow);
  }
  setLinksMode(on: boolean): void {
    this.linksMode = on;
  }

  /** Cadrage : tout le plateau visible dans la zone libre entre les panneaux flottants. */
  private fitHome(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const { top, right, bottom, left } = this.insets;
    const fw = Math.max(0.3, (w - left - right) / w);
    const fh = Math.max(0.3, (h - top - bottom) / h);
    // Le centre de projection est décalé vers le milieu de la zone libre.
    this.cam.setViewOffset(w, h, -((left - right) / 2), -((top - bottom) / 2), w, h);
    this.cam.updateProjectionMatrix();
    const cx = (left - right) / w;
    const cy = (bottom - top) / h;
    const bb = this.bounds;
    this.target.set((bb.x0 + bb.x1) / 2, 0, (bb.z0 + bb.z1) / 2);
    const corners = [
      [bb.x0, bb.z0],
      [bb.x1, bb.z0],
      [bb.x0, bb.z1],
      [bb.x1, bb.z1],
    ] as const;
    let lo = 8;
    let hi = 200;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      this.dist = mid;
      this.place(false);
      const fits = corners.every(([x, z]) =>
        [0, 2.6].every((y) => {
          const p = this.v3.set(x, y, z).project(this.cam);
          return Math.abs(p.x - cx) <= fw * 0.98 && Math.abs(p.y - cy) <= fh * 0.98;
        }),
      );
      if (fits) hi = mid;
      else lo = mid;
    }
    this.homeDist = hi;
  }

  /** Une image n'est utile que si un avatar bouge ou s'anime (sinon : aucune charge). */
  private isAnimating(): boolean {
    if (this.reduced) return this.beams.length > 0;
    if (this.tour.on || this.beams.length || (this.motion === 'fluide' && this.vacuum)) return true;
    for (const av of this.avatars.values()) {
      if (!av.g.visible) continue;
      if (av.path.length) return true;
      const act = av.agent.activity;
      if (act === 'working' || act === 'using_tool' || act === 'thinking' || act === 'blocked')
        return true;
      if (av.intent?.life || av.intent?.mode === 'meeting' || av.intent?.mode === 'break')
        return true;
    }
    return false;
  }
  /* ---------- mode présentation : visite guidée des pôles actifs ---------- */
  private tour = {
    on: false,
    next: 0,
    idx: 0,
    goal: null as null | { x: number; z: number; az: number },
  };
  setTour(on: boolean): void {
    this.tour = { on, next: 0, idx: this.tour.idx, goal: null };
    if (!on) this.home();
    this.dirty = true;
  }
  private stepTour(t: number, dt: number): void {
    if (!this.tour.on) return;
    if (t >= this.tour.next) {
      // Prochain pôle : d'abord ceux où des agents travaillent, sinon tous les pôles à tour de rôle.
      const w = this.lastWorld;
      const rooms = (w?.departments ?? [])
        .map((d) => HQ_MAP.rooms.find((r) => r.id === d.roomId))
        .filter((r): r is Room => !!r);
      const busy = rooms.filter((r) =>
        (w?.agents ?? []).some(
          (a) =>
            ['working', 'using_tool', 'thinking'].includes(a.activity) &&
            HQ_MAP.anchors[a.deskAnchor]?.roomId === r.id,
        ),
      );
      const pool = busy.length ? busy : rooms;
      const room = pool[this.tour.idx++ % Math.max(1, pool.length)];
      if (room) {
        this.tour.goal = {
          x: (room.rect.x0 + room.rect.x1 + 1) / 2,
          z: (room.rect.y0 + room.rect.y1 + 1) / 2,
          az: this.tour.idx % 2 ? 0.35 : -0.35,
        };
      }
      this.tour.next = t + 8000;
    }
    const g = this.tour.goal;
    if (!g) return;
    const k = Math.min(1, dt * 0.9);
    this.target.x += (g.x - this.target.x) * k;
    this.target.z += (g.z - this.target.z) * k;
    this.az += (g.az - this.az) * k;
    this.el += (0.82 - this.el) * k;
    this.dist += (this.homeDist * 0.42 - this.dist) * k;
    this.place();
  }

  setMotion(m: 'eco' | 'fluide'): void {
    this.motion = m;
    this.dirty = true;
    this.resize();
  }
  setPaused(p: boolean): void {
    this.paused = p;
    this.dirty = true;
  }

  private place(full = true): void {
    this.dirty = true;
    const c = this.cam;
    c.position.set(
      this.target.x + this.dist * Math.cos(this.el) * Math.sin(this.az),
      this.dist * Math.sin(this.el),
      this.target.z + this.dist * Math.cos(this.el) * Math.cos(this.az),
    );
    c.lookAt(this.target);
    c.updateMatrixWorld();
    if (full) c.updateProjectionMatrix();
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.dirty = true;
    this.renderer.setPixelRatio(
      this.lowPower ? 0.75 : Math.min(window.devicePixelRatio, this.motion === 'eco' ? 1.25 : 2),
    );
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    const keep = this.dist / (this.homeDist || this.dist);
    this.fitHome();
    this.dist = this.homeDist * keep;
    this.place();
  }

  private applyLight(): void {
    const n = this.night;
    this.scene.background = new THREE.Color(n ? '#151826' : '#e9e2d8');
    this.hemi.intensity = n ? 0.35 : 1.7;
    this.hemi.color.set(n ? '#7f8fc8' : '#fffaf2');
    this.sun.intensity = n ? 0.45 : 2.6;
    this.sun.color.set(n ? '#9fb2ee' : '#fff3e0');
    this.lamps.forEach((l) => (l.intensity = n ? 9 : 0));
    this.lampShades.forEach((m) => m.emissive.set(n ? '#ffcf8a' : '#000000'));
    this.windows.forEach((m) => m.color.set(n ? '#22335c' : '#cfe8ff'));
    if (this.neon) this.neon.opacity = n ? 1 : 0.85;
  }

  // ------------------------------------------------------------------ interactions
  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        az: this.az,
        el: this.el,
        pan: e.button === 2 || e.shiftKey,
        moved: 0,
      };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.moved = Math.max(this.drag.moved, Math.abs(dx) + Math.abs(dy));
        if (this.drag.moved < 6) return;
        if (this.drag.pan) {
          const k = this.dist / 900;
          const ca = Math.cos(this.az);
          const sa = Math.sin(this.az);
          this.target.x -= (dx * ca + dy * sa) * k;
          this.target.z -= (-dx * sa + dy * ca) * k;
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
        } else {
          this.az = this.drag.az - dx * 0.005;
          this.el = Math.max(0.45, Math.min(1.35, this.drag.el + dy * 0.004));
        }
        this.place();
        return;
      }
      const av = this.pick(e);
      if (av !== this.hovered) {
        if (this.hovered) this.hovered.hovered = false;
        this.hovered = av;
        if (av) av.hovered = true;
        this.dirty = true;
        c.style.cursor = av ? 'pointer' : 'grab';
      }
    });
    c.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved >= 6) return;
      const av = this.pick(e);
      if (av) return this.cb.onSelect({ kind: 'agent', id: av.agent.id });
      const room = this.pickRoom(e);
      if (
        room &&
        room.startsWith('annex') &&
        !this.lastWorld?.departments.some((x) => x.roomId === room)
      )
        return this.cb.onEmptyRoom?.(room);
      this.cb.onSelect(null);
    });
    c.addEventListener('pointerleave', () => {
      if (this.hovered) this.hovered.hovered = false;
      this.hovered = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
    c.addEventListener('dblclick', () => this.home());
  }

  private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  }
  private pick(e: { clientX: number; clientY: number }): Avatar | null {
    this.ray.setFromCamera(this.ndc(e), this.cam);
    const groups = [...this.avatars.values()].filter((a) => a.g.visible).map((a) => a.g);
    const hit = this.ray.intersectObjects(groups, true).find((h) => h.object.userData['agentId']);
    const id = hit?.object.userData['agentId'] as string | undefined;
    return id ? (this.avatars.get(id) ?? null) : null;
  }
  private pickRoom(e: { clientX: number; clientY: number }): string | null {
    this.ray.setFromCamera(this.ndc(e), this.cam);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p))
      return null;
    return HQ_MAP.roomAt({ x: Math.floor(p.x), y: Math.floor(p.z) })?.id ?? null;
  }

  // ------------------------------------------------------------------ animation
  private frame(t: number): void {
    // Cadence plafonnée (≈30 img/s ; 8 en rendu logiciel) : le reste du temps va à l'interface.
    const minGap = this.lowPower || this.motion === 'eco' ? 125 : 33;
    const animating = this.isAnimating();
    if (this.paused || t - this.lastRender < minGap || (!animating && !this.dirty)) {
      if (!animating) this.last = t; // pas de saut d'animation à la reprise
      this.raf = requestAnimationFrame((x) => this.frame(x));
      return;
    }
    this.dirty = false;
    this.lastRender = t;
    const dt = Math.min(this.lowPower ? 0.15 : 0.05, (t - (this.last || t)) / 1000);
    this.last = t;
    for (const av of this.avatars.values()) {
      this.step(av, dt);
      this.pose(av, dt);
    }
    if (this.motion === 'fluide') this.stepVacuum(dt, t);
    this.stepTour(t, dt);
    for (let k = this.beams.length - 1; k >= 0; k--) {
      const b = this.beams[k]!;
      b.life -= dt;
      (b.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (b.life / 1.8) * 0.7);
      if (b.life <= 0) {
        this.world.remove(b.m);
        this.beams.splice(k, 1);
      }
    }
    this.renderer.render(this.scene, this.cam);
    this.overlay(t);
    this.raf = requestAnimationFrame((x) => this.frame(x));
  }

  private step(av: Avatar, dt: number): void {
    const face = av.face;
    if (!av.path.length) {
      if (face !== null) {
        let d = face - av.g.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        av.g.rotation.y += d * Math.min(1, dt * 10);
      }
      return;
    }
    const p = av.path[0]!;
    const pos = av.g.position;
    const dx = p.x - pos.x;
    const dz = p.z - pos.z;
    const d = Math.hypot(dx, dz);
    const sp = SPEED * dt;
    if (d <= sp) {
      pos.x = p.x;
      pos.z = p.z;
      av.path.shift();
      return;
    }
    pos.x += (dx / d) * sp;
    pos.z += (dz / d) * sp;
    let diff = Math.atan2(dx, dz) - av.g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    av.g.rotation.y += diff * Math.min(1, dt * 12);
  }

  private pose(av: Avatar, dt: number): void {
    av.t += dt;
    const t = this.reduced ? 0 : av.t;
    av.legL.rotation.set(0, 0, 0);
    av.legR.rotation.set(0, 0, 0);
    av.armL.rotation.set(0, 0, 0);
    av.armR.rotation.set(0, 0, 0);
    av.body.position.y = 0;
    av.head.rotation.set(0, 0, 0);
    if (av.halo.visible)
      (av.halo.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 6) * 0.3;
    if (av.path.length) {
      const s = Math.sin(t * 10);
      av.legL.rotation.x = s * 0.55;
      av.legR.rotation.x = -s * 0.55;
      av.armL.rotation.x = -s * 0.45;
      av.armR.rotation.x = s * 0.45;
      av.body.position.y = Math.abs(Math.cos(t * 10)) * 0.03;
      return;
    }
    const it = av.intent;
    const sit = (): void => {
      av.body.position.y = -0.06;
      av.legL.rotation.x = av.legR.rotation.x = -Math.PI / 2;
    };
    if (!it) return;
    if (it.mode === 'desk' && it.life === 'stretch') {
      av.armL.rotation.x = av.armR.rotation.x = -Math.PI + Math.sin(t * 3) * 0.2;
      return;
    }
    if (it.life === 'plants') {
      av.armR.rotation.x = -1.2;
      av.head.rotation.x = 0.3;
      return;
    }
    if (it.mode === 'desk' || it.mode === 'meeting') {
      sit();
      const act = av.agent.activity;
      if (it.mode === 'desk' && (act === 'working' || act === 'using_tool' || act === 'thinking')) {
        const f = act === 'using_tool' ? 22 : 16;
        av.armL.rotation.x = -1.25 + Math.sin(t * f) * 0.07;
        av.armR.rotation.x = -1.25 + Math.cos(t * f) * 0.07;
        av.head.rotation.x = 0.08;
      } else if (it.life === 'read') {
        av.armL.rotation.x = av.armR.rotation.x = -1.0;
        av.armL.rotation.z = -0.3;
        av.armR.rotation.z = 0.3;
        av.head.rotation.x = 0.3;
      } else if (it.mode === 'meeting') {
        av.armR.rotation.x = Math.sin(t * 0.7 + av.t) > 0.6 ? -0.9 + Math.sin(t * 6) * 0.3 : -0.4;
        av.head.rotation.y = Math.sin(t * 0.5 + av.t) * 0.3;
      } else {
        av.armL.rotation.x = av.armR.rotation.x = -0.5;
        av.head.rotation.y = Math.sin(t * 0.5 + av.t) * 0.3;
      }
      return;
    }
    if (it.life === 'chat') {
      av.armR.rotation.x = Math.sin(t * 4 + av.t) > 0.3 ? -0.8 + Math.sin(t * 7) * 0.2 : 0;
      av.head.rotation.y = Math.sin(t * 1.3) * 0.15;
      return;
    }
    if (it.mode === 'break') {
      av.armR.rotation.x = Math.sin(t * 0.9) > 0.55 ? -2.1 : -0.8;
      return;
    }
    av.head.rotation.y = Math.sin(t * 0.6 + av.t) * 0.25;
  }

  /** Bulles, noms, pastilles et liens : couche HTML projetée sur la scène. */
  private overlay(t: number): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const proj = (x: number, y: number, z: number): [number, number, boolean] => {
      const p = this.v3.set(x, y, z).project(this.cam);
      return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h, p.z < 1];
    };
    const sel = this.selection?.kind === 'agent' ? this.selection.id : null;
    const active = (this.lastWorld?.invocations ?? [])
      .filter((i) => ['requested', 'authorized', 'running', 'waiting_approval'].includes(i.status))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    const shown = sel ? active.filter((i) => i.agentId === sel) : this.linksMode ? active : [];
    const drawn = shown.slice(0, 5);
    this.drawnLinks = drawn.map((i) => ({ agentId: i.agentId, toolId: i.toolId }));
    this.hiddenLinks = Math.max(0, shown.length - 5);
    const tools = new Map((this.lastWorld?.tools ?? []).map((x) => [x.id, x]));
    for (const av of this.avatars.values()) {
      const vis = av.g.visible;
      const [x, y, inFront] = proj(av.g.position.x, 1.75, av.g.position.z);
      const show = vis && inFront;
      const focus = av.hovered || sel === av.agent.id;
      if (av.bubbleText && show) {
        const full =
          focus ||
          t - av.bubbleSince < 4000 ||
          av.bubbleKind === 'alert' ||
          av.bubbleKind === 'danger';
        const txt = full ? av.bubbleText : (av.bubbleText.split(' ')[0] ?? av.bubbleText);
        if (av.bubble.textContent !== txt) av.bubble.textContent = txt;
        const cls = `studio-bubble ${av.bubbleKind}`;
        if (av.bubble.className !== cls) av.bubble.className = cls;
        av.bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        av.bubble.style.opacity = String(av.alpha);
        av.bubble.hidden = false;
      } else av.bubble.hidden = true;
      av.who.hidden = !(show && focus);
      if (!av.who.hidden) {
        const [nx, ny] = proj(av.g.position.x, 0, av.g.position.z);
        const dept = this.lastWorld?.departments.find((d) => d.id === av.agent.departmentId);
        const html = `<i style="background:${dept?.color ?? '#7c60c9'}"></i>${av.agent.name}<span>· ${stateLabel(av.agent, av.intent)}</span>`;
        if (av.who.innerHTML !== html) av.who.innerHTML = html;
        av.who.style.transform = `translate(${nx}px, ${ny + 8}px) translate(-50%, 0)`;
      }
      const link = drawn.find((l) => l.agentId === av.agent.id);
      av.link.hidden = !(link && show);
      if (link && show) {
        const tool = tools.get(link.toolId);
        const [lx, ly] = proj(av.g.position.x, 2.6, av.g.position.z);
        av.link.textContent = `⇢ ${tool?.name ?? link.toolId}`;
        av.link.style.setProperty('--c', tool?.color ?? '#7c60c9');
        av.link.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -100%)`;
      }
    }
    // Taille des pastilles selon le zoom : compactes (nom seul) quand le plateau est petit.
    const [ax, ay] = proj(W / 2, 0, D / 2);
    const [bx, by] = proj(W / 2 + 1, 0, D / 2);
    const tilePx = Math.hypot(bx - ax, by - ay);
    const sc = Math.max(0.8, Math.min(1, tilePx / 34));
    const compact = tilePx < 30;
    for (const room of HQ_MAP.rooms) {
      const pill = this.roomPills.get(room.id);
      if (!pill) continue;
      const zone = room.kind === 'department' && !room.walls;
      const [x, y, ok] = proj(
        (room.rect.x0 + room.rect.x1 + 1) / 2 + (zone ? 1.5 : 0),
        zone ? 0.1 : 1.3,
        zone ? room.rect.y0 + 0.45 : (room.rect.y0 + room.rect.y1 + 1) / 2,
      );
      pill.hidden = !ok;
      pill.classList.toggle('compact', compact);
      pill.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${sc.toFixed(2)})`;
    }
    if (!this.meetingPill.hidden) {
      const seat = HQ_MAP.anchors['meeting-seat-01'];
      if (seat) {
        const [x, y] = proj(seat.x + 2, 2.2, seat.y + 2);
        this.meetingPill.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    }
  }

  // ------------------------------------------------------------------ hooks
  agentScreenPosition(id: string): { x: number; y: number } | null {
    const av = this.avatars.get(id);
    if (!av || !av.g.visible) return null;
    const p = this.v3.set(av.g.position.x, 0.85, av.g.position.z).project(this.cam);
    return {
      x: ((p.x + 1) / 2) * this.host.clientWidth,
      y: ((1 - p.y) / 2) * this.host.clientHeight,
    };
  }
  agentAlpha(id: string): number | null {
    return this.avatars.get(id)?.alpha ?? null;
  }
  isWalking(id: string): boolean {
    return (this.avatars.get(id)?.path.length ?? 0) > 0;
  }
}

/** Rendu WebGL logiciel (SwiftShader, llvmpipe…) : pas de carte graphique utilisable. */
export function softwareRenderer(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|softpipe/i.test(name);
  } catch {
    return false;
  }
}

/** WebGL disponible ? Sinon le QG bascule sur le rendu 2D classique. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
