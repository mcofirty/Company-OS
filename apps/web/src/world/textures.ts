import type * as Phaser from 'phaser';

/**
 * Pixel art original généré procéduralement (aucun asset tiers).
 * Avatars : 8 personnages (peau, coiffure, haut, bas, accessoires), vues face/dos, cycle de
 * marche en 4 temps, poses assises (travail au clavier, réunion). Chaque sprite est construit sur
 * une grille de pixels d'art, ombré en 2-3 tons puis détouré automatiquement (contour coloré).
 */
export const PX = 2; // taille d'un « pixel » d'art en unités monde
export const AVATAR_W = 22;
export const AVATAR_H = 35;

type HairStyle =
  'short' | 'fade' | 'sidepart' | 'long' | 'bun' | 'bob' | 'ponytail' | 'afro' | 'curly';
type Top = 'shirt' | 'jacket' | 'sweater' | 'hoodie' | 'blouse' | 'cardigan';
type Bottom = 'trousers' | 'jeans' | 'skirt';

interface Variant {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  top: Top;
  topColor: number;
  /** Chemise / t-shirt visible sous la veste, col, boutons. */
  inner: number;
  bottom: Bottom;
  bottomColor: number;
  shoes: number;
  glasses?: boolean;
  beard?: boolean;
  tie?: number;
}

export const AVATAR_VARIANTS: Record<string, Variant> = {
  'avatar-01': {
    skin: 0xf1c9a5,
    hair: 0x3a2618,
    hairStyle: 'bun',
    top: 'jacket',
    topColor: 0x3d4f9f,
    inner: 0xf5f0e6,
    bottom: 'trousers',
    bottomColor: 0x2d3142,
    shoes: 0x2a2228,
    glasses: true,
  },
  'avatar-02': {
    skin: 0x8d5a3b,
    hair: 0x1a1414,
    hairStyle: 'fade',
    top: 'hoodie',
    topColor: 0xe07a3e,
    inner: 0xfff3e6,
    bottom: 'jeans',
    bottomColor: 0x3f5f8f,
    shoes: 0xf2f2f2,
    beard: true,
  },
  'avatar-03': {
    skin: 0xf3cfb0,
    hair: 0xb5562b,
    hairStyle: 'long',
    top: 'blouse',
    topColor: 0x2f9e7a,
    inner: 0xd9f5ea,
    bottom: 'skirt',
    bottomColor: 0x384152,
    shoes: 0x4a2f2a,
  },
  'avatar-04': {
    skin: 0xc68b5e,
    hair: 0x241a16,
    hairStyle: 'ponytail',
    top: 'shirt',
    topColor: 0x8f78d6,
    inner: 0xf1ecff,
    bottom: 'trousers',
    bottomColor: 0xcdb48e,
    shoes: 0x5a3e2e,
  },
  'avatar-05': {
    skin: 0x5e3a24,
    hair: 0x141010,
    hairStyle: 'afro',
    top: 'jacket',
    topColor: 0xd9475b,
    inner: 0xfaf3ee,
    bottom: 'trousers',
    bottomColor: 0x30354a,
    shoes: 0x1f1c22,
  },
  'avatar-06': {
    skin: 0xf6dcc4,
    hair: 0xe0b44a,
    hairStyle: 'sidepart',
    top: 'shirt',
    topColor: 0x8cc7ea,
    inner: 0xffffff,
    bottom: 'trousers',
    bottomColor: 0x55535f,
    shoes: 0x3a2a22,
    glasses: true,
    tie: 0x2b4f86,
  },
  'avatar-07': {
    skin: 0xa8724a,
    hair: 0x4a2c1c,
    hairStyle: 'bob',
    top: 'sweater',
    topColor: 0xf0b429,
    inner: 0xfff4d6,
    bottom: 'skirt',
    bottomColor: 0x6b4a3a,
    shoes: 0x2f2a2a,
  },
  'avatar-08': {
    skin: 0xe2b48c,
    hair: 0x9a9ca6,
    hairStyle: 'short',
    top: 'cardigan',
    topColor: 0x5b8c3e,
    inner: 0xf3efe2,
    bottom: 'trousers',
    bottomColor: 0x8a7a66,
    shoes: 0x3a2e26,
    glasses: true,
    beard: true,
  },
};

