/**
 * Plan du QG (hq-v1) : salles, cloisons, portes, mobilier et ancres.
 * Inspiré de examples/world-layout.json (coordonnées conceptuelles), adapté pour avoir des
 * couloirs connectés et aucune collision avec le mobilier. Données pures, sans rendu.
 */

export type RoomKind = 'department' | 'meeting' | 'cafe' | 'entry';
export type AnchorKind = 'desk' | 'meeting_seat' | 'cafe' | 'entry_spawn' | 'waiting';
export type FurnitureKind =
  | 'desk'
  | 'meeting_table'
  | 'counter'
  | 'cafe_table'
  | 'plant'
  | 'whiteboard'
  | 'server'
  | 'sofa'
  | 'reception';

export interface Tile {
  x: number;
  y: number;
}
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Room {
  id: string;
  label: string;
  color: string;
  kind: RoomKind;
  rect: Rect;
  walls: boolean;
  doors: Tile[];
}
export interface Furniture extends Tile {
  kind: FurnitureKind;
  roomId: string | null;
}
export interface Anchor extends Tile {
  id: string;
  kind: AnchorKind;
  roomId: string;
  /** Pour un poste : le bureau que l'agent regarde. */
  facing?: Tile;
}
export type TileKind = 'corridor' | 'floor' | 'wall' | 'door';

export interface WorldMap {
  id: string;
  version: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  rooms: Room[];
  furniture: Furniture[];
  anchors: Record<string, Anchor>;
  tileKind: (t: Tile) => TileKind;
  roomAt: (t: Tile) => Room | null;
  isWalkable: (t: Tile) => boolean;
}

interface RoomSpec {
  id: string;
  label: string;
  color: string;
  kind: RoomKind;
  rect: Rect;
  desks?: number;
}

const ROOM_SPECS: RoomSpec[] = [
  {
    id: 'cafe',
    label: 'Café & communauté',
    color: '#83C6C1',
    kind: 'cafe',
    rect: { x0: 1, y0: 1, x1: 8, y1: 7 },
  },
  {
    id: 'direction',
    label: 'Direction générale',
    color: '#E7C16A',
    kind: 'department',
    rect: { x0: 11, y0: 1, x1: 22, y1: 7 },
    desks: 6,
  },
  {
    id: 'finance',
    label: 'Finance',
    color: '#76C69A',
    kind: 'department',
    rect: { x0: 25, y0: 1, x1: 34, y1: 7 },
    desks: 6,
  },
  {
    id: 'sales',
    label: 'Sales',
    color: '#EA966C',
    kind: 'department',
    rect: { x0: 1, y0: 10, x1: 10, y1: 16 },
    desks: 6,
  },
  {
    id: 'meeting',
    label: 'Salle de réunion',
    color: '#D8D2C9',
    kind: 'meeting',
    rect: { x0: 13, y0: 10, x1: 22, y1: 16 },
  },
  {
    id: 'marketing',
    label: 'Studio / Marketing',
    color: '#9C84DE',
    kind: 'department',
    rect: { x0: 25, y0: 10, x1: 34, y1: 16 },
    desks: 6,
  },
  {
    id: 'entry',
    label: 'Accueil',
    color: '#D8C0A8',
    kind: 'entry',
    rect: { x0: 1, y0: 19, x1: 6, y1: 24 },
  },
  {
    id: 'rh',
    label: 'Ressources humaines',
    color: '#E8A5C0',
    kind: 'department',
    rect: { x0: 9, y0: 19, x1: 18, y1: 24 },
    desks: 6,
  },
  {
    id: 'operations',
    label: 'Operations',
    color: '#88BADC',
    kind: 'department',
    rect: { x0: 21, y0: 19, x1: 34, y1: 24 },
    desks: 6,
  },
  // ---------- Aile d'extension : locaux libres attribués aux nouveaux pôles ----------
  {
    id: 'annex-1',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 1, y0: 27, x1: 11, y1: 33 },
    desks: 6,
  },
  {
    id: 'annex-2',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 13, y0: 27, x1: 23, y1: 33 },
    desks: 6,
  },
  {
    id: 'annex-3',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 25, y0: 27, x1: 34, y1: 33 },
    desks: 6,
  },
];

