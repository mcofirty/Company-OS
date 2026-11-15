import type * as Phaser from 'phaser';

/**
 * Pixel art original généré procéduralement (aucun asset tiers).
 * Avatars : 8 variantes (peau, coiffure, tenue), vues face/dos, marche et travail.
 */
export const PX = 3; // taille d'un « pixel » d'art en unités monde
export const AVATAR_W = 14;
export const AVATAR_H = 24;

interface Variant {
  skin: number;
  hair: number;
  hairStyle: 'short' | 'long' | 'bun' | 'cap' | 'curly';
  shirt: number;
  shirtAccent: number;
  pants: number;
}

export const AVATAR_VARIANTS: Record<string, Variant> = {
  'avatar-01': {
    skin: 0xf1c9a5,
    hair: 0x2b1d14,
    hairStyle: 'bun',
    shirt: 0x3d4f9f,
    shirtAccent: 0xf5f0e6,
    pants: 0x2d3142,
  },
  'avatar-02': {
    skin: 0x8d5a3b,
    hair: 0x1a1a1a,
    hairStyle: 'short',
    shirt: 0xe07a3e,
    shirtAccent: 0xffffff,
    pants: 0x3a3f58,
  },
  'avatar-03': {
    skin: 0xe8b98f,
    hair: 0xb5562b,
    hairStyle: 'long',
    shirt: 0x2f9e7a,
    shirtAccent: 0xd9f5ea,
    pants: 0x384152,
  },
  'avatar-04': {
    skin: 0xc68b5e,
    hair: 0x3b2a20,
    hairStyle: 'cap',
    shirt: 0x7c60c9,
    shirtAccent: 0xe9e2ff,
    pants: 0x2a2e3d,
  },
  'avatar-05': {
    skin: 0x5e3a24,
    hair: 0x111111,
    hairStyle: 'curly',
    shirt: 0xd9475b,
    shirtAccent: 0xffe3e8,
    pants: 0x30354a,
  },
  'avatar-06': {
    skin: 0xf3d2b5,
    hair: 0xe0b44a,
    hairStyle: 'short',
    shirt: 0x2b8fc7,
    shirtAccent: 0xdff1fb,
    pants: 0x46424f,
  },
  'avatar-07': {
    skin: 0xa8724a,
    hair: 0x5a3a26,
    hairStyle: 'long',
    shirt: 0xf0b429,
    shirtAccent: 0x5a4210,
    pants: 0x2f3546,
  },
  'avatar-08': {
    skin: 0xdcae86,
    hair: 0x6b6f7a,
    hairStyle: 'bun',
    shirt: 0x5b8c3e,
    shirtAccent: 0xe6f2dc,
    pants: 0x34303f,
  },
};

export type AvatarView = 'front' | 'back';
export type AvatarFrame = 'idle' | 'walk1' | 'walk2' | 'work1' | 'work2';
export const avatarKey = (id: string, view: AvatarView, frame: AvatarFrame): string =>
  `${id}:${view}:${frame}`;