export type AvatarView = 'front' | 'back';
export type AvatarFrame = 'idle' | 'walk1' | 'walk2' | 'walk3' | 'work1' | 'work2' | 'sit';
export const AVATAR_FRAMES: readonly AvatarFrame[] = [
  'idle',
  'walk1',
  'walk2',
  'walk3',
  'work1',
  'work2',
  'sit',
];
/** Variante inconnue (ex. avatar ajouté côté serveur avant le client) => variante neutre, jamais un carré noir. */
export const avatarKey = (id: string, view: AvatarView, frame: AvatarFrame): string =>
  `${id in AVATAR_VARIANTS ? id : 'avatar-01'}:${view}:${frame}`;

const darken = (c: number, f: number): number => {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
};
/** Mélange linéaire de deux couleurs (t = part de b). */
const mix = (a: number, b: number, t: number): number => {
  const ch = (s: number): number =>
    Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
  return ch(16) | ch(8) | ch(0);
};
/** Éclaircit vers le blanc (t = part de blanc). */
const lighten = (c: number, t: number): number => mix(c, 0xffffff, t);
const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

class Grid {
  readonly cells: (number | null)[];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = new Array<number | null>(w * h).fill(null);
  }
  set(x: number, y: number, c: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y * this.w + x] = c;
  }
  get(x: number, y: number): number | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.cells[y * this.w + x] ?? null;
  }
  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  row(y: number, x0: number, x1: number, c: number): void {
    for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  /** Contour : toute case vide voisine d'une case pleine prend une teinte sombre de celle-ci. */
  outline(): void {
    const src = [...this.cells];
    const at = (x: number, y: number): number | null =>
      x < 0 || y < 0 || x >= this.w || y >= this.h ? null : (src[y * this.w + x] ?? null);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (at(x, y) !== null) continue;
        const n = at(x, y + 1) ?? at(x, y - 1) ?? at(x - 1, y) ?? at(x + 1, y);
        if (n !== null) this.set(x, y, mix(darken(n, 0.38), 0x241c33, 0.35));
      }
    }
  }
}

const EYE = 0x2a2233;

