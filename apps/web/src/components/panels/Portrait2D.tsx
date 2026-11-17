'use client';

import type { AgentView, WorldSnapshot } from '@company-os/contracts';
import { appearanceOf, hash, moodOf } from '../../world/studio';

/**
 * Portrait 2D vectoriel (style « illustration plate ») : même identité que le personnage 3D
 * (peau, coiffure, tenue aux couleurs du pôle, badge) et expression tirée de l'état réel.
 * SVG pur : net à toute taille, aucun calcul 3D, aucune charge pour l'ordinateur.
 */
export type PortraitMood = 'neutral' | 'focus' | 'happy' | 'worried';

const INK = '#2a2420';

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? Number.parseInt(m[1]!, 16) : 0x999999;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Assombrit (k < 1) ou éclaircit (k > 1) une couleur. */
export function shadeColor(hex: string, k: number): string {
  return `#${rgb(hex)
    .map((c) => Math.max(0, Math.min(255, Math.round(k > 1 ? c + (255 - c) * (k - 1) : c * k))))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}
export function tintColor(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Couleur de tenue : celle du pôle, nuancée par personne (même logique que la carte). */
function outfit(deptColor: string | null, fallback: string, seed: number): string {
  if (!deptColor) return fallback;
  return shadeColor(deptColor, 0.86 + ((seed % 5) - 2) * 0.045);
}

function face(mood: PortraitMood, hair: string): string {
  const brow = shadeColor(hair, 0.8);
  const line = (d: string, c = INK, w = 2.6): string =>
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  const brows = {
    focus: 'M45 58 L54 61 M75 58 L66 61',
    worried: 'M45 60 L54 57 M75 60 L66 57',
    happy: 'M45 57 Q50 54 55 57 M65 57 Q70 54 75 57',
    neutral: 'M46 58 L54 58 M66 58 L74 58',
  }[mood];
  const mouth = {
    happy: 'M52 79 Q60 87 68 79',
    focus: 'M54 81 L66 81',
    worried: 'M52 84 Q60 77 68 84',
    neutral: 'M54 80 Q60 83 66 80',
  }[mood];
  const eyes =
    mood === 'happy'
      ? line('M46 67 Q50 63 54 67 M66 67 Q70 63 74 67')
      : `<circle cx="50" cy="67" r="3.2" fill="${INK}"/><circle cx="70" cy="67" r="3.2" fill="${INK}"/><circle cx="51" cy="66" r="1" fill="#fff"/><circle cx="71" cy="66" r="1" fill="#fff"/>`;
  const cheeks =
    mood === 'happy'
      ? '<circle cx="44" cy="76" r="4" fill="#ff8a8a" opacity=".35"/><circle cx="76" cy="76" r="4" fill="#ff8a8a" opacity=".35"/>'
      : '';
  const sweat = mood === 'worried' ? '<path d="M82 52 q4 6 0 9 q-4 -3 0 -9z" fill="#8ec5ff"/>' : '';
  return (
    line(brows, brow) + eyes + cheeks + line(mouth, INK, mood === 'neutral' ? 2.4 : 2.6) + sweat
  );
}

function hairBack(style: number, hair: string): string {
  return style === 1
    ? `<path d="M33 60 Q31 100 44 108 L76 108 Q89 100 87 60 Z" fill="${hair}"/>`
    : '';
}
function hairFront(style: number, hair: string): string {
  if (style === 2)
    return `<path d="M34 62 Q34 34 60 32 Q86 34 86 62 Q78 46 60 46 Q42 46 34 62Z" fill="${hair}"/><circle cx="60" cy="28" r="9" fill="${hair}"/>`;
  if (style === 1)
    return `<path d="M33 66 Q32 32 60 31 Q88 32 87 66 Q82 44 62 43 Q44 44 40 58 Q36 62 33 66Z" fill="${hair}"/>`;
  return `<path d="M35 60 Q35 33 60 32 Q85 33 85 60 Q80 45 66 44 Q58 50 44 47 Q38 52 35 60Z" fill="${hair}"/>`;
}

/** Balisage SVG du portrait (exporté pour les tests). */
export function portraitSvg(opts: {
  avatarId: string;
  agentId: string;
  deptColor: string | null;
  mood: PortraitMood;
  crop: 'bust' | 'head';
}): string {
  const ap = appearanceOf(opts.avatarId);
  const top = outfit(opts.deptColor, ap.top, hash(opts.agentId));
  const bg = tintColor(opts.deptColor ?? ap.top, 0.18);
  const vb = opts.crop === 'head' ? '24 16 72 72' : '0 0 120 132';
  return `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
<rect x="-20" y="-20" width="160" height="180" fill="${bg}"/>
<ellipse cx="60" cy="128" rx="40" ry="6" fill="rgba(0,0,0,.08)"/>
${hairBack(ap.style, ap.hair)}
<path d="M24 132 Q26 100 60 96 Q94 100 96 132 Z" fill="${top}"/>
<path d="M52 97 L60 108 L68 97" fill="none" stroke="${shadeColor(top, 0.75)}" stroke-width="3"/>
<rect x="70" y="108" width="9" height="12" rx="2" fill="#fff"/>
<path d="M60 99 L74 108" stroke="${shadeColor(top, 0.6)}" stroke-width="1.6"/>
<rect x="53" y="84" width="14" height="14" fill="${shadeColor(ap.skin, 0.92)}"/>
<ellipse cx="60" cy="66" rx="25" ry="27" fill="${ap.skin}"/>
<ellipse cx="35" cy="68" rx="4" ry="6" fill="${shadeColor(ap.skin, 0.92)}"/>
<ellipse cx="85" cy="68" rx="4" ry="6" fill="${shadeColor(ap.skin, 0.92)}"/>
${hairFront(ap.style, ap.hair)}
${face(opts.mood, ap.hair)}
</svg>`;
}

/** Portrait d'un agent du snapshot (expression selon son état réel). */
export function AgentPortrait({
  world,
  agent,
  size,
  crop = 'bust',
}: {
  world: WorldSnapshot;
  agent: AgentView;
  size: number;
  crop?: 'bust' | 'head';
}) {
  const color = world.departments.find((d) => d.id === agent.departmentId)?.color ?? null;
  const mood = moodOf(agent, Date.now(), world.tasks);
  return (
    <span
      className={`portrait-2d ${crop}`}
      style={{ width: size, height: crop === 'head' ? size : Math.round(size * 1.1) }}
      data-testid="portrait-2d"
      data-mood={mood}
      // Balisage généré localement à partir de couleurs et de formes fixes (aucune donnée saisie).
      dangerouslySetInnerHTML={{
        __html: portraitSvg({
          avatarId: agent.avatarId,
          agentId: agent.id,
          deptColor: color,
          mood,
          crop,
        }),
      }}
    />
  );
}