/** Locaux de l'aile d'extension (nouveaux pôles), dans l'ordre d'attribution. */
export const ANNEX_ROOM_IDS = ['annex-1', 'annex-2', 'annex-3'] as const;

const key = (t: Tile): string => `${t.x},${t.y}`;
const inRect = (t: Tile, r: Rect): boolean =>
  t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1;
const pad = (n: number): string => String(n).padStart(2, '0');

export function buildHqMap(): WorldMap {
  const cols = 36;
  const rows = 35;
  const rooms: Room[] = [];
  const furniture: Furniture[] = [];
  const anchors: Record<string, Anchor> = {};
  const addAnchor = (a: Anchor): void => {
    anchors[a.id] = a;
  };

  for (const spec of ROOM_SPECS) {
    const { rect } = spec;
    const walls = spec.kind !== 'entry';
    // Portes de 2 tuiles au centre des bords haut et bas : connexion aux couloirs.
    const cx = Math.floor((rect.x0 + rect.x1) / 2);
    const doors = walls
      ? [
          { x: cx, y: rect.y0 },
          { x: cx + 1, y: rect.y0 },
          { x: cx, y: rect.y1 },
          { x: cx + 1, y: rect.y1 },
        ]
      : [];
    rooms.push({
      id: spec.id,
      label: spec.label,
      color: spec.color,
      kind: spec.kind,
      rect,
      walls,
      doors,
    });

    // Intérieur (hors cloisons)
    const ix0 = rect.x0 + (walls ? 1 : 0);
    const ix1 = rect.x1 - (walls ? 1 : 0);
    const iy0 = rect.y0 + (walls ? 1 : 0);
    const iy1 = rect.y1 - (walls ? 1 : 0);

    if (spec.kind === 'department') {
      // Postes : bureau (bloquant) + siège juste devant (ancre).
      const slots: Tile[] = [];
      for (const dy of [1, 3])
        for (const dx of [1, 4, 7, 10]) slots.push({ x: ix0 + dx - 1, y: iy0 + dy - 1 });
      const valid = slots.filter(
        (d) => d.x <= ix1 - 1 && d.y + 1 <= iy1 && d.x !== cx && d.x !== cx + 1,
      );
      valid.slice(0, spec.desks ?? 0).forEach((d, i) => {
        furniture.push({ kind: 'desk', x: d.x, y: d.y, roomId: spec.id });
        addAnchor({
          id: `${spec.id}-desk-${pad(i + 1)}`,
          kind: 'desk',
          roomId: spec.id,
          x: d.x,
          y: d.y + 1,
          facing: { x: d.x, y: d.y },
        });
      });
      furniture.push({ kind: 'plant', x: ix1, y: iy0, roomId: spec.id });
      furniture.push({
        kind: spec.id === 'operations' ? 'server' : 'whiteboard',
        x: ix1,
        y: iy1,
        roomId: spec.id,
      });
    }

    if (spec.kind === 'meeting') {
      const tx0 = cx - 1;
      for (let x = tx0; x <= tx0 + 3; x++) {
        for (const y of [12, 13]) furniture.push({ kind: 'meeting_table', x, y, roomId: spec.id });
      }
      let n = 1;
      for (let x = tx0; x <= tx0 + 3; x++) {
        addAnchor({
          id: `meeting-seat-${pad(n++)}`,
          kind: 'meeting_seat',
          roomId: spec.id,
          x,
          y: 11,
          facing: { x, y: 12 },
        });
        addAnchor({
          id: `meeting-seat-${pad(n++)}`,
          kind: 'meeting_seat',
          roomId: spec.id,
          x,
          y: 14,
          facing: { x, y: 13 },
        });
      }
      furniture.push({ kind: 'whiteboard', x: ix0, y: iy0, roomId: spec.id });
      furniture.push({ kind: 'plant', x: ix1, y: iy1, roomId: spec.id });
      furniture.push({ kind: 'plant', x: ix0, y: iy1, roomId: spec.id });
    }

    if (spec.kind === 'cafe') {
      const blocked: Furniture[] = [
        { kind: 'counter', x: ix0, y: iy0, roomId: spec.id },
        { kind: 'counter', x: ix0 + 1, y: iy0, roomId: spec.id },
        { kind: 'plant', x: ix1, y: iy0, roomId: spec.id },
        { kind: 'cafe_table', x: ix0 + 1, y: iy0 + 2, roomId: spec.id },
        { kind: 'cafe_table', x: ix1 - 1, y: iy0 + 3, roomId: spec.id },
        { kind: 'sofa', x: ix0, y: iy1, roomId: spec.id },
      ];
      furniture.push(...blocked);
      const isBlocked = (t: Tile): boolean => blocked.some((f) => f.x === t.x && f.y === t.y);
      let n = 1;
      for (let y = iy0; y <= iy1; y++) {
        for (let x = ix0; x <= ix1; x++) {
          const t = { x, y };
          const nearDoor = x === cx || x === cx + 1;
          if (!isBlocked(t) && !nearDoor)
            addAnchor({ id: `cafe-spot-${pad(n++)}`, kind: 'cafe', roomId: spec.id, x, y });
        }
      }
    }

    if (spec.kind === 'entry') {
      furniture.push({ kind: 'reception', x: 2, y: 20, roomId: spec.id });
      furniture.push({ kind: 'plant', x: 6, y: 24, roomId: spec.id });
      addAnchor({ id: 'entry-spawn', kind: 'entry_spawn', roomId: spec.id, x: 3, y: 23 });
      let n = 1;
      for (const t of [
        { x: 4, y: 21 },
        { x: 5, y: 21 },
        { x: 4, y: 22 },
        { x: 5, y: 22 },
      ]) {
        addAnchor({ id: `entry-wait-${pad(n++)}`, kind: 'waiting', roomId: spec.id, ...t });
      }
    }
  }
  // Plantes de couloir
  for (const t of [
    { x: 0, y: 8 },
    { x: 35, y: 8 },
    { x: 11, y: 17 },
    { x: 35, y: 17 },
    { x: 23, y: 0 },
    { x: 0, y: 26 },
    { x: 35, y: 26 },
  ]) {
    furniture.push({ kind: 'plant', ...t, roomId: null });
  }

  const furnitureAt = new Map(furniture.map((f) => [key(f), f]));
  const doorSet = new Set(rooms.flatMap((r) => r.doors.map(key)));

  const roomAt = (t: Tile): Room | null => rooms.find((r) => inRect(t, r.rect)) ?? null;
  const tileKind = (t: Tile): TileKind => {
    if (doorSet.has(key(t))) return 'door';
    const r = roomAt(t);
    if (!r) return 'corridor';
    if (
      r.walls &&
      (t.x === r.rect.x0 || t.x === r.rect.x1 || t.y === r.rect.y0 || t.y === r.rect.y1)
    ) {
      return 'wall';
    }
    return 'floor';
  };
  const isWalkable = (t: Tile): boolean =>
    t.x >= 0 &&
    t.y >= 0 &&
    t.x < cols &&
    t.y < rows &&
    tileKind(t) !== 'wall' &&
    !furnitureAt.has(key(t));

  return {
    id: 'hq-v1',
    version: 2,
    cols,
    rows,
    tileWidth: 64,
    tileHeight: 32,
    rooms,
    furniture,
    anchors,
    tileKind,
    roomAt,
    isWalkable,
  };
}

export const HQ_MAP = buildHqMap();

export function anchorsOfKind(map: WorldMap, kind: AnchorKind, roomId?: string): Anchor[] {
  return Object.values(map.anchors)
    .filter((a) => a.kind === kind && (roomId === undefined || a.roomId === roomId))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function isoToScreen(
  t: { x: number; y: number },
  origin: { x: number; y: number },
  map: Pick<WorldMap, 'tileWidth' | 'tileHeight'>,
): { x: number; y: number } {
  return {
    x: origin.x + ((t.x - t.y) * map.tileWidth) / 2,
    y: origin.y + ((t.x + t.y) * map.tileHeight) / 2,
  };
}