function drawHair(s: Grid, v: Variant, view: AvatarView, r: number): void {
  const H = v.hair;
  const Hl = lighten(H, 0.28);
  const Hd = darken(H, 0.78);
  const front = view === 'front';
  const st = v.hairStyle;
  const dither = (x0: number, x1: number, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (s.get(x, y) === H && (x + y) % 3 === 0) s.set(x, y, (x + 2 * y) % 2 ? Hl : Hd);
  };
  if (!front) {
    // Vue de dos : la chevelure couvre la tête, la nuque reste visible pour les coupes courtes.
    if (st === 'afro') {
      s.row(r - 3, 9, 12, H);
      s.row(r - 2, 7, 14, H);
      s.rect(5, r - 1, 12, 7, H);
      s.row(r + 6, 7, 14, H);
      dither(5, 16, r - 3, r + 6);
    } else if (st === 'curly') {
      s.row(r - 2, 8, 13, H);
      s.rect(6, r - 1, 10, 7, H);
      s.row(r + 6, 7, 14, H);
      dither(6, 15, r - 2, r + 6);
    } else if (st === 'long' || st === 'bob') {
      const end = st === 'long' ? r + 12 : r + 7;
      s.row(r - 1, 8, 13, H);
      s.rect(6, r, 10, end - r, H);
      s.row(end, 7, 14, H);
      for (let y = r + 2; y <= end; y += 1) if (y % 2 === 0) s.set(10, y, Hd);
      s.row(r, 8, 10, Hl);
    } else {
      const bottom = st === 'fade' ? r + 4 : r + 5;
      s.row(r - 1, 8, 13, H);
      s.rect(7, r, 8, bottom - r + 1, H);
      s.row(r, 8, 10, Hl);
      s.row(bottom, 7, 14, Hd);
      if (st === 'bun') {
        s.row(r - 3, 10, 11, H);
        s.row(r - 2, 9, 12, H);
        s.set(10, r - 3, Hl);
        s.row(r - 1, 9, 12, Hd);
      }
      if (st === 'ponytail') {
        s.rect(10, r + 6, 2, 6, H);
        s.row(r + 6, 10, 11, v.topColor);
        s.set(10, r + 8, Hl);
      }
    }
    return;
  }
  switch (st) {
    case 'short':
    case 'bun':
    case 'ponytail':
      s.row(r - 1, 8, 13, H);
      s.row(r, 7, 14, H);
      s.row(r + 1, 7, 14, H);
      s.set(7, r + 2, H);
      s.set(8, r + 2, H);
      s.set(13, r + 2, H);
      s.set(14, r + 2, H);
      s.set(7, r + 3, Hd);
      s.set(14, r + 3, Hd);
      s.row(r - 1, 9, 10, Hl);
      s.set(8, r, Hl);
      if (st === 'bun') {
        s.row(r - 3, 10, 11, H);
        s.row(r - 2, 9, 12, H);
        s.set(10, r - 3, Hl);
        s.row(r - 1, 9, 12, Hd);
      }
      if (st === 'ponytail') {
        s.rect(15, r + 2, 1, 4, H);
        s.set(15, r + 1, v.topColor);
      }
      break;
    case 'fade':
      s.row(r - 1, 8, 13, H);
      s.row(r, 7, 14, H);
      s.set(7, r + 1, Hd);
      s.set(14, r + 1, Hd);
      s.set(7, r + 2, Hd);
      s.set(14, r + 2, Hd);
      s.row(r - 1, 9, 10, Hl);
      break;
    case 'sidepart':
      s.row(r - 1, 8, 14, H);
      s.row(r, 7, 14, H);
      s.row(r + 1, 7, 14, H);
      s.row(r + 2, 7, 10, H);
      s.set(14, r + 2, H);
      s.set(7, r + 3, Hd);
      s.set(11, r, Hd);
      s.row(r - 1, 9, 11, Hl);
      s.row(r, 8, 9, Hl);
      break;
    case 'long':
      s.row(r - 1, 8, 13, H);
      s.row(r, 7, 14, H);
      s.row(r + 1, 7, 14, H);
      s.set(10, r + 1, Hd);
      s.set(7, r + 2, H);
      s.set(8, r + 2, H);
      s.set(13, r + 2, H);
      s.set(14, r + 2, H);
      s.rect(6, r + 1, 1, 12, H);
      s.rect(15, r + 1, 1, 12, H);
      s.rect(7, r + 3, 1, 3, H);
      s.rect(14, r + 3, 1, 3, H);
      s.rect(5, r + 6, 1, 6, Hd);
      s.rect(16, r + 6, 1, 6, Hd);
      s.row(r - 1, 9, 10, Hl);
      s.set(8, r, Hl);
      s.set(6, r + 4, Hl);
      break;
    case 'bob':
      s.row(r - 1, 8, 13, H);
      s.row(r, 7, 14, H);
      s.row(r + 1, 6, 15, H);
      s.row(r + 2, 6, 9, H);
      s.row(r + 2, 13, 15, H);
      s.rect(6, r + 3, 2, 4, H);
      s.rect(14, r + 3, 2, 4, H);
      s.set(6, r + 7, Hd);
      s.set(15, r + 7, Hd);
      s.row(r - 1, 9, 10, Hl);
      s.row(r, 8, 9, Hl);
      break;
    case 'afro':
      s.row(r - 3, 9, 12, H);
      s.row(r - 2, 7, 14, H);
      s.row(r - 1, 6, 15, H);
      s.row(r, 5, 16, H);
      s.row(r + 1, 5, 16, H);
      s.rect(5, r + 2, 2, 2, H);
      s.rect(15, r + 2, 2, 2, H);
      s.set(6, r + 4, H);
      s.set(15, r + 4, H);
      dither(5, 16, r - 3, r + 4);
      break;
    case 'curly':
      s.set(8, r - 2, H);
      s.set(10, r - 2, H);
      s.set(12, r - 2, H);
      s.row(r - 1, 7, 14, H);
      s.row(r, 6, 15, H);
      s.row(r + 1, 6, 15, H);
      s.row(r + 2, 6, 8, H);
      s.row(r + 2, 13, 15, H);
      s.set(6, r + 3, H);
      s.set(15, r + 3, H);
      dither(6, 15, r - 2, r + 3);
      break;
  }
}

