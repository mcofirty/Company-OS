import * as Phaser from 'phaser';
import { HQ_MAP, type Furniture, type Room, type Tile } from '@company-os/world';
import { darken, hex, lighten, makeCanvas, mix } from './textures';

/**
 * Décor du QG dessiné procéduralement (art original, aucun asset tiers) dans des textures
 * générées UNE fois : sol + murs du bâtiment cuits dans une seule image, mobilier et cloisons
 * en petites textures partagées. Au rendu, le monde n'est plus qu'une liste d'images (aucun
 * Graphics retracé à chaque frame), ce qui laisse de la marge pour plus de détails.
 */

const TW = HQ_MAP.tileWidth;
const TH = HQ_MAP.tileHeight;
const HW = TW / 2;
const HH = TH / 2;
/** Résolution des textures de décor (net quand on zoome, filtrage linéaire quand on dézoome). */
export const RES = 2;
const FLOOR_RES = 1.5;
export const WALL_H = 120;

const rgba = (c: number, a = 1): string =>
  `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

type Pt = [number, number];

/** Pinceau isométrique sur un canvas : (u, v) en tuiles, z en px vers le haut. */
class Iso {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly ox: number,
    readonly oy: number,
    readonly s: number,
  ) {}
  pt(u: number, v: number, z = 0): Pt {
    return [(this.ox + (u - v) * HW) * this.s, (this.oy + (u + v) * HH - z) * this.s];
  }
  poly(pts: Pt[], fill: number | string | CanvasGradient, alpha = 1): void {
    const c = this.ctx;
    c.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    c.closePath();
    c.fillStyle = typeof fill === 'number' ? rgba(fill, alpha) : fill;
    c.fill();
  }
  line(a: Pt, b: Pt, color: number, w = 1, alpha = 1): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.strokeStyle = rgba(color, alpha);
    c.lineWidth = w * this.s;
    c.stroke();
  }
  /** Parallélépipède : faces +v (gauche écran), +u (droite écran), dessus. */
  box(
    u: number,
    v: number,
    w: number,
    d: number,
    z: number,
    h: number,
    base: number,
    top?: number,
    edge = true,
  ): void {
    const L = darken(base, 0.86);
    const R = darken(base, 0.72);
    const T = top ?? lighten(base, 0.12);
    this.poly(
      [
        this.pt(u, v + d, z),
        this.pt(u + w, v + d, z),
        this.pt(u + w, v + d, z + h),
        this.pt(u, v + d, z + h),
      ],
      L,
    );
    this.poly(
      [
        this.pt(u + w, v, z),
        this.pt(u + w, v + d, z),
        this.pt(u + w, v + d, z + h),
        this.pt(u + w, v, z + h),
      ],
      R,
    );
    this.poly(
      [
        this.pt(u, v, z + h),
        this.pt(u + w, v, z + h),
        this.pt(u + w, v + d, z + h),
        this.pt(u, v + d, z + h),
      ],
      T,
    );
    // arête claire du dessus (lisibilité pixel)
    if (edge)
      this.line(this.pt(u, v + d, z + h), this.pt(u + w, v + d, z + h), lighten(T, 0.4), 1, 0.7);
  }
  /** Face verticale dans le plan v = const (tournée vers +v). */
  faceV(u0: number, u1: number, v: number, z0: number, z1: number, fill: number, alpha = 1): void {
    this.poly(
      [this.pt(u0, v, z0), this.pt(u1, v, z0), this.pt(u1, v, z1), this.pt(u0, v, z1)],
      fill,
      alpha,
    );
  }
  /** Face verticale dans le plan u = const (tournée vers +u). */
  faceU(v0: number, v1: number, u: number, z0: number, z1: number, fill: number, alpha = 1): void {
    this.poly(
      [this.pt(u, v0, z0), this.pt(u, v1, z0), this.pt(u, v1, z1), this.pt(u, v0, z1)],
      fill,
      alpha,
    );
  }
  /** Disque horizontal (cercle iso) de rayon r tuiles. */
  disc(u: number, v: number, z: number, r: number, fill: number, alpha = 1): void {
    const [x, y] = this.pt(u, v, z);
    const c = this.ctx;
    c.beginPath();
    c.ellipse(x, y, r * HW * Math.SQRT2 * this.s, r * HH * Math.SQRT2 * this.s, 0, 0, Math.PI * 2);
    c.fillStyle = rgba(fill, alpha);
    c.fill();
  }
  /** Cylindre vertical. */
  cyl(u: number, v: number, z: number, h: number, r: number, base: number, top?: number): void {
    const [x, y0] = this.pt(u, v, z);
    const [, y1] = this.pt(u, v, z + h);
    const rx = r * HW * Math.SQRT2 * this.s;
    const ry = r * HH * Math.SQRT2 * this.s;
    const c = this.ctx;
    const g = c.createLinearGradient(x - rx, 0, x + rx, 0);
    g.addColorStop(0, rgba(lighten(base, 0.12)));
    g.addColorStop(0.55, rgba(base));
    g.addColorStop(1, rgba(darken(base, 0.72)));
    c.beginPath();
    c.ellipse(x, y0, rx, ry, 0, 0, Math.PI);
    c.lineTo(x - rx, y1);
    c.ellipse(x, y1, rx, ry, 0, Math.PI, 0, true);
    c.closePath();
    c.fillStyle = g;
    c.fill();
    c.beginPath();
    c.ellipse(x, y1, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = rgba(top ?? lighten(base, 0.2));
    c.fill();
  }
  /** Ombre portée douce au sol. */
  shadow(u: number, v: number, r: number, alpha = 0.16, squash = 1): void {
    const [x, y] = this.pt(u, v, 0);
    const c = this.ctx;
    const rx = r * HW * Math.SQRT2 * this.s;
    const ry = r * HH * Math.SQRT2 * this.s * squash;
    const g = c.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, `rgba(42,30,64,${alpha})`);
    g.addColorStop(0.7, `rgba(42,30,64,${alpha * 0.7})`);
    g.addColorStop(1, 'rgba(42,30,64,0)');
    c.save();
    c.translate(x, y);
    c.scale(1, ry / rx);
    c.translate(-x, -y);
    c.beginPath();
    c.arc(x, y, rx, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    c.restore();
  }
  blob(x: number, y: number, r: number, fill: number): void {
    const c = this.ctx;
    c.beginPath();
    c.arc((this.ox + x) * this.s, (this.oy + y) * this.s, r * this.s, 0, Math.PI * 2);
    c.fillStyle = rgba(fill);
    c.fill();
  }
  leaf(x: number, y: number, len: number, wid: number, angle: number, fill: number): void {
    const c = this.ctx;
    c.save();
    c.translate((this.ox + x) * this.s, (this.oy + y) * this.s);
    c.rotate(angle);
    c.beginPath();
    c.ellipse(len * 0.5 * this.s, 0, len * 0.5 * this.s, wid * 0.5 * this.s, 0, 0, Math.PI * 2);
    c.fillStyle = rgba(fill);
    c.fill();
    c.restore();
  }
  rrect(x: number, y: number, w: number, h: number, r: number, fill: number, alpha = 1): void {
    const c = this.ctx;
    c.beginPath();
    c.roundRect((this.ox + x) * this.s, (this.oy + y) * this.s, w * this.s, h * this.s, r * this.s);
    c.fillStyle = rgba(fill, alpha);
    c.fill();
  }
}

export interface DecorSprite {
  key: string;
  originX: number;
  originY: number;
  scale: number;
}

interface Spec {
  w: number;
  h: number;
  ax: number;
  ay: number;
}
const TILE_SPEC: Spec = { w: 132, h: 150, ax: 66, ay: 112 };

/** Sprites de décor en attente d'empaquetage dans l'atlas (une seule texture GPU). */
const pending = new WeakMap<Phaser.Scene, Map<string, HTMLCanvasElement>>();
export const DECOR_TEX = 'decor';

function texture(
  scene: Phaser.Scene,
  key: string,
  spec: Spec,
  draw: (c: Iso) => void,
): DecorSprite {
  let items = pending.get(scene);
  if (!items) {
    items = new Map();
    pending.set(scene, items);
  }
  if (!items.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(spec.w * RES);
    canvas.height = Math.ceil(spec.h * RES);
    const ctx = canvas.getContext('2d');
    if (ctx) draw(new Iso(ctx, spec.ax, spec.ay, RES));
    items.set(key, canvas);
  }
  return { key, originX: spec.ax / spec.w, originY: spec.ay / spec.h, scale: 1 / RES };
}

/**
 * Empaquette tous les sprites de décor demandés dans un atlas unique (rangées, tri par hauteur) :
 * tout le mobilier et les cloisons se dessinent alors en quelques appels GPU groupés.
 */
export function commitDecor(scene: Phaser.Scene): void {
  const items = [...(pending.get(scene) ?? new Map<string, HTMLCanvasElement>()).entries()];
  pending.delete(scene);
  // Rognage aux pixels non transparents : moins de surface dessinée (le rendu logiciel paie
  // chaque fragment, même transparent). Les frames gardent leur taille source (trim Phaser).
  const trimmed = items.map(([key, c]) => {
    const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width;
    let y0 = c.height;
    let x1 = -1;
    let y1 = -1;
    if (data) {
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if ((data[(y * c.width + x) * 4 + 3] ?? 0) === 0) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) [x0, y0, x1, y1] = [0, 0, 0, 0];
    return { key, c, bx: x0, by: y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1 };
  });
  trimmed.sort((a, b) => b.bh - a.bh);
  const MAXW = 2048;
  const PAD = 2;
  const pos: ((typeof trimmed)[number] & { x: number; y: number })[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const t of trimmed) {
    if (x + t.bw > MAXW) {
      x = 0;
      y += rowH + PAD;
      rowH = 0;
    }
    pos.push({ ...t, x, y });
    x += t.bw + PAD;
    rowH = Math.max(rowH, t.bh);
  }
  const tex = makeCanvas(scene, DECOR_TEX, MAXW, Math.max(1, y + rowH));
  if (!tex) return;
  const ctx = tex.getContext();
  for (const p of pos) {
    ctx.drawImage(p.c, p.bx, p.by, p.bw, p.bh, p.x, p.y, p.bw, p.bh);
    tex.add(p.key, 0, p.x, p.y, p.bw, p.bh)?.setTrim(p.c.width, p.c.height, p.bx, p.by, p.bw, p.bh);
  }
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

// ---------------------------------------------------------------- mobilier

const WOOD = 0xd9b98f;
const OFFICE_CHAIR = 0x4a5064;
const MEETING_CHAIR = 0x8f7ad6;

function chairSeat(c: Iso, u: number, v: number, color: number): void {
  c.shadow(u, v, 0.26, 0.18);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    c.line(c.pt(u, v, 2), c.pt(u + Math.cos(a) * 0.17, v + Math.sin(a) * 0.17, 1), 0x2f3340, 2);
  }
  c.box(u - 0.025, v - 0.025, 0.05, 0.05, 2, 8, 0x6b7080);
  c.box(u - 0.19, v - 0.19, 0.38, 0.38, 9, 3, color, lighten(color, 0.18));
}

/** Dossier vu de dos (affiché devant l'avatar assis). Repère : centre de la tuile du siège. */
function chairBackScreen(c: Iso, color: number, dy = 0): void {
  c.rrect(-12, -29 + dy, 24, 17, 5, darken(color, 0.7));
  c.rrect(-11, -29 + dy, 22, 15, 5, color);
  c.rrect(-9, -27 + dy, 18, 3, 2, lighten(color, 0.25), 0.8);
  c.rrect(-2, -13 + dy, 4, 3, 1, darken(color, 0.6));
}

function drawDesk(c: Iso, variant: number, accent: number): void {
  c.shadow(0, 0, 0.62, 0.17);
  // piétement + caisson aux couleurs du service
  c.box(-0.42, -0.28, 0.05, 0.56, 0, 16, 0xb6b0a6);
  const cab = mix(accent, 0xffffff, 0.45);
  c.box(0.1, -0.27, 0.3, 0.54, 0, 16, cab);
  c.line(c.pt(0.1, 0.27, 6), c.pt(0.4, 0.27, 6), darken(cab, 0.7), 1);
  c.line(c.pt(0.1, 0.27, 11), c.pt(0.4, 0.27, 11), darken(cab, 0.7), 1);
  c.faceV(0.22, 0.28, 0.27, 8, 9, 0x6b6560);
  c.faceV(0.22, 0.28, 0.27, 13, 14, 0x6b6560);
  // plateau bois
  c.box(-0.46, -0.32, 0.92, 0.64, 16, 3, WOOD, 0xe8cfa6);
  // écran : pied, col, dalle (l'image affichée est un polygone dynamique de la scène)
  c.box(-0.1, -0.27, 0.2, 0.1, 19, 1, 0x3a3f4c);
  c.box(-0.03, -0.23, 0.06, 0.04, 20, 6, 0x3a3f4c);
  c.box(-0.26, -0.23, 0.52, 0.05, 25, 18, 0x2b2f3a, 0x454b5a);
  c.faceV(-0.235, 0.235, -0.18, 27, 41, 0x3a4152);
  // clavier + souris
  c.box(-0.2, 0.0, 0.32, 0.12, 19, 1.5, 0xe9ebf1);
  for (let i = 0; i < 3; i++)
    c.line(c.pt(-0.18, 0.025 + i * 0.035, 20.6), c.pt(0.1, 0.025 + i * 0.035, 20.6), 0xb4b8c4, 0.8);
  c.box(0.2, 0.04, 0.05, 0.08, 19, 1.5, 0xe9ebf1);
  // objets personnels
  if (variant === 0) {
    c.cyl(0.34, -0.12, 19, 6, 0.045, 0xe9806e);
    c.disc(0.34, -0.12, 25, 0.03, 0x5a3a2a);
  } else if (variant === 1) {
    c.cyl(0.33, -0.14, 19, 5, 0.055, 0xd08a5c);
    c.blob((0.33 + 0.14) * HW, (0.33 - 0.14) * HH - 27, 4, 0x5fb55a);
    c.blob((0.33 + 0.14) * HW - 2, (0.33 - 0.14) * HH - 29, 2.5, 0x7cc976);
  } else {
    c.box(0.24, -0.2, 0.17, 0.13, 19, 1.5, 0xffffff);
    c.box(0.25, -0.19, 0.16, 0.12, 20.5, 1.5, 0xf4f1ea);
    c.box(0.36, 0.1, 0.04, 0.04, 19, 14, 0x5f6472);
    c.box(0.3, 0.06, 0.12, 0.1, 31, 4, 0xf0b429);
  }
  // siège (côté +v : tuile de l'ancre)
  chairSeat(c, 0, 1, OFFICE_CHAIR);
}

function drawPlant(c: Iso, variant: number): void {
  c.shadow(0, 0, 0.3, 0.2);
  if (variant === 0) {
    c.cyl(0, 0, 0, 14, 0.17, 0xd08a5c);
    c.cyl(0, 0, 12, 3, 0.19, 0xe29b6b);
    c.disc(0, 0, 15, 0.15, 0x5a3e2e);
    const leaves: [number, number, number, number][] = [
      [-9, -26, 9, 0x3f8a3d],
      [9, -25, 9, 0x3f8a3d],
      [0, -30, 11, 0x4f9e4a],
      [-6, -38, 8, 0x5fb55a],
      [7, -37, 8, 0x5fb55a],
      [0, -44, 7, 0x6cc466],
      [-3, -33, 4, 0x8bd884],
      [4, -42, 3, 0x9be393],
    ];
    for (const [x, y, r, col] of leaves) c.blob(x, y, r, col);
  } else if (variant === 1) {
    c.cyl(0, 0, 0, 18, 0.16, 0xf3efe8);
    c.cyl(0, 0, 7, 3, 0.163, 0x9c84de);
    c.disc(0, 0, 18, 0.13, 0x5a3e2e);
    c.line([c.ox * c.s, (c.oy - 18) * c.s], [(c.ox - 2) * c.s, (c.oy - 50) * c.s], 0x4f7a3a, 2);
    c.line([c.ox * c.s, (c.oy - 18) * c.s], [(c.ox + 6) * c.s, (c.oy - 60) * c.s], 0x4f7a3a, 2);
    const big: [number, number, number, number, number][] = [
      [-2, -42, 18, 10, -2.4],
      [2, -46, 18, 10, -0.7],
      [-3, -58, 16, 9, -2.0],
      [5, -60, 16, 9, -1.0],
      [0, -68, 13, 8, -1.6],
      [-1, -32, 14, 8, 2.9],
      [2, -34, 14, 8, 0.2],
    ];
    big.forEach(([x, y, l, w, a], i) =>
      c.leaf(x, y, l, w, a, [0x3f8a3d, 0x4f9e4a, 0x5fb55a, 0x6cc466][i % 4]!),
    );
  } else {
    c.cyl(0, 0, 0, 12, 0.15, 0x8d93a3);
    c.disc(0, 0, 12, 0.12, 0x5a3e2e);
    const blades: [number, number, number][] = [
      [-6, 34, -0.2],
      [-2, 46, -0.05],
      [3, 40, 0.1],
      [7, 30, 0.25],
      [0, 36, 0.02],
      [-4, 28, -0.35],
    ];
    for (const [x, h, a] of blades) {
      const c2 = c.ctx;
      c2.save();
      c2.translate((c.ox + x) * c.s, (c.oy - 12) * c.s);
      c2.rotate(a);
      c2.beginPath();
      c2.moveTo(-3 * c.s, 0);
      c2.quadraticCurveTo(-4 * c.s, -h * 0.6 * c.s, 0, -h * c.s);
      c2.quadraticCurveTo(4 * c.s, -h * 0.6 * c.s, 3 * c.s, 0);
      c2.closePath();
      c2.fillStyle = rgba(0xc9c46a);
      c2.fill();
      c2.scale(0.7, 0.95);
      c2.fillStyle = rgba(h > 38 ? 0x3f8a3d : 0x4f9e4a);
      c2.fill();
      c2.restore();
    }
  }
}

function drawMeetingTile(c: Iso, variant: number): void {
  c.box(-0.08, -0.08, 0.16, 0.16, 0, 12, 0x6b5240);
  c.box(-0.505, -0.505, 1.01, 1.01, 12, 5, 0xb98a5e, 0xd2a77a, false);
  if (variant === 1) {
    c.box(-0.16, -0.06, 0.3, 0.2, 17, 1, 0xcfd3dc);
    c.poly(
      [c.pt(-0.16, -0.06, 18), c.pt(0.14, -0.06, 18), c.pt(0.14, -0.1, 34), c.pt(-0.16, -0.1, 34)],
      0x5a6070,
    );
    c.poly(
      [
        c.pt(-0.14, -0.065, 20),
        c.pt(0.12, -0.065, 20),
        c.pt(0.12, -0.095, 32),
        c.pt(-0.14, -0.095, 32),
      ],
      0x9db4d8,
    );
  } else if (variant === 2) {
    c.poly(
      [
        c.pt(-0.25, -0.1, 17.2),
        c.pt(0.05, -0.18, 17.2),
        c.pt(0.12, 0.12, 17.2),
        c.pt(-0.18, 0.2, 17.2),
      ],
      0xffffff,
    );
    c.poly(
      [
        c.pt(-0.05, -0.05, 17.5),
        c.pt(0.25, -0.1, 17.5),
        c.pt(0.3, 0.18, 17.5),
        c.pt(0.0, 0.24, 17.5),
      ],
      0xf6f1e7,
    );
    for (let i = 0; i < 4; i++)
      c.line(c.pt(0.02, 0.0 + i * 0.05, 17.6), c.pt(0.2, -0.03 + i * 0.05, 17.6), 0xb0a8c8, 0.8);
    c.line(c.pt(-0.3, 0.2, 18), c.pt(-0.1, 0.3, 18), 0x7c60c9, 1.5);
  } else if (variant === 3) {
    c.cyl(0, 0, 17, 16, 0.07, 0xbfe3f2, 0xe6f6fc);
    c.cyl(-0.22, 0.12, 17, 7, 0.04, 0xdff1f8);
    c.cyl(0.18, 0.2, 17, 7, 0.04, 0xdff1f8);
  }
}

function drawWhiteboard(c: Iso): void {
  c.shadow(0, 0, 0.5, 0.12, 0.6);
  for (const u of [-0.42, 0.38]) {
    c.box(u - 0.04, -0.14, 0.12, 0.28, 0, 2, 0x8a8f9c);
    c.box(u, -0.03, 0.04, 0.06, 0, 52, 0xa9aebb);
  }
  c.box(-0.42, -0.03, 0.84, 0.05, 16, 36, 0xc9ccd6);
  c.faceV(-0.39, 0.39, 0.021, 18, 50, 0xffffff);
  // post-it, graphe, barres
  c.faceV(-0.34, -0.26, 0.022, 41, 47, 0xffe27a);
  c.faceV(-0.23, -0.15, 0.022, 41, 47, 0xff9fb8);
  c.faceV(-0.34, -0.26, 0.022, 32, 38, 0x9fd3ff);
  c.faceV(-0.23, -0.15, 0.022, 32, 38, 0xb6f0c7);
  const pts: [number, number][] = [
    [-0.08, 24],
    [0.02, 30],
    [0.1, 27],
    [0.2, 38],
    [0.33, 44],
  ];
  for (let i = 1; i < pts.length; i++)
    c.line(
      c.pt(pts[i - 1]![0], 0.023, pts[i - 1]![1]),
      c.pt(pts[i]![0], 0.023, pts[i]![1]),
      0x7c60c9,
      1.5,
    );
  c.faceV(-0.32, -0.12, 0.022, 22, 23.5, 0xea966c);
  c.faceV(-0.32, -0.18, 0.022, 26, 27.5, 0x9aa0b0);
  c.box(-0.3, 0.02, 0.6, 0.05, 16, 1.5, 0x9aa0b0);
}

function drawServer(c: Iso): void {
  c.shadow(0, 0, 0.45, 0.22);
  c.box(-0.32, -0.32, 0.64, 0.64, 0, 62, 0x353b4a, 0x4b5366);
  for (let z = 8; z < 60; z += 9) {
    c.faceV(-0.3, 0.3, 0.321, z, z + 7, 0x2a2f3b);
    c.line(c.pt(-0.3, 0.321, z + 7), c.pt(0.3, 0.321, z + 7), 0x4b5366, 0.8);
    const cols = [0x4ade80, 0x60a5fa, 0x4ade80, 0xfbbf24];
    for (let i = 0; i < 3; i++) {
      const [x, y] = c.pt(0.12 + i * 0.06, 0.321, z + 3.5);
      c.ctx.fillStyle = rgba(cols[(z + i) % 4]!);
      c.ctx.fillRect(x - c.s, y - c.s, 2 * c.s, 2 * c.s);
    }
    c.line(c.pt(-0.25, 0.321, z + 3.5), c.pt(0.0, 0.321, z + 3.5), 0x4b5366, 1);
  }
  for (let z = 10; z < 56; z += 5) c.line(c.pt(0.321, -0.2, z), c.pt(0.321, 0.2, z), 0x1f2430, 1);
}

function drawCounter(c: Iso, variant: number): void {
  c.shadow(0, 0, 0.6, 0.16);
  c.box(-0.48, -0.42, 0.96, 0.84, 0, 24, 0xc8956a);
  for (let u = -0.4; u < 0.48; u += 0.12)
    c.line(c.pt(u, 0.42, 2), c.pt(u, 0.42, 23), darken(0xc8956a, 0.78), 1);
  c.faceV(-0.48, 0.48, 0.421, 0, 3, 0x7d5a3a);
  c.box(-0.5, -0.46, 1, 0.92, 24, 3, 0xe8e2d8, 0xf6f2ec);
  if (variant === 0) {
    // machine à café
    c.box(-0.32, -0.36, 0.38, 0.32, 27, 28, 0x3d434f, 0x535a69);
    c.faceV(-0.28, 0.02, -0.039, 40, 52, 0xc7ccd6);
    c.faceV(-0.24, -0.02, -0.038, 44, 50, 0x2a2f3b);
    c.faceV(-0.06, -0.02, -0.037, 46, 48, 0xef5a6f);
    c.box(-0.2, -0.08, 0.14, 0.08, 27, 1, 0x7a808e);
    c.cyl(-0.13, -0.02, 28, 5, 0.04, 0xffffff);
    c.box(-0.12, -0.08, 0.05, 0.05, 36, 4, 0x8a909e);
    c.cyl(0.25, 0.1, 27, 5, 0.05, 0xffffff);
    c.cyl(0.33, -0.14, 27, 13, 0.06, 0x8a5a3a);
  } else {
    // vitrine à pâtisseries + pile de tasses
    c.disc(-0.05, 0, 27.5, 0.3, 0xd8cdbc);
    c.blob(-8, -36, 4, 0xd99a5b);
    c.blob(0, -34, 4, 0xe8b46e);
    c.blob(6, -37, 4, 0xc77d4e);
    const ctx = c.ctx;
    const [x, y] = c.pt(-0.05, 0, 28);
    ctx.beginPath();
    ctx.ellipse(x, y - 6 * c.s, 19 * c.s, 15 * c.s, 0, Math.PI, 0);
    ctx.lineTo(x + 19 * c.s, y);
    ctx.ellipse(x, y, 19 * c.s, 9 * c.s, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = 'rgba(220,240,255,0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.2 * c.s;
    ctx.stroke();
    for (let i = 0; i < 3; i++) c.cyl(0.32, 0.18, 27 + i * 3.5, 3.5, 0.05, 0xffffff, 0xf0ece6);
  }
}

function drawCafeTable(c: Iso): void {
  c.shadow(0, 0, 0.4, 0.18);
  c.disc(0, 0, 1, 0.16, 0x3d434f);
  c.box(-0.03, -0.03, 0.06, 0.06, 1, 14, 0x4b5160);
  c.cyl(0, 0, 14, 3, 0.32, 0xd8cdbc, 0xfaf6f0);
  for (const [u, v] of [
    [-0.12, 0.1],
    [0.14, -0.1],
  ] as const) {
    c.disc(u, v, 17.3, 0.08, 0xffffff);
    c.cyl(u, v, 17.5, 4, 0.045, 0xf4efe6);
    c.disc(u, v, 21.5, 0.032, 0x6b4430);
  }
  c.cyl(0.02, 0.0, 17, 8, 0.03, 0xbfe3f2);
  c.blob(0.02 * HW, -27, 3, 0xff8fa8);
  c.blob(0.02 * HW + 3, -29, 2.4, 0xffd36e);
}

function drawSofa(c: Iso): void {
  const C = 0x63b7ae;
  c.shadow(0, 0, 0.62, 0.18);
  c.box(-0.46, -0.46, 0.92, 0.92, 2, 12, darken(C, 0.92));
  c.box(-0.46, -0.46, 0.2, 0.92, 14, 18, C);
  c.box(-0.26, -0.46, 0.72, 0.16, 14, 9, C);
  c.box(-0.26, -0.3, 0.72, 0.38, 14, 4, lighten(C, 0.12));
  c.box(-0.26, 0.08, 0.72, 0.38, 14, 4, lighten(C, 0.12));
  c.box(-0.4, -0.2, 0.1, 0.24, 18, 12, 0xf08a6c);
  c.box(-0.4, 0.12, 0.1, 0.22, 18, 11, 0xfff1d6);
  c.box(-0.26, 0.3, 0.72, 0.16, 14, 9, C);
  for (const [u, v] of [
    [-0.42, -0.42],
    [0.4, -0.42],
    [-0.42, 0.4],
    [0.4, 0.4],
  ] as const)
    c.box(u, v, 0.04, 0.04, 0, 2, 0x5a3e2e);
}

function drawReception(c: Iso): void {
  const C = 0xe7c16a;
  c.shadow(0.5, 0, 1.1, 0.16, 0.5);
  c.box(-0.5, -0.4, 2, 0.8, 0, 26, C);
  c.faceV(-0.5, 1.5, 0.401, 8, 12, lighten(C, 0.35));
  c.faceV(-0.5, 1.5, 0.401, 0, 3, darken(C, 0.6));
  c.box(-0.55, -0.45, 2.1, 0.9, 26, 3, 0xf1dfb8);
  c.box(-0.5, 0.25, 2, 0.15, 29, 7, 0xf4e6c4);
  // moniteur (vu de dos), sonnette, bouquet
  c.box(0.62, -0.2, 0.42, 0.05, 32, 16, 0x5a606e);
  c.box(0.8, -0.18, 0.06, 0.04, 29, 4, 0x5a606e);
  const [bx, by] = c.pt(1.25, 0.05, 36);
  c.ctx.beginPath();
  c.ctx.arc(bx, by, 4 * c.s, Math.PI, 0);
  c.ctx.fillStyle = rgba(0xf0b429);
  c.ctx.fill();
  c.cyl(-0.3, 0.0, 29, 10, 0.07, 0xf3efe8);
  for (const [dx, dy, col] of [
    [-3, -45, 0xff8fa8],
    [3, -46, 0xffd36e],
    [0, -49, 0xc4b5fd],
    [-5, -40, 0x5fb55a],
    [5, -41, 0x4f9e4a],
  ] as const) {
    const [px, py] = c.pt(-0.3, 0, 0);
    c.ctx.beginPath();
    c.ctx.arc(px + dx * c.s, py + dy * c.s, 3.2 * c.s, 0, Math.PI * 2);
    c.ctx.fillStyle = rgba(col);
    c.ctx.fill();
  }
}

/** Texture d'un meuble de la carte (variante déterministe selon la position). */
export function furnitureSprite(scene: Phaser.Scene, f: Furniture, room: Room | null): DecorSprite {
  const h = hash(f.x, f.y);
  switch (f.kind) {
    case 'desk': {
      const variant = Math.floor(h * 3);
      const accent = room ? hex(room.color) : 0xd8d2c9;
      return texture(scene, `desk:${room?.id ?? '-'}:${variant}`, TILE_SPEC, (c) =>
        drawDesk(c, variant, accent),
      );
    }
    case 'plant': {
      const variant = Math.floor(h * 3);
      return texture(scene, `plant:${variant}`, TILE_SPEC, (c) => drawPlant(c, variant));
    }
    case 'meeting_table': {
      const variant =
        (f.x * 3 + f.y * 5) % 5 === 1
          ? 1
          : (f.x + f.y) % 4 === 0
            ? 2
            : (f.x * f.y) % 7 === 3
              ? 3
              : 0;
      return texture(scene, `mtable:${variant}`, TILE_SPEC, (c) => drawMeetingTile(c, variant));
    }
    case 'whiteboard':
      return texture(scene, 'whiteboard', TILE_SPEC, drawWhiteboard);
    case 'server':
      return texture(scene, 'server', TILE_SPEC, drawServer);
    case 'counter': {
      const variant = f.x % 2 === 0 ? 0 : 1;
      return texture(scene, `counter:${variant}`, TILE_SPEC, (c) => drawCounter(c, variant));
    }
    case 'cafe_table':
      return texture(scene, 'cafe_table', TILE_SPEC, drawCafeTable);
    case 'sofa':
      return texture(scene, 'sofa', TILE_SPEC, drawSofa);
    case 'reception':
      return texture(scene, 'reception', { w: 200, h: 150, ax: 80, ay: 112 }, drawReception);
  }
}

/** Dossier de siège affiché AU-DESSUS de l'avatar assis (il cache le bas du dos). */
export function chairBackSprite(scene: Phaser.Scene, meeting: boolean): DecorSprite {
  const color = meeting ? MEETING_CHAIR : OFFICE_CHAIR;
  return texture(scene, `chairback:${meeting ? 'm' : 'o'}`, TILE_SPEC, (c) =>
    chairBackScreen(c, color),
  );
}

/** Siège de réunion complet (assise + dossier côté -v), dessiné sous l'avatar. */
export function meetingChairSprite(scene: Phaser.Scene, backBehind: boolean): DecorSprite {
  return texture(scene, `mchair:${backBehind ? 'n' : 's'}`, TILE_SPEC, (c) => {
    if (backBehind) chairBackScreen(c, MEETING_CHAIR, -4);
    chairSeat(c, 0, 0, MEETING_CHAIR);
  });
}

/** Dalle d'écran blanche (teintée à l'exécution selon l'état de l'agent). */
export function screenSprite(scene: Phaser.Scene): DecorSprite {
  return texture(scene, 'screen', TILE_SPEC, (c) => {
    c.faceV(-0.225, 0.225, -0.175, 28, 40, 0xffffff);
    c.faceV(-0.225, 0.225, -0.175, 37.5, 40, 0xffffff, 0.6);
  });
}
/** Halo de l'écran sur le plateau (blanc, teinté et translucide à l'exécution). */
export function glowSprite(scene: Phaser.Scene): DecorSprite {
  return texture(scene, 'glow', TILE_SPEC, (c) => {
    const [x0, y0] = c.pt(0, -0.17, 19.2);
    const [x1, y1] = c.pt(0, 0.2, 19.2);
    const g = c.ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.poly(
      [
        c.pt(-0.26, -0.17, 19.2),
        c.pt(0.26, -0.17, 19.2),
        c.pt(0.4, 0.22, 19.2),
        c.pt(-0.4, 0.22, 19.2),
      ],
      g,
    );
  });
}

// ---------------------------------------------------------------- cloisons

const isWallOf = (room: Room, t: Tile): boolean =>
  HQ_MAP.tileKind(t) === 'wall' && HQ_MAP.roomAt(t)?.id === room.id;

/** Cloison basse vitrée : un sprite par tuile, raccordé aux voisines. */
export function partitionSprite(scene: Phaser.Scene, room: Room, t: Tile): DecorSprite {
  const E = isWallOf(room, { x: t.x + 1, y: t.y });
  const W = isWallOf(room, { x: t.x - 1, y: t.y });
  const S = isWallOf(room, { x: t.x, y: t.y + 1 });
  const N = isWallOf(room, { x: t.x, y: t.y - 1 });
  const mask = (E ? 1 : 0) | (W ? 2 : 0) | (S ? 4 : 0) | (N ? 8 : 0);
  const base = hex(room.color);
  const wall = mix(base, 0xffffff, 0.12);
  const cap = mix(base, 0xffffff, 0.55);
  const rail = darken(base, 0.82);
  const LOW = 18;
  const GLASS = 40;
  const T = 0.09;
  const spec: Spec = { w: 84, h: 96, ax: 42, ay: 70 };
  return texture(scene, `wall:${room.id}:${mask}`, spec, (c) => {
    const segX = (u0: number, u1: number): void => {
      c.box(u0, -T, u1 - u0, 2 * T, 0, LOW, wall, cap);
      c.faceV(u0, u1, 0, LOW + 2, GLASS, 0xe8f4ff, 0.3);
      c.line(c.pt(u0 + 0.1, 0, LOW + 6), c.pt(u0 + 0.22, 0, GLASS - 4), 0xffffff, 1.2, 0.55);
      c.box(u0, -0.03, u1 - u0, 0.06, GLASS, 2, rail);
    };
    const segY = (v0: number, v1: number): void => {
      c.box(-T, v0, 2 * T, v1 - v0, 0, LOW, wall, cap);
      c.faceU(v0, v1, 0, LOW + 2, GLASS, 0xe8f4ff, 0.3);
      c.line(c.pt(0, v0 + 0.1, LOW + 6), c.pt(0, v0 + 0.22, GLASS - 4), 0xffffff, 1.2, 0.55);
      c.box(-0.03, v0, 0.06, v1 - v0, GLASS, 2, rail);
    };
    if (W) segX(-0.5, 0);
    if (N) segY(-0.5, 0);
    const straight = mask === 3 || mask === 12;
    if (!straight) {
      c.box(-0.12, -0.12, 0.24, 0.24, 0, GLASS + 2, darken(wall, 0.95), cap);
    }
    if (E) segX(0, 0.5);
    if (S) segY(0, 0.5);
  });
}

// ---------------------------------------------------------------- sol + murs (cuits)

export interface StaticBake {
  key: string;
  scale: number;
  /** Morceaux non vides (frames de la texture) et leur position monde (coin haut-gauche). */
  chunks: { frame: string; x: number; y: number }[];
}

/** Cuit le sol, les tapis, la lumière des fenêtres et les murs du bâtiment dans UNE texture. */
export function bakeStatic(scene: Phaser.Scene, origin: { x: number; y: number }): StaticBake {
  const COLS = HQ_MAP.cols;
  const ROWS = HQ_MAP.rows;
  const W = origin.x + COLS * HW + 40;
  const H = origin.y + (COLS + ROWS) * HH + 40;
  const key = 'hq-static';
  const tex = makeCanvas(scene, key, W * FLOOR_RES, H * FLOOR_RES);
  if (!tex) return { key, scale: 1 / FLOOR_RES, chunks: [] };
  const ctx = tex.getContext();
  // Ici Iso.pt(gx, gy) = coin de grille (gx, gy), identique à HqScene.P().
  const c = new Iso(ctx, origin.x, origin.y, FLOOR_RES);
  const G = (gx: number, gy: number, z = 0): Pt => c.pt(gx, gy, z);
  const quad = (x0: number, y0: number, x1: number, y1: number, fill: number, a = 1): void =>
    c.poly([G(x0, y0), G(x1, y0), G(x1, y1), G(x0, y1)], fill, a);

  // --- dalle flottante
  const thick = 26;
  const slab = (a: Pt, b: Pt, color: number, h: number): void => {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(b[0], b[1] + h * FLOOR_RES);
    ctx.lineTo(a[0], a[1] + h * FLOOR_RES);
    ctx.closePath();
    ctx.fillStyle = rgba(color);
    ctx.fill();
  };
  slab(G(0, ROWS), G(COLS, ROWS), 0x8a6a52, thick);
  slab(G(COLS, 0), G(COLS, ROWS), 0x73563f, thick);
  slab(G(0, ROWS), G(COLS, ROWS), 0x7cc46b, 7);
  slab(G(COLS, 0), G(COLS, ROWS), 0x68ad59, 7);
  slab(G(0, ROWS), G(COLS, ROWS), 0x93d47f, 2);
  slab(G(COLS, 0), G(COLS, ROWS), 0x7cc46b, 2);

  // --- sol
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const room = HQ_MAP.roomAt({ x, y });
      const n = hash(x, y);
      let col: number;
      if (!room) {
        col = (x + y) % 2 === 0 ? 0xf3eadb : 0xece0cc;
      } else {
        const base = hex(room.color);
        if (room.kind === 'cafe')
          col = (x + y) % 2 === 0 ? mix(base, 0xffffff, 0.55) : mix(base, 0xffffff, 0.3);
        else if (room.kind === 'meeting') col = mix(base, 0xffffff, 0.55);
        else if (room.kind === 'entry') col = mix(base, 0xffffff, 0.45);
        else col = mix(base, 0xfff6e6, 0.5);
      }
      col = darken(col, 0.985 + n * 0.03);
      quad(x, y, x + 1, y + 1, col);
      ctx.strokeStyle = rgba(col);
      ctx.lineWidth = 0.6;
      ctx.stroke();
      if (room && room.kind === 'department') {
        // lames de parquet (dans le sens u), joints décalés
        for (let k = 1; k < 4; k++) {
          c.line(G(x, y + k / 4), G(x + 1, y + k / 4), darken(col, 0.86), 0.7, 0.55);
          const j = (k + x * 2 + y) % 3;
          const ju = x + 0.2 + j * 0.3;
          c.line(G(ju, y + (k - 1) / 4), G(ju, y + k / 4), darken(col, 0.86), 0.7, 0.5);
        }
      } else if (room?.kind === 'meeting') {
        if ((x + y) % 2 === 0) c.disc(x + 0.5, y + 0.5, 0, 0.04, darken(col, 0.9));
      } else if (room?.kind === 'entry') {
        for (let k = 0; k < 4; k++) {
          const a = hash(x * 7 + k, y * 3 - k);
          const b = hash(y * 5 + k, x * 11 + k);
          c.disc(x + a, y + b, 0, 0.025, darken(col, 0.82 + k * 0.03));
        }
      }
      // biseau : arête claire en haut, sombre en bas
      c.line(G(x, y + 1), G(x, y), 0xffffff, 0.8, 0.22);
      c.line(G(x, y), G(x + 1, y), 0xffffff, 0.8, 0.22);
      c.line(G(x + 1, y), G(x + 1, y + 1), 0x5a4060, 0.6, 0.05);
    }
  }

  // --- tapis
  const rug = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    fill: number,
    border: number,
    stripes = true,
  ): void => {
    quad(x0 + 0.04, y0 + 0.06, x1 + 0.04, y1 + 0.06, 0x2a1e40, 0.08);
    quad(x0, y0, x1, y1, border);
    quad(x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, fill);
    if (stripes) {
      quad(x0 + 0.2, y0 + 0.2, x1 - 0.2, y0 + 0.26, border, 0.8);
      quad(x0 + 0.2, y1 - 0.26, x1 - 0.2, y1 - 0.2, border, 0.8);
    }
  };
  for (const room of HQ_MAP.rooms) {
    const base = hex(room.color);
    const { x0, y0, x1 } = room.rect;
    if (room.kind === 'department') {
      for (const f of HQ_MAP.furniture) {
        if (f.roomId !== room.id || f.kind !== 'desk') continue;
        rug(
          f.x - 0.12,
          f.y - 0.08,
          f.x + 1.12,
          f.y + 1.95,
          mix(base, 0xffffff, 0.25),
          darken(base, 0.85),
        );
      }
    } else if (room.kind === 'meeting') {
      const t = HQ_MAP.furniture.filter((f) => f.kind === 'meeting_table');
      const tx0 = Math.min(...t.map((f) => f.x));
      const tx1 = Math.max(...t.map((f) => f.x));
      rug(tx0 - 0.7, 10.6, tx1 + 1.7, 15.4, 0xc9c0e6, 0x9c84de);
      quad(tx0 + 0.05, 12.05, tx1 + 1.2, 14.2, 0x2a1e40, 0.12);
    } else if (room.kind === 'cafe') {
      const cu = (x0 + x1) / 2 + 0.8;
      const cv = y0 + 3.6;
      c.disc(cu + 0.05, cv + 0.05, 0, 1.4, 0x2a1e40, 0.08);
      c.disc(cu, cv, 0, 1.4, 0xf08a6c);
      c.disc(cu, cv, 0, 1.25, 0xfbd3c2);
      c.disc(cu, cv, 0, 1.0, 0xf6b29a);
      c.disc(cu, cv, 0, 0.8, 0xfbd3c2);
    } else if (room.kind === 'entry') {
      rug(2.6, 22.6, 4.4, 24.2, 0xe7c16a, 0xc79d4a);
    }
  }

  // --- occlusion douce au pied des murs du bâtiment + lumière des fenêtres
  const gradQuad = (pts: Pt[], from: Pt, to: Pt, c0: string, c1: string): void => {
    const g = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    c.poly(pts, g);
  };
  // normale écran au mur droit (gy=0) : (-1, 2)/√5 ; au mur gauche (gx=0) : (1, 2)/√5
  const nR: Pt = [-1 / Math.sqrt(5), 2 / Math.sqrt(5)];
  const nL: Pt = [1 / Math.sqrt(5), 2 / Math.sqrt(5)];
  const along = (p: Pt, n: Pt, d: number): Pt => [
    p[0] + n[0] * d * FLOOR_RES,
    p[1] + n[1] * d * FLOOR_RES,
  ];
  gradQuad(
    [G(0, 0), G(COLS, 0), G(COLS, 0.8), G(0.8, 0.8)],
    G(0, 0),
    along(G(0, 0), nR, 22),
    'rgba(60,40,80,0.16)',
    'rgba(60,40,80,0)',
  );
  gradQuad(
    [G(0, 0), G(0, ROWS), G(0.8, ROWS), G(0.8, 0.8)],
    G(0, 0),
    along(G(0, 0), nL, 22),
    'rgba(60,40,80,0.12)',
    'rgba(60,40,80,0)',
  );
  const winsR: number[] = [];
  for (let x = 2; x < COLS - 2; x += 5) winsR.push(x);
  const winsL: number[] = [];
  for (let y = 12; y < ROWS - 2; y += 5) winsL.push(y);
  for (const x of winsR) {
    const a = G(x + 0.3, 0);
    gradQuad(
      [G(x + 0.3, 0), G(x + 2.7, 0), G(x + 4.0, 3.2), G(x + 1.6, 3.2)],
      a,
      along(a, nR, 70),
      'rgba(255,252,235,0.34)',
      'rgba(255,252,235,0)',
    );
  }
  for (const y of winsL) {
    const a = G(0, y + 0.3);
    gradQuad(
      [G(0, y + 0.3), G(0, y + 2.7), G(3.2, y + 4.0), G(3.2, y + 1.6)],
      a,
      along(a, nL, 70),
      'rgba(255,252,235,0.3)',
      'rgba(255,252,235,0)',
    );
  }

  // --- murs du bâtiment
  const up = (p: Pt, h: number): Pt => [p[0], p[1] - h * FLOOR_RES];
  const a = G(0, 0);
  const b = G(COLS, 0);
  const cc = G(0, ROWS);
  const wallQuad = (
    p0: Pt,
    p1: Pt,
    h0: number,
    h1: number,
    fill: number | CanvasGradient,
    al = 1,
  ): void => c.poly([up(p0, h1), up(p1, h1), up(p1, h0), up(p0, h0)], fill, al);
  // dessus des murs (épaisseur)
  c.poly(
    [up(G(-0.3, -0.3), WALL_H), up(G(COLS, -0.3), WALL_H), up(b, WALL_H), up(a, WALL_H)],
    0xcbb89a,
  );
  c.poly(
    [up(G(-0.3, -0.3), WALL_H), up(G(-0.3, ROWS), WALL_H), up(cc, WALL_H), up(a, WALL_H)],
    0xc2ae8f,
  );
  wallQuad(a, b, 0, WALL_H, 0xf6eedf);
  wallQuad(a, cc, 0, WALL_H, 0xe8dcc8);
  // papier peint : fines rayures verticales
  for (let s = 0.25; s < COLS; s += 0.5)
    wallQuad(G(s, 0), G(s + 0.06, 0), 40, WALL_H, 0xe6d8bf, 0.35);
  for (let s = 0.25; s < ROWS; s += 0.5)
    wallQuad(G(0, s), G(0, s + 0.06), 40, WALL_H, 0xd5c6ac, 0.35);
  // soubassement lambrissé + cimaise
  wallQuad(a, b, 0, 40, 0xeadcc2);
  wallQuad(a, cc, 0, 40, 0xdacbb0);
  for (let s = 0.5; s < COLS; s += 0.5) c.line(up(G(s, 0), 8), up(G(s, 0), 38), 0xd2c09f, 0.8, 0.8);
  for (let s = 0.5; s < ROWS; s += 0.5) c.line(up(G(0, s), 8), up(G(0, s), 38), 0xc4b291, 0.8, 0.8);
  wallQuad(a, b, 38, 42, 0xd6c4a5);
  wallQuad(a, cc, 38, 42, 0xc9b693);
  wallQuad(a, b, 41.5, 42.5, 0xffffff, 0.6);
  wallQuad(a, cc, 41.5, 42.5, 0xffffff, 0.45);
  wallQuad(a, b, 0, 8, 0xcdbca0);
  wallQuad(a, cc, 0, 8, 0xbfae92);
  wallQuad(a, b, WALL_H - 6, WALL_H, 0xd9c8aa);
  wallQuad(a, cc, WALL_H - 6, WALL_H, 0xcdbb9c);

  // fenêtres lumineuses
  const windowAt = (p0: Pt, p1: Pt): void => {
    wallQuad(p0, p1, 30, 96, 0xffffff);
    const top = up(p0, 92);
    const bottom = up(p0, 36);
    const g = ctx.createLinearGradient(top[0], top[1], bottom[0], bottom[1]);
    g.addColorStop(0, '#9fcdf1');
    g.addColorStop(0.65, '#d4ebfa');
    g.addColorStop(1, '#f3f9fd');
    wallQuad(p0, p1, 36, 92, g);
    // petit nuage + reflets
    const mid: Pt = [p0[0] * 0.65 + p1[0] * 0.35, p0[1] * 0.65 + p1[1] * 0.35];
    ctx.beginPath();
    ctx.ellipse(
      mid[0],
      mid[1] - 76 * FLOOR_RES,
      9 * FLOOR_RES,
      3.5 * FLOOR_RES,
      Math.atan2(p1[1] - p0[1], p1[0] - p0[0]),
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    const lerp = (t: number): Pt => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
    for (const [t0, w] of [
      [0.12, 0.08],
      [0.24, 0.03],
      [0.62, 0.06],
    ] as const) {
      c.poly(
        [up(lerp(t0), 50), up(lerp(t0 + w), 64), up(lerp(t0 + w), 90), up(lerp(t0), 76)],
        0xffffff,
        0.35,
      );
    }
    const m = lerp(0.5);
    c.line(up(m, 36), up(m, 92), 0xffffff, 3);
    c.line(up(p0, 64), up(p1, 64), 0xffffff, 2);
    // appui de fenêtre
    wallQuad(p0, p1, 28, 32, 0xd9c8aa);
    c.line(up(p0, 32), up(p1, 32), 0xffffff, 1, 0.8);
  };
  for (const x of winsR) windowAt(G(x, 0), G(x + 3, 0));
  for (const y of winsL) windowAt(G(0, y), G(0, y + 3));

  // décorations murales (dans le plan du mur, via une transformation affine)
  const onWall = (side: 'R' | 'L', s: number, draw: () => void): void => {
    const p = side === 'R' ? G(s, 0) : G(0, s);
    ctx.save();
    // repère local : X le long du mur (vers la droite écran), Y vers le bas
    ctx.setTransform(
      FLOOR_RES,
      side === 'R' ? FLOOR_RES * 0.5 : -FLOOR_RES * 0.5,
      0,
      FLOOR_RES,
      p[0],
      p[1],
    );
    draw();
    ctx.restore();
  };
  const frame = (
    x: number,
    y: number,
    w: number,
    h: number,
    art: (x: number, y: number, w: number, h: number) => void,
  ): void => {
    ctx.fillStyle = 'rgba(60,40,80,0.18)';
    ctx.fillRect(x + 2, y + 3, w, h);
    ctx.fillStyle = '#8a6a52';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fffaf2';
    ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
    art(x + 5, y + 5, w - 10, h - 10);
  };
  const landscape = (x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = '#bfe0f5';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fbd3a5';
    ctx.beginPath();
    ctx.arc(x + w * 0.7, y + h * 0.35, h * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9c84de';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w * 0.35, y + h * 0.4);
    ctx.lineTo(x + w * 0.6, y + h * 0.75);
    ctx.lineTo(x + w * 0.8, y + h * 0.55);
    ctx.lineTo(x + w, y + h);
    ctx.fill();
    ctx.fillStyle = '#76c69a';
    ctx.fillRect(x, y + h * 0.85, w, h * 0.15);
  };
  const abstract = (x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = '#f6efe4';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ea966c';
    ctx.beginPath();
    ctx.arc(x + w * 0.35, y + h * 0.45, Math.min(w, h) * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#88badc';
    ctx.fillRect(x + w * 0.5, y + h * 0.2, w * 0.35, h * 0.6);
    ctx.fillStyle = '#e7c16a';
    ctx.fillRect(x + w * 0.15, y + h * 0.75, w * 0.6, h * 0.1);
  };
  const chart = (x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
    const bars = [0.35, 0.5, 0.45, 0.7, 0.85];
    bars.forEach((v, i) => {
      ctx.fillStyle = ['#9c84de', '#76c69a', '#88badc', '#ea966c', '#e7c16a'][i]!;
      const bw = w / bars.length;
      ctx.fillRect(x + i * bw + 1, y + h * (1 - v), bw - 2, h * v);
    });
  };
  const clock = (x: number, y: number, r: number): void => {
    ctx.fillStyle = 'rgba(60,40,80,0.18)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5b4a6e';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fffdf8';
    ctx.beginPath();
    ctx.arc(x, y, r - 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5b4a6e';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(t) * (r - 5), y + Math.sin(t) * (r - 5));
      ctx.lineTo(x + Math.cos(t) * (r - 3.5), y + Math.sin(t) * (r - 3.5));
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + r * 0.45, y - r * 0.2);
    ctx.moveTo(x, y);
    ctx.lineTo(x - r * 0.1, y - r * 0.62);
    ctx.stroke();
  };
  const shelf = (x: number, y: number, w: number): void => {
    ctx.fillStyle = 'rgba(60,40,80,0.16)';
    ctx.fillRect(x + 2, y + 4, w, 4);
    ctx.fillStyle = '#b08a5c';
    ctx.fillRect(x, y, w, 4);
    const books = ['#9c84de', '#ea966c', '#76c69a', '#88badc', '#e7c16a', '#e8a5c0'];
    let bx = x + 3;
    books.forEach((col, i) => {
      const bh = 12 + ((i * 5) % 7);
      const bw = 4 + (i % 2);
      ctx.fillStyle = col;
      ctx.fillRect(bx, y - bh, bw, bh);
      bx += bw + 1;
    });
    // petite plante sur l'étagère
    ctx.fillStyle = '#d08a5c';
    ctx.fillRect(x + w - 12, y - 8, 9, 8);
    ctx.fillStyle = '#5fb55a';
    ctx.beginPath();
    ctx.arc(x + w - 7.5, y - 12, 6, 0, Math.PI * 2);
    ctx.fill();
  };
  const cork = (x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = '#8a6a52';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#d9b07a';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    const notes = ['#fff3a6', '#ffc6d6', '#c6e6ff', '#c9f2d3', '#fff3a6'];
    notes.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(x + 5 + (i % 3) * (w / 3.4), y + 5 + Math.floor(i / 3) * (h / 2.3), 9, 9);
      ctx.fillStyle = '#ce4b61';
      ctx.fillRect(x + 8 + (i % 3) * (w / 3.4), y + 5 + Math.floor(i / 3) * (h / 2.3), 2, 2);
    });
  };
  const menu = (x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = '#8a6a52';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#34413f';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f6f2ea';
    ctx.font = 'bold 9px ui-monospace, Menlo, monospace';
    ctx.fillText('CAFÉ', x + 6, y + 13);
    ctx.fillStyle = 'rgba(246,242,234,0.7)';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 6, y + 19 + i * 6, w - 18 - (i % 2) * 6, 2);
    ctx.fillStyle = '#83c6c1';
    ctx.fillRect(x + w - 10, y + 19, 4, 4);
  };
  // gaps entre fenêtres du mur droit
  const gapItems: (() => void)[] = [
    () => frame(-28, -100, 56, 40, landscape),
    () => clock(0, -86, 15),
    () => shelf(-26, -64, 52),
    () => frame(-22, -104, 44, 52, abstract),
    () => cork(-28, -100, 56, 42),
    () => frame(-26, -100, 52, 40, chart),
  ];
  winsR.forEach((x, i) => {
    const s = x + 4;
    if (s > COLS - 1) return;
    onWall('R', s, gapItems[i % gapItems.length]!);
  });
  onWall('R', 1, () => clock(0, -86, 12));
  // mur gauche : menu du café, cadres, horloge
  onWall('L', 5.2, () => menu(-26, -104, 52, 40));
  onWall('L', 2.3, () => shelf(-24, -62, 48));
  onWall('L', 16.5, () => clock(0, -86, 11));
  onWall('L', 21.5, () => frame(-16, -102, 32, 44, abstract));

  c.line(a, up(a, WALL_H), 0xa38f72, 2);
  // Découpe en morceaux : les zones entièrement transparentes (ciel) ne sont jamais dessinées.
  const CH = 192;
  const cw = tex.width;
  const chh = tex.height;
  const data = ctx.getImageData(0, 0, cw, chh).data;
  const chunks: StaticBake['chunks'] = [];
  for (let y0 = 0; y0 < chh; y0 += CH) {
    for (let x0 = 0; x0 < cw; x0 += CH) {
      const w = Math.min(CH, cw - x0);
      const h = Math.min(CH, chh - y0);
      let filled = false;
      for (let y = y0; y < y0 + h && !filled; y += 2)
        for (let x = x0; x < x0 + w; x += 2)
          if ((data[(y * cw + x) * 4 + 3] ?? 0) > 0) {
            filled = true;
            break;
          }
      if (!filled) continue;
      const frame = `c${x0}_${y0}`;
      tex.add(frame, 0, x0, y0, w, h);
      chunks.push({ frame, x: x0 / FLOOR_RES, y: y0 / FLOOR_RES });
    }
  }
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return { key, scale: 1 / FLOOR_RES, chunks };
}
