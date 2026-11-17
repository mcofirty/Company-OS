import type { AgentView, InvocationView } from '@company-os/contracts';
import type { Tile, VisualIntent, WorldMap } from '@company-os/world';
import { findPath } from '@company-os/world';

/**
 * Fonctions pures du rendu 3D « studio » (testées sans WebGL) : apparence des personnages,
 * bulles d'activité, couleurs de sol, trajets lissés.
 */

const SKIN = ['#f2cba8', '#d9a47f', '#a8714c', '#6f4630', '#f6d8c0', '#c58c63'];
const HAIR = ['#2b1d14', '#5a3a22', '#d1a85e', '#161616', '#8a4b2a', '#e2ddd5', '#3b2a20'];
const TOPS = [
  '#f2f0ea',
  '#e2b33f',
  '#3b6fb6',
  '#d9663f',
  '#5c9a73',
  '#2e2e34',
  '#c95c7c',
  '#7d63c4',
  '#4fa3b8',
];
const PANTS = ['#2f3542', '#3d4a66', '#4a3f35', '#20242c', '#6b5b4b'];

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Appearance {
  skin: string;
  hair: string;
  top: string;
  pants: string;
  /** 0 : cheveux courts ; 1 : longs ; 2 : chignon. */
  style: 0 | 1 | 2;
}
/** Apparence stable d'un personnage, dérivée de son identifiant d'avatar. */
export function appearanceOf(avatarId: string): Appearance {
  const h = hash(avatarId);
  const pick = <T>(arr: readonly T[], k: number): T => arr[(h >>> k) % arr.length] as T;
  return {
    skin: pick(SKIN, 0),
    hair: pick(HAIR, 5),
    top: pick(TOPS, 10),
    pants: pick(PANTS, 15),
    style: ((h >>> 20) % 3) as 0 | 1 | 2,
  };
}

/** Teinte pastel d'une couleur de pôle pour le sol (mélange avec du blanc). */
export function pastel(hex: string, k = 0.6): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#e9e4dc';
  const n = parseInt(m[1]!, 16);
  const mix = (c: number): string =>
    Math.round(c + (255 - c) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

function shortWords(s: string, n: number): string {
  const w = s
    .replace(/[«»"—–-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .join(' ');
  return w.length > 26 ? `${w.slice(0, 25)}…` : w;
}
function pictogram(title: string): string {
  const t = title.toLowerCase();
  if (/rapport|synth|bilan|point/.test(t)) return '📊';
  if (/veille|recherche|analyse|étude/.test(t)) return '🔎';
  if (/email|mail|relance|répon/.test(t)) return '✉️';
  if (/factur|budget|compta|paie/.test(t)) return '💶';
  if (/recrut|candidat/.test(t)) return '👤';
  return '✍️';
}

export type BubbleKind = 'work' | 'tool' | 'alert' | 'danger' | 'meet' | 'life' | '';
/**
 * Bulle au-dessus d'un agent. Le travail réel (mission, outil, validation, blocage, réunion)
 * vient du snapshot ; la vie de bureau (kind « life ») n'est affichée que pour un agent inoccupé.
 */
export function bubbleFor(
  a: AgentView,
  intent: VisualIntent | null,
  inv: InvocationView | undefined,
  tools: Map<string, { name: string }>,
  titles: Map<string, string>,
): { text: string; kind: BubbleKind } {
  const title = a.currentTaskId ? titles.get(a.currentTaskId) : undefined;
  if (a.activity === 'using_tool' && inv)
    return { text: `🛠️ ${shortWords(tools.get(inv.toolId)?.name ?? inv.toolId, 3)}`, kind: 'tool' };
  if (a.activity === 'waiting_approval') return { text: '⏳ Attend ta validation', kind: 'alert' };
  if (a.activity === 'blocked') return { text: '⚠️ Bloqué', kind: 'danger' };
  if (a.activity === 'in_meeting') return { text: '◎ En réunion', kind: 'meet' };
  if ((a.activity === 'working' || a.activity === 'thinking' || a.currentTaskId) && title)
    return { text: `${pictogram(title)} ${shortWords(title, 4)}`, kind: 'work' };
  if (a.activity === 'queued') return { text: '🕐 En file d’attente', kind: 'work' };
  const LIFE: Record<string, string> = {
    coffee: '☕ Pause café',
    chat: '💬 Discute',
    read: '📖 Lit la veille',
    stretch: '🙆 S’étire',
    plants: '🌱 Arrose les plantes',
  };
  if (intent?.life) return { text: LIFE[intent.life] ?? '', kind: 'life' };
  if (intent?.mode === 'break') return { text: '☕ Pause', kind: 'life' };
  return { text: '', kind: '' };
}

/** Libellé court de l'état (« Léo · au travail »). */
export function stateLabel(a: AgentView, intent: VisualIntent | null): string {
  if (a.status === 'paused') return 'en pause (suspendu)';
  switch (a.activity) {
    case 'working':
    case 'thinking':
    case 'using_tool':
      return 'au travail';
    case 'waiting_approval':
      return 'attend ta validation';
    case 'blocked':
      return 'bloqué';
    case 'in_meeting':
      return 'en réunion';
    case 'queued':
      return 'en file d’attente';
    default:
      return intent?.life || intent?.mode === 'break' ? 'en pause' : 'disponible';
  }
}

/** Ligne droite praticable entre deux points (échantillonnage des tuiles traversées). */
function clear(a: { x: number; z: number }, b: { x: number; z: number }, map: WorldMap): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / 0.2));
  for (let k = 1; k < n; k++) {
    const x = a.x + ((b.x - a.x) * k) / n;
    const z = a.z + ((b.z - a.z) * k) / n;
    // Marge latérale : on vérifie aussi les tuiles voisines touchées par le corps.
    for (const [ox, oz] of [
      [0, 0],
      [0.22, 0],
      [-0.22, 0],
      [0, 0.22],
      [0, -0.22],
    ] as const) {
      const t: Tile = { x: Math.floor(x + ox), y: Math.floor(z + oz) };
      if (!map.isWalkable(t)) return false;
    }
  }
  return true;
}

/**
 * Trajet d'un point à un autre : A* sur les tuiles du plan (mêmes règles que le rendu 2D),
 * puis lissage (on saute aux tuiles visibles en ligne droite). Retourne [] si inaccessible.
 */
export function studioPath(
  from: { x: number; z: number },
  to: { x: number; z: number },
  map: WorldMap,
): { x: number; z: number }[] {
  const start = { x: Math.floor(from.x), y: Math.floor(from.z) };
  const goal = { x: Math.floor(to.x), y: Math.floor(to.z) };
  if (start.x === goal.x && start.y === goal.y) {
    return Math.hypot(to.x - from.x, to.z - from.z) > 0.01 ? [to] : [];
  }
  const tiles = findPath(
    start,
    goal,
    (t) => map.isWalkable(t) || (t.x === start.x && t.y === start.y),
  );
  if (!tiles || !tiles.length) return [];
  const pts = tiles.map((t) => ({ x: t.x + 0.5, z: t.y + 0.5 }));
  pts[pts.length - 1] = to;
  const out: { x: number; z: number }[] = [];
  let cur = from;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clear(cur, pts[j]!, map)) j--;
    out.push(pts[j]!);
    cur = pts[j]!;
    i = j + 1;
  }
  return out;
}