function drawFace(s: Grid, v: Variant, r: number): void {
  const skinS = darken(v.skin, 0.86);
  const free = (x: number, y: number): boolean => s.get(x, y) === v.skin;
  if (free(9, r + 3)) s.set(9, r + 3, darken(v.hair, 0.85));
  if (free(12, r + 3)) s.set(12, r + 3, darken(v.hair, 0.85));
  s.set(9, r + 4, EYE);
  s.set(12, r + 4, EYE);
  s.set(11, r + 5, skinS);
  s.set(8, r + 5, mix(v.skin, 0xff7a7a, 0.22));
  s.set(13, r + 5, mix(v.skin, 0xff7a7a, 0.22));
  s.row(r + 6, 10, 11, mix(v.skin, 0x9a3c3c, 0.45));
  if (v.beard) {
    const B = darken(v.hair, 0.95);
    s.set(7, r + 5, B);
    s.set(14, r + 5, B);
    s.set(7, r + 6, B);
    s.set(14, r + 6, B);
    s.row(r + 6, 8, 9, B);
    s.row(r + 6, 12, 13, B);
    s.row(r + 7, 8, 13, B);
    s.row(r + 6, 10, 11, mix(v.skin, 0x7a2e2e, 0.5));
  }
  if (v.glasses) {
    // Monture fine : branches + pont, verres clairs autour des yeux.
    const G = 0x6a5a7e;
    const lens = mix(v.skin, 0xdff1ff, 0.45);
    s.set(8, r + 4, G);
    s.set(13, r + 4, G);
    s.set(10, r + 4, lens);
    s.set(11, r + 4, lens);
    s.row(r + 3, 8, 10, G);
    s.row(r + 3, 11, 13, G);
    s.set(10, r + 5, G);
    s.set(11, r + 5, mix(v.skin, G, 0.3));
  }
}

