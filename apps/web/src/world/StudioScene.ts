import * as THREE from 'three';
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
import { appearanceOf, bubbleFor, pastel, stateLabel, studioPath } from './studio';
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
const K = (r: number, l: number) => geo(`k${r}:${l}`, () => new THREE.CapsuleGeometry(r, l, 5, 12));

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
  private bounds = { x0: 0, z0: 0, x1: W, z1: 28.2 };
  private boundsKey = '';
  private night = false;
  private reduced = false;
  private raf = 0;
  private lowPower = false;
  private lastRender = 0;
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
  private wallBands = new Map<string, THREE.MeshStandardMaterial>();
  private wallSigns = new Map<string, THREE.Mesh>();
  private signNames = new Map<string, string>();
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
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 30,
      bottom: -30,
      near: 2,
      far: 110,
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
    // Socle et parquet à bâtons rompus (couloirs).
    mesh(B(W + 0.6, 0.3, D + 0.6), std('#d8cfc3'), W / 2, -0.16, D / 2, w);
    const parquet = canvasTex(
      128,
      128,
      (g) => {
        g.fillStyle = '#e3bd85';
        g.fillRect(0, 0, 128, 128);
        const tones = ['#e6c08a', '#dcb37a', '#e9c793', '#d9ae73'];
        for (let y = -32; y < 160; y += 16)
          for (let x = -32; x < 160; x += 32) {
            g.save();
            g.translate(x + ((y / 16) % 2 ? 16 : 0), y);
            g.rotate(Math.PI / 4);
            g.fillStyle = tones[((x + y) / 16) & 3] ?? '#e3bd85';
            g.fillRect(0, 0, 30, 9);
            g.strokeStyle = 'rgba(120,80,40,.18)';
            g.strokeRect(0, 0, 30, 9);
            g.restore();
          }
      },
      [W / 3, D / 3],
    );
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ map: parquet, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, D / 2);
    floor.receiveShadow = true;
    w.add(floor);
    // Murs extérieurs : fond haut, côtés bas, façade basse.
    mesh(B(W + 0.5, 2.6, 0.3), std('#efe6da'), W / 2, 1.3, -0.15, w);
    mesh(B(W + 0.6, 0.1, 0.4), std('#d5c8b6'), W / 2, 2.65, -0.15, w);
    mesh(B(0.3, 1.0, D), std('#efe6da'), -0.15, 0.5, D / 2, w);
    mesh(B(0.3, 1.0, D), std('#efe6da'), W + 0.15, 0.5, D / 2, w);
    mesh(B(W + 0.6, 0.45, 0.3), std('#efe6da'), W / 2, 0.22, D + 0.15, w);
    // Mur du fond : bandeau aux couleurs des pôles, enseigne peinte, grandes baies vitrées.
    for (const room of HQ_MAP.rooms.filter((r) => r.rect.y0 <= 1)) {
      const { x0, x1 } = room.rect;
      const band = new THREE.MeshStandardMaterial({
        color: pastel(room.color, 0.45),
        roughness: 0.9,
      });
      mesh(B(x1 - x0 + 0.9, 1.35, 0.04), band, (x0 + x1 + 1) / 2, 1.55, 0.02, w, false);
      this.wallBands.set(room.id, band);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 0.75),
        new THREE.MeshStandardMaterial({ transparent: true, map: this.signTex(room.label) }),
      );
      sign.position.set(x0 + 2.8, 1.92, 0.05);
      w.add(sign);
      this.wallSigns.set(room.id, sign);
      for (let x = x0 + 6; x <= x1 - 1; x += 3) {
        const glass = new THREE.MeshBasicMaterial({ color: '#cfe8ff' });
        this.windows.push(glass);
        mesh(B(2.2, 0.9, 0.03), std('#7b6a58'), x, 1.65, 0.05, w, false);
        mesh(B(2.08, 0.8, 0.03), glass, x, 1.65, 0.07, w, false);
      }
    }
    for (const room of HQ_MAP.rooms) this.buildRoom(room);
    for (const f of HQ_MAP.furniture) this.buildFurniture(f);
    this.buildMeetingTable();
    for (const a of Object.values(HQ_MAP.anchors)) {
      if (a.kind === 'desk') this.deskChair(a);
      if (a.kind === 'meeting_seat') this.meetingChair(a);
    }
  }

  private buildRoom(room: Room): void {
    const { x0, y0, x1, y1 } = room.rect;
    const w = x1 - x0 + 1;
    const d = y1 - y0 + 1;
    const base = room.kind === 'department' ? room.color : room.color;
    const m = new THREE.MeshStandardMaterial({
      roughness: 0.92,
      color: '#ffffff',
      map: canvasTex(
        64,
        64,
        (g) => {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, 64, 64);
          g.fillStyle = '#f1f1f1';
          g.fillRect(0, 0, 32, 32);
          g.fillRect(32, 32, 32, 32);
        },
        [w / 2, d / 2],
      ),
    });
    m.color.set(pastel(base, 0.45));
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x0 + w / 2, 0.01, y0 + d / 2);
    plane.receiveShadow = true;
    plane.userData['roomId'] = room.id;
    this.world.add(plane);
    this.roomFloors.set(room.id, m);
    // Cloisons basses le long des murs du local, portes ouvertes.
    if (room.walls) {
      const doors = new Set(room.doors.map((t) => `${t.x},${t.y}`));
      const wall = std('#f6f1e9', 0.7);
      const cap = std('#d9c9b2', 0.6);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const edge = x === x0 || x === x1 || y === y0 || y === y1;
          if (!edge || doors.has(`${x},${y}`)) continue;
          const horiz = y === y0 || y === y1;
          const back = y === y0 && y0 <= 1;
          const h = back ? 1.6 : 0.42;
          mesh(
            B(horiz ? 1 : 0.16, h, horiz ? 0.16 : 1),
            wall,
            x + 0.5,
            h / 2,
            y + (y === y0 ? 0.2 : y === y1 ? 0.8 : 0.5),
            this.world,
          );
          if (!back)
            mesh(
              B(horiz ? 1 : 0.2, 0.04, horiz ? 0.2 : 1),
              cap,
              x + 0.5,
              h + 0.02,
              y + (y === y0 ? 0.2 : y === y1 ? 0.8 : 0.5),
              this.world,
            );
        }
    }
    // Étiquette « pastille » du local (nom réel du pôle, mis à jour au sync).
    const pill = document.createElement('button');
    pill.className = 'studio-zone';
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
    const w = this.world;
    switch (f.kind) {
      case 'desk': {
        // Îlot : l'écran regarde le siège, cloison verte côté opposé (postes dos à dos).
        const seat = Object.values(HQ_MAP.anchors).find(
          (a) => a.kind === 'desk' && a.facing?.x === f.x && a.facing.y === f.y,
        );
        const dir = seat ? Math.sign(seat.y - f.y) || 1 : 1; // +1 : siège côté +z
        const back = z - dir * 0.47;
        mesh(B(0.98, 0.05, 0.86), std('#f6f4f0', 0.6), x, 0.75, z, w);
        mesh(B(0.05, 0.73, 0.8), std('#c99a62'), x - 0.47, 0.37, z, w);
        mesh(B(0.05, 0.73, 0.8), std('#c99a62'), x + 0.47, 0.37, z, w);
        mesh(B(1.0, 0.38, 0.04), std('#4f7a62', 0.9), x, 0.96, back, w);
        mesh(B(0.56, 0.34, 0.04), std('#25272d', 0.4), x, 1.03, back + dir * 0.14, w);
        mesh(B(0.06, 0.18, 0.06), std('#25272d'), x, 0.86, back + dir * 0.12, w);
        const sm = new THREE.MeshBasicMaterial({ color: '#2a3442' });
        mesh(B(0.5, 0.28, 0.01), sm, x, 1.03, back + dir * 0.165, w, false);
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
      default:
        break;
    }
  }

  private signTex(name: string): THREE.CanvasTexture {
    return canvasTex(512, 84, (g) => {
      g.fillStyle = '#3a3530';
      g.font = '700 44px Inter, system-ui, sans-serif';
      g.fillText(name.toUpperCase().slice(0, 22), 6, 48);
      g.fillStyle = '#7a7168';
      g.font = '400 20px Inter, system-ui, sans-serif';
      g.fillText('Pôle · espace ouvert', 8, 76);
    });
  }

  private plant(x: number, z: number, size: number, pot: string): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.world.add(g);
    mesh(C(0.2 * size, 0.16 * size, 0.38 * size, 14), std(pot), 0, 0.19 * size, 0, g);
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + size * 3;
      const leaf = mesh(
        S(0.2 * size),
        new THREE.MeshStandardMaterial({
          color: k % 2 ? '#4f9a57' : '#3f8a4a',
          roughness: 0.8,
          flatShading: true,
        }),
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
    mesh(C(0.06, 0.07, 0.02, 10), std('#2f2f33'), x, 0.79, z, this.world);
    mesh(C(0.012, 0.012, 0.3, 6), std('#2f2f33'), x, 0.93, z, this.world);
    const m = new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.7 });
    this.lampShades.push(m);
    mesh(C(0.05, 0.08, 0.08, 10), m, x, 1.08, z, this.world);
  }
  private tree(f: Furniture): void {
    const { cx, cz, w } = this.group(f);
    const r = w * 0.62;
    mesh(C(r, r, 0.5, 32), std('#f4f0ea', 0.6), cx, 0.25, cz, this.world);
    mesh(C(r - 0.12, r - 0.12, 0.04, 32), std('#5b4330'), cx, 0.51, cz, this.world);
    mesh(C(0.1, 0.14, 2.2, 8), std('#7a5a3c'), cx, 1.5, cz, this.world);
    for (const [dx, y, dz, rr] of [
      [0, 2.8, 0, 0.85],
      [0.45, 2.45, 0.3, 0.65],
      [-0.45, 2.5, -0.2, 0.7],
      [0.1, 3.3, -0.25, 0.6],
      [-0.2, 2.2, 0.45, 0.55],
    ] as const)
      mesh(
        geo(`ico${rr}`, () => new THREE.IcosahedronGeometry(rr, 1)),
        new THREE.MeshStandardMaterial({ color: '#4e9a52', flatShading: true, roughness: 0.8 }),
        cx + dx,
        y,
        cz + dz,
        this.world,
      );
    // Banquettes rayonnantes autour de la jardinière.
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const g = new THREE.Group();
      g.position.set(cx + Math.sin(a) * (r + 0.28), 0, cz + Math.cos(a) * (r + 0.28));
      g.rotation.y = a;
      this.world.add(g);
      mesh(B(0.3, 0.07, 0.42), std('#e8d2ad', 0.8), 0, 0.36, 0, g);
      mesh(B(0.24, 0.32, 0.05), std('#d7bf98'), 0, 0.16, 0, g);
    }
  }
  private booth(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.world.add(g);
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
    mesh(B(w - 0.1, 0.05, 0.7), std('#e9d3b0', 0.6), cx, 1.05, cz, this.world);
    mesh(B(0.06, 1.0, 0.5), std('#cfc3b0'), cx - w / 2 + 0.2, 0.52, cz, this.world);
    mesh(B(0.06, 1.0, 0.5), std('#cfc3b0'), cx + w / 2 - 0.2, 0.52, cz, this.world);
    for (let k = 0; k < w; k++) {
      const sx = f.x + k + 0.5;
      for (const dz of [-0.62, 0.62]) {
        mesh(C(0.15, 0.15, 0.05, 14), std('#e08a5a'), sx, 0.72, cz + dz, this.world);
        mesh(C(0.025, 0.025, 0.7, 6), std('#3a3a3e'), sx, 0.36, cz + dz, this.world);
      }
    }
  }
  private pingpong(f: Furniture): void {
    const { cx, cz, w } = this.group(f);
    mesh(B(w - 0.15, 0.05, 0.95), std('#2f6f5a', 0.6), cx, 0.76, cz, this.world);
    mesh(B(0.03, 0.12, 0.95), std('#f4f4f4'), cx, 0.84, cz, this.world);
    mesh(B(w - 0.15, 0.006, 0.02), std('#ffffff'), cx, 0.79, cz, this.world);
    for (const [dx, dz] of [
      [-0.8, -0.38],
      [0.8, -0.38],
      [-0.8, 0.38],
      [0.8, 0.38],
    ] as const)
      mesh(B(0.05, 0.74, 0.05), std('#2f2f33'), cx + dx, 0.37, cz + dz, this.world);
    mesh(S(0.035), std('#ffffff', 0.4), cx + 0.4, 0.82, cz + 0.1, this.world);
  }
  private armchair(x: number, z: number, c: string): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI;
    this.world.add(g);
    mesh(B(0.74, 0.34, 0.68), std(c, 0.9), 0, 0.24, 0, g);
    mesh(B(0.74, 0.46, 0.16), std(c, 0.9), 0, 0.58, -0.27, g);
    mesh(B(0.13, 0.22, 0.62), std(shade(c, -0.04)), -0.32, 0.48, 0.02, g);
    mesh(B(0.13, 0.22, 0.62), std(shade(c, -0.04)), 0.32, 0.48, 0.02, g);
    mesh(B(0.48, 0.07, 0.46), std(shade(c, 0.05), 0.95), 0, 0.44, 0.05, g);
  }
  private roundTable(f: Furniture): void {
    const { cx, cz } = this.group(f);
    const room = HQ_MAP.rooms.find((r) => r.id === f.roomId);
    this.rug(cx, cz, 3, 3, shade(room?.color ?? '#9fb2dc', 0.08));
    mesh(C(0.62, 0.62, 0.05, 28), std('#e9d5b2', 0.6), cx, 0.74, cz, this.world);
    mesh(C(0.05, 0.05, 0.7, 10), std('#cfc3b0'), cx, 0.37, cz, this.world);
    mesh(B(0.32, 0.02, 0.22), std('#d9dbe0', 0.4), cx + 0.12, 0.78, cz - 0.05, this.world);
    mesh(B(0.2, 0.005, 0.28), std('#ffffff', 0.9), cx - 0.25, 0.775, cz + 0.15, this.world);
    const chair = shade(room?.color ?? '#a9bde6', 0.05);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const g = new THREE.Group();
      g.position.set(cx + Math.sin(a) * 0.95, 0, cz + Math.cos(a) * 0.95);
      g.rotation.y = a + Math.PI;
      this.world.add(g);
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
    mesh(B(x1 - x0 - 0.1, 0.06, y1 - y0 - 0.5), std('#7a5640', 0.6), cx, 0.75, cz, this.world);
    mesh(B(0.12, 0.72, 0.8), std('#5d4232'), x0 + 0.5, 0.36, cz, this.world);
    mesh(B(0.12, 0.72, 0.8), std('#5d4232'), x1 - 0.5, 0.36, cz, this.world);
    for (let x = x0 + 0.5; x < x1; x += 1)
      mesh(B(0.22, 0.01, 0.28), std('#ffffff', 0.9), x, 0.785, cz - 0.25, this.world);
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
    this.world.add(m);
  }

  private chairAt(x: number, z: number, rot: number, color: string): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.world.add(g);
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
  private makeAvatar(agent: AgentView, at: { x: number; z: number }): Avatar {
    const ap = appearanceOf(agent.avatarId);
    const mats: THREE.MeshStandardMaterial[] = [];
    const m = (c: string, r = 0.85): THREE.MeshStandardMaterial => {
      const x = new THREE.MeshStandardMaterial({ color: c, roughness: r });
      mats.push(x);
      return x;
    };
    const skin = m(ap.skin, 0.7);
    const top = m(ap.top);
    const pants = m(ap.pants);
    const hair = m(ap.hair, 0.9);
    const shoe = m('#2a2522', 0.6);
    const eye = m('#1d1a18', 0.4);
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const hip = 0.53;
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    legL.position.set(-0.085, hip, 0);
    legR.position.set(0.085, hip, 0);
    for (const l of [legL, legR]) {
      mesh(K(0.072, 0.36), pants, 0, -0.25, 0, l);
      mesh(B(0.12, 0.07, 0.2), shoe, 0, -0.5, 0.04, l);
      body.add(l);
    }
    const torso = mesh(K(0.165, 0.28), top, 0, 0.82, 0, body);
    torso.scale.set(1, 1, 0.72);
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    armL.position.set(-0.215, 1.0, 0);
    armR.position.set(0.215, 1.0, 0);
    for (const a of [armL, armR]) {
      mesh(K(0.052, 0.32), top, 0, -0.19, 0, a);
      mesh(S(0.05), skin, 0, -0.4, 0, a);
      body.add(a);
    }
    const head = new THREE.Group();
    head.position.y = 1.25;
    body.add(head);
    mesh(S(0.13), skin, 0, 0, 0, head);
    mesh(C(0.05, 0.05, 0.08, 10), skin, 0, -0.13, 0, head);
    const cap = mesh(
      geo('hair', () => new THREE.SphereGeometry(0.138, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)),
      hair,
      0,
      0.012,
      -0.008,
      head,
    );
    cap.rotation.x = -0.25;
    if (ap.style === 1) mesh(K(0.11, 0.14), hair, 0, -0.1, -0.07, head).scale.set(1.1, 1, 0.6);
    if (ap.style === 2) mesh(S(0.06), hair, 0, 0.08, -0.14, head);
    mesh(S(0.017), eye, -0.045, 0.01, 0.122, head);
    mesh(S(0.017), eye, 0.045, 0.01, 0.122, head);
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
        av = this.makeAvatar(agent, start);
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
      av.ring.visible = sel?.kind === 'agent' && sel.id === agent.id;
      this.setAlpha(av, this.highlight && agent.departmentId !== this.highlight ? 0.3 : 1);
    });
    for (const id of [...this.avatars.keys()])
      if (!world.agents.some((a) => a.id === id)) this.removeAvatar(id);
    // Écrans des postes : état réel de l'agent assis à son bureau.
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
      sm.color.set(
        act === 'using_tool' && tool
          ? tool.color
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
      const band = this.wallBands.get(room.id);
      if (band) band.color.set(pastel(color, 0.45));
      const sign = this.wallSigns.get(room.id);
      if (sign && this.signNames.get(room.id) !== name) {
        this.signNames.set(room.id, name);
        const mat = sign.material as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.map = this.signTex(name);
        mat.needsUpdate = true;
      }
      floor?.color.set(
        pastel(dept?.color ?? (room.id.startsWith('annex') ? '#d9d4e0' : room.color), 0.45),
      );
    }
    // Cadrage : l'aile d'extension n'est incluse que si un pôle y est installé.
    const annexUsed = world.departments.some((d) => d.roomId.startsWith('annex'));
    const key = annexUsed ? 'all' : 'core';
    if (key !== this.boundsKey) {
      this.boundsKey = key;
      this.bounds = { x0: 0, z0: 0, x1: W, z1: annexUsed ? D : 28.2 };
      this.home();
    }
    const m = world.meetings.find((x) => x.status === 'in_progress');
    this.meetingPill.hidden = !m;
    if (m) {
      this.meetingPill.textContent = `◎ ${m.topic}`;
      this.meetingPill.onclick = () => this.cb.onSelect({ kind: 'meeting', id: m.id });
    }
    this.firstSync = false;
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

  private place(full = true): void {
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
    this.renderer.setPixelRatio(this.lowPower ? 0.75 : Math.min(window.devicePixelRatio, 2));
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
    const minGap = this.lowPower ? 125 : 30;
    if (t - this.lastRender < minGap) {
      this.raf = requestAnimationFrame((x) => this.frame(x));
      return;
    }
    this.lastRender = t;
    const dt = Math.min(this.lowPower ? 0.15 : 0.05, (t - (this.last || t)) / 1000);
    this.last = t;
    for (const av of this.avatars.values()) {
      this.step(av, dt);
      this.pose(av, dt);
    }
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
      const [x, y, ok] = proj(
        (room.rect.x0 + room.rect.x1 + 1) / 2 + 1.5,
        0.1,
        room.rect.y0 + 0.45,
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