const darken = (c: number, f: number): number => {
  const r = Math.max(0, Math.round(((c >> 16) & 255) * f));
  const g = Math.max(0, Math.round(((c >> 8) & 255) * f));
  const b = Math.max(0, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};

function drawAvatar(
  g: Phaser.GameObjects.Graphics,
  v: Variant,
  view: AvatarView,
  frame: AvatarFrame,
): void {
  const px = (x: number, y: number, w: number, h: number, c: number): void => {
    g.fillStyle(c, 1);
    g.fillRect(x * PX, y * PX, w * PX, h * PX);
  };
  const outline = 0x1d1a26;
  const sitting = frame === 'work1' || frame === 'work2';
  const dy = sitting ? 2 : 0; // assis : le corps descend un peu

  // Jambes
  if (!sitting) {
    const l = frame === 'walk1' ? -1 : frame === 'walk2' ? 1 : 0;
    px(4 + Math.min(0, l), 17, 2, 5 - Math.abs(Math.max(0, l)), v.pants);
    px(8 + Math.max(0, l), 17, 2, 5 - Math.abs(Math.min(0, l)), v.pants);
    px(3 + Math.min(0, l), 22, 3, 1, outline);
    px(8 + Math.max(0, l), 22, 3, 1, outline);
  } else {
    px(4, 18, 6, 3, v.pants);
  }
  // Torse
  px(3, 9 + dy, 8, 8, v.shirt);
  px(3, 16 + dy, 8, 1, darken(v.shirt, 0.75));
  if (view === 'front') px(6, 9 + dy, 2, 3, v.shirtAccent);
  // Bras
  if (sitting) {
    const a = frame === 'work1' ? 0 : 1;
    px(2, 10 + dy, 1, 4 + a, v.shirt);
    px(11, 10 + dy, 1, 5 - a, v.shirt);
    px(2, 14 + dy + a, 1, 1, v.skin);
    px(11, 15 + dy - a, 1, 1, v.skin);
  } else {
    const swing = frame === 'walk1' ? 1 : frame === 'walk2' ? -1 : 0;
    px(2, 10 + dy + swing, 1, 6, v.shirt);
    px(11, 10 + dy - swing, 1, 6, v.shirt);
    px(2, 16 + dy + swing, 1, 1, v.skin);
    px(11, 16 + dy - swing, 1, 1, v.skin);
  }
  // Cou + tête
  px(6, 8 + dy, 2, 1, darken(v.skin, 0.85));
  px(4, 2 + dy, 6, 6, v.skin);
  // Cheveux
  const h = v.hair;
  if (view === 'front') {
    px(4, 1 + dy, 6, 2, h);
    if (v.hairStyle === 'long') {
      px(3, 2 + dy, 1, 7, h);
      px(10, 2 + dy, 1, 7, h);
    } else if (v.hairStyle === 'bun') {
      px(6, 0 + dy, 2, 1, h);
      px(3, 2 + dy, 1, 3, h);
      px(10, 2 + dy, 1, 3, h);
    } else if (v.hairStyle === 'cap') {
      px(3, 1 + dy, 8, 2, v.shirt);
      px(4, 3 + dy, 7, 1, darken(v.shirt, 0.7));
    } else if (v.hairStyle === 'curly') {
      px(3, 0 + dy, 8, 3, h);
      px(3, 3 + dy, 1, 2, h);
      px(10, 3 + dy, 1, 2, h);
    } else {
      px(3, 2 + dy, 1, 2, h);
      px(10, 2 + dy, 1, 2, h);
    }
    px(5, 5 + dy, 1, 1, outline); // yeux
    px(8, 5 + dy, 1, 1, outline);
    px(6, 7 + dy, 2, 1, darken(v.skin, 0.75)); // bouche
  } else {
    px(4, 1 + dy, 6, 6, h);
    px(3, 2 + dy, 1, v.hairStyle === 'long' ? 7 : 4, h);
    px(10, 2 + dy, 1, v.hairStyle === 'long' ? 7 : 4, h);
    if (v.hairStyle === 'bun') px(6, 0 + dy, 2, 2, h);
    if (v.hairStyle === 'cap') px(3, 1 + dy, 8, 2, v.shirt);
    if (v.hairStyle === 'curly') px(3, 0 + dy, 8, 2, h);
  }
}

export function generateTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  for (const [id, v] of Object.entries(AVATAR_VARIANTS)) {
    for (const view of ['front', 'back'] as const) {
      for (const frame of ['idle', 'walk1', 'walk2', 'work1', 'work2'] as const) {
        g.clear();
        drawAvatar(g, v, view, frame);
        g.generateTexture(avatarKey(id, view, frame), AVATAR_W * PX, AVATAR_H * PX);
      }
    }
  }
  // Nuage pixel
  g.clear();
  g.fillStyle(0xfdf3fb, 1);
  for (const [x, y, w, h] of [
    [8, 6, 30, 8],
    [0, 10, 52, 8],
    [14, 2, 14, 6],
    [30, 4, 12, 6],
  ] as const) {
    g.fillRect(x * 2, y * 2, w * 2, h * 2);
  }
  g.generateTexture('cloud', 110, 40);
  g.destroy();
}

export const hex = (css: string): number => Number.parseInt(css.replace('#', ''), 16);
export { darken };