function drawAvatar(s: Grid, v: Variant, view: AvatarView, frame: AvatarFrame): void {
  const front = view === 'front';
  const sitting = frame === 'work1' || frame === 'work2' || frame === 'sit';
  const bob = frame === 'walk3' ? -1 : 0;
  const sy = sitting ? 3 : bob;
  const skinS = darken(v.skin, 0.86);
  const T0 = 12 + sy; // haut du torse
  const r = 3 + sy; // haut du crâne
  const top = v.topColor;
  const topL = lighten(top, 0.14);
  const topD = darken(top, 0.8);
  const P = v.bottomColor;
  const PD = darken(P, 0.8);
  const PL = lighten(P, 0.12);

  // Cheveux longs derrière les épaules (vue de face)
  if (front && v.hairStyle === 'long') s.rect(7, r + 6, 8, 7, darken(v.hair, 0.7));

  // ---------- jambes ----------
  if (!sitting) {
    const legTop = 22 + bob;
    const liftL = frame === 'walk2' ? 2 : 0;
    const liftR = frame === 'walk1' ? 2 : 0;
    const shoe = (x0: number, w: number, y: number): void => {
      s.row(y, x0, x0 + w - 1, v.shoes);
      s.row(y + 1, x0, x0 + w - 1, darken(v.shoes, 0.75));
      if (front) s.set(x0 + 1, y, lighten(v.shoes, 0.35));
    };
    if (v.bottom === 'skirt') {
      const legC = mix(v.skin, 0x3a3040, 0.15);
      s.rect(8, legTop + 5, 2, 32 - liftL - (legTop + 5), legC);
      s.rect(12, legTop + 5, 2, 32 - liftR - (legTop + 5), legC);
      shoe(7, 3, 32 - liftL);
      shoe(12, 3, 32 - liftR);
      s.row(legTop, 7, 14, P);
      s.rect(6, legTop + 1, 10, 3, P);
      s.row(legTop + 4, 6, 15, PD);
      s.set(6, legTop + 1, PL);
      s.set(15, legTop + 2, PD);
    } else {
      s.rect(7, legTop, 3, 32 - legTop - liftL, P);
      s.rect(12, legTop, 3, 32 - legTop - liftR, P);
      s.rect(10, legTop, 2, 2, P);
      for (let y = legTop + 2; y < 32 - liftL; y++) s.set(9, y, PD);
      for (let y = legTop + 2; y < 32 - liftR; y++) s.set(12, y, PD);
      for (let y = legTop; y < 31 - liftL; y++) s.set(7, y, PL);
      if (v.bottom === 'jeans') {
        s.set(8, legTop + 4, PL);
        s.set(13, legTop + 4, PL);
      }
      shoe(6, 4, 32 - liftL);
      shoe(12, 4, 32 - liftR);
    }
  } else if (front) {
    // Assis de face : cuisses en raccourci, tibias, pieds au sol.
    const lap = T0 + 10;
    const legC = v.bottom === 'skirt' ? mix(v.skin, 0x3a3040, 0.15) : P;
    s.rect(6, lap, 10, 3, P);
    s.row(lap, 6, 15, PL);
    s.set(10, lap + 2, PD);
    s.set(11, lap + 2, PD);
    s.rect(7, lap + 3, 3, 32 - lap - 3, legC);
    s.rect(12, lap + 3, 3, 32 - lap - 3, legC);
    s.row(32, 6, 9, v.shoes);
    s.row(32, 12, 15, v.shoes);
    s.row(33, 6, 9, darken(v.shoes, 0.75));
    s.row(33, 12, 15, darken(v.shoes, 0.75));
  } else {
    // Assis de dos : seules les hanches dépassent (le dossier du siège couvre le reste).
    s.rect(6, T0 + 10, 10, 2, PD);
  }

  // ---------- torse ----------
  s.row(T0, 7, 14, top);
  s.rect(6, T0 + 1, 10, 9, top);
  for (let y = T0 + 1; y <= T0 + 9; y++) {
    s.set(6, y, topL);
    s.set(15, y, topD);
  }
  s.row(T0 + 9, 7, 14, darken(top, 0.86));
  if (front) {
    const I = v.inner;
    switch (v.top) {
      case 'shirt':
        s.row(T0, 9, 12, I);
        s.set(10, T0 + 1, I);
        s.set(11, T0 + 1, I);
        for (const y of [T0 + 3, T0 + 5, T0 + 7]) s.set(10, y, darken(top, 0.72));
        s.set(13, T0 + 3, topD);
        if (v.tie) {
          s.rect(10, T0 + 1, 2, 5, v.tie);
          s.set(10, T0 + 1, lighten(v.tie, 0.25));
          s.set(11, T0 + 6, v.tie);
        }
        break;
      case 'jacket':
        s.rect(9, T0, 4, 2, I);
        s.rect(10, T0 + 2, 2, 3, I);
        s.set(8, T0, topD);
        s.set(8, T0 + 1, topD);
        s.set(9, T0 + 2, topD);
        s.set(13, T0, topD);
        s.set(13, T0 + 1, topD);
        s.set(12, T0 + 2, topD);
        s.set(10, T0 + 6, darken(top, 0.6));
        s.set(13, T0 + 6, topD);
        s.set(8, T0 + 6, topD);
        break;
      case 'sweater':
        s.row(T0, 9, 12, darken(top, 0.78));
        s.row(T0 + 9, 7, 14, darken(top, 0.74));
        s.set(9, T0 + 4, topL);
        s.set(12, T0 + 4, topL);
        break;
      case 'hoodie':
        s.row(T0, 7, 14, darken(top, 0.82));
        s.set(8, T0 + 1, darken(top, 0.82));
        s.set(13, T0 + 1, darken(top, 0.82));
        s.rect(9, T0 + 1, 1, 3, I);
        s.rect(12, T0 + 1, 1, 3, I);
        s.row(T0 + 6, 8, 13, darken(top, 0.88));
        s.row(T0 + 9, 7, 14, darken(top, 0.74));
        break;
      case 'blouse':
        s.set(10, T0, v.skin);
        s.set(11, T0, v.skin);
        s.set(10, T0 + 1, skinS);
        s.set(11, T0 + 1, skinS);
        s.set(9, T0, I);
        s.set(12, T0, I);
        s.set(9, T0 + 1, I);
        s.set(12, T0 + 1, I);
        break;
      case 'cardigan':
        s.rect(10, T0, 2, 9, I);
        for (const y of [T0 + 2, T0 + 4, T0 + 6]) s.set(9, y, darken(top, 0.65));
        s.row(T0 + 9, 7, 9, darken(top, 0.74));
        s.row(T0 + 9, 12, 14, darken(top, 0.74));
        break;
    }
  } else {
    s.row(T0, 9, 12, darken(top, 0.82));
    if (v.top === 'jacket') for (let y = T0 + 4; y <= T0 + 9; y++) s.set(10, y, topD);
    if (v.top === 'hoodie') {
      s.rect(8, T0, 6, 3, darken(top, 0.85));
      s.row(T0 + 3, 9, 12, darken(top, 0.75));
    }
  }

  // ---------- bras ----------
  const sleeve = top;
  const cuff = v.top === 'sweater' || v.top === 'hoodie' ? darken(top, 0.74) : top;
  const arm = (x: number, y0: number, len: number, outerLight: boolean): void => {
    s.rect(x, y0, 2, len, sleeve);
    for (let y = y0; y < y0 + len; y++) s.set(outerLight ? x : x + 1, y, outerLight ? topL : topD);
    s.row(y0 + len - 1, x, x + 1, cuff);
  };
  if (!sitting) {
    const swing = frame === 'walk1' ? 1 : frame === 'walk2' ? -1 : 0;
    arm(4, T0 + 1 + swing, 8, true);
    arm(16, T0 + 1 - swing, 8, false);
    s.rect(4, T0 + 9 + swing, 2, 2, v.skin);
    s.rect(16, T0 + 9 - swing, 2, 2, v.skin);
    s.set(5, T0 + 10 + swing, skinS);
    s.set(17, T0 + 10 - swing, skinS);
  } else if (frame === 'sit') {
    arm(4, T0 + 1, 8, true);
    arm(16, T0 + 1, 8, false);
    s.rect(5, T0 + 9, 2, 1, v.skin);
    s.rect(15, T0 + 9, 2, 1, v.skin);
  } else {
    // Frappe au clavier : avant-bras tendus vers le bureau, alternance gauche/droite.
    const a = frame === 'work1' ? 1 : 0;
    const b = 1 - a;
    arm(4, T0 + 1 - a, 6, true);
    arm(16, T0 + 1 - b, 6, false);
    if (front) {
      s.rect(6, T0 + 6 - a, 2, 1, v.skin);
      s.rect(14, T0 + 6 - b, 2, 1, v.skin);
    } else {
      s.set(6, T0 + 5 - a, darken(top, 0.7));
      s.set(15, T0 + 5 - b, darken(top, 0.7));
    }
  }

  // ---------- cou + tête ----------
  s.row(T0 - 1, 9, 12, skinS);
  s.rect(7, r, 8, 8, v.skin);
  s.cells[r * s.w + 7] = null;
  s.cells[r * s.w + 14] = null;
  s.cells[(r + 7) * s.w + 7] = null;
  s.cells[(r + 7) * s.w + 14] = null;
  for (let y = r + 1; y <= r + 6; y++) s.set(14, y, skinS);
  s.row(r + 7, 9, 12, skinS);
  s.set(6, r + 3, skinS);
  s.set(6, r + 4, skinS);
  s.set(15, r + 3, skinS);
  s.set(15, r + 4, skinS);
  drawHair(s, v, view, r);
  if (front) drawFace(s, v, r);
}

export function makeCanvas(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
): Phaser.Textures.CanvasTexture | null {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  return scene.textures.createCanvas(key, Math.ceil(w), Math.ceil(h));
}

/**
 * Tous les sprites d'avatars vivent dans UNE texture (atlas) : chaque image d'animation est une
 * frame nommée `avatarKey(...)`. Une seule texture = rendu groupé en un minimum d'appels GPU.
 */
export const AVATAR_TEX = 'avatars';

export function generateTextures(scene: Phaser.Scene): void {
  const fw = AVATAR_W * PX;
  const fh = AVATAR_H * PX;
  const pad = 2;
  const perRow = 16;
  const total = Object.keys(AVATAR_VARIANTS).length * 2 * AVATAR_FRAMES.length;
  const rows = Math.ceil(total / perRow);
  const atlas = makeCanvas(scene, AVATAR_TEX, perRow * (fw + pad), rows * (fh + pad));
  if (atlas) {
    const ctx = atlas.getContext();
    let i = 0;
    for (const [id, v] of Object.entries(AVATAR_VARIANTS)) {
      for (const view of ['front', 'back'] as const) {
        for (const frame of AVATAR_FRAMES) {
          const grid = new Grid(AVATAR_W, AVATAR_H);
          drawAvatar(grid, v, view, frame);
          grid.outline();
          const ox = (i % perRow) * (fw + pad);
          const oy = Math.floor(i / perRow) * (fh + pad);
          i++;
          for (let y = 0; y < AVATAR_H; y++) {
            for (let x = 0; x < AVATAR_W; x++) {
              const c = grid.get(x, y);
              if (c === null) continue;
              ctx.fillStyle = css(c);
              ctx.fillRect(ox + x * PX, oy + y * PX, PX, PX);
            }
          }
          atlas.add(avatarKey(id, view, frame), 0, ox, oy, fw, fh);
        }
      }
    }
    atlas.refresh();
  }
  // Nuage pixel (bouffées arrondies, ombre douce)
  const cloud = makeCanvas(scene, 'cloud', 120, 48);
  if (cloud) {
    const ctx = cloud.getContext();
    const puffs: [number, number, number][] = [
      [30, 30, 14],
      [50, 22, 18],
      [74, 26, 15],
      [92, 32, 11],
      [18, 36, 9],
    ];
    ctx.fillStyle = '#e9d6f2';
    for (const [x, y, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x, y + 4, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(14, 34, 92, 10);
    ctx.fillStyle = '#fdf6fc';
    for (const [x, y, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(16, 30, 88, 10);
    cloud.refresh();
  }
}

export const hex = (css: string): number => Number.parseInt(css.replace('#', ''), 16);
export { darken, lighten, mix };
