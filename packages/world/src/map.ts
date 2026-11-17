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
  | 'reception'
  // Plateau ouvert « start-up » : décor bloquant (praticabilité identique en 2D et en 3D).
  | 'tree'
  | 'booth'
  | 'high_table'
  | 'pingpong'
  | 'beanbag'
  | 'armchair'
  | 'round_table';

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

/**
 * Plateau ouvert façon start-up : trois rangées de zones de couleur sans cloisons, séparées par
 * des atriums (arbre, cabines téléphoniques, mange-debout, ping-pong) ; une quatrième rangée
 * (aile d'extension) accueille les nouveaux pôles. Les identifiants d'ancres sont stables.
 */
const ROOM_SPECS: RoomSpec[] = [
  {
    id: 'sales',
    label: 'Sales',
    color: '#EA966C',
    kind: 'department',
    rect: { x0: 1, y0: 1, x1: 11, y1: 7 },
    desks: 6,
  },
  {
    id: 'direction',
    label: 'Direction générale',
    color: '#E7C16A',
    kind: 'department',
    rect: { x0: 12, y0: 1, x1: 23, y1: 7 },
    desks: 6,
  },
  {
    id: 'finance',
    label: 'Finance',
    color: '#76C69A',
    kind: 'department',
    rect: { x0: 24, y0: 1, x1: 34, y1: 7 },
    desks: 6,
  },
  {
    id: 'cafe',
    label: 'Café & lounge',
    color: '#83C6C1',
    kind: 'cafe',
    rect: { x0: 1, y0: 12, x1: 11, y1: 18 },
  },
  {
    id: 'meeting',
    label: 'Salle de réunion',
    color: '#D8D2C9',
    kind: 'meeting',
    rect: { x0: 12, y0: 12, x1: 23, y1: 18 },
  },
  {
    id: 'marketing',
    label: 'Studio / Marketing',
    color: '#9C84DE',
    kind: 'department',
    rect: { x0: 24, y0: 12, x1: 34, y1: 18 },
    desks: 6,
  },
  {
    id: 'entry',
    label: 'Accueil',
    color: '#D8C0A8',
    kind: 'entry',
    rect: { x0: 1, y0: 22, x1: 11, y1: 27 },
  },
  {
    id: 'rh',
    label: 'Ressources humaines',
    color: '#E8A5C0',
    kind: 'department',
    rect: { x0: 12, y0: 22, x1: 23, y1: 27 },
    desks: 6,
  },
  {
    id: 'operations',
    label: 'Operations',
    color: '#88BADC',
    kind: 'department',
    rect: { x0: 24, y0: 22, x1: 34, y1: 27 },
    desks: 6,
  },
  // ---------- Aile d'extension : locaux libres attribués aux nouveaux pôles ----------
  {
    id: 'annex-1',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 1, y0: 29, x1: 11, y1: 34 },
    desks: 6,
  },
  {
    id: 'annex-2',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 12, y0: 29, x1: 23, y1: 34 },
    desks: 6,
  },
  {
    id: 'annex-3',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 24, y0: 29, x1: 34, y1: 34 },
    desks: 6,
  },
];

/** Locaux de l'aile d'extension (nouveaux pôles), dans l'ordre d'attribution. */
export const ANNEX_ROOM_IDS = ['annex-1', 'annex-2', 'annex-3'] as const;

const key = (t: Tile): string => `${t.x},${t.y}`;
const inRect = (t: Tile, r: Rect): boolean =>
  t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1;
const pad = (n: number): string => String(n).padStart(2, '0');

/** Décor des atriums (hors locaux) : chaque tuile listée bloque le passage. */
const ATRIUM: [FurnitureKind, number, number][] = [
  // Atrium nord (y 8-11) : cabines, jardinière, mange-debout, grand arbre.
  ['booth', 2, 9],
  ['booth', 3, 9],
  ['plant', 7, 9],
  ['plant', 8, 9],
  ['high_table', 16, 9],
  ['high_table', 17, 9],
  ['high_table', 18, 9],
  ['tree', 28, 9],
  ['tree', 29, 9],
  ['tree', 28, 10],
  ['tree', 29, 10],
  ['plant', 0, 8],
  ['plant', 35, 8],
  ['plant', 22, 10],
  // Atrium sud (y 19-21) : ping-pong, poufs, cabine, plantes.
  ['pingpong', 7, 20],
  ['pingpong', 8, 20],
  ['beanbag', 15, 20],
  ['beanbag', 17, 20],
  ['booth', 32, 20],
  ['plant', 0, 20],
  ['plant', 35, 20],
  ['plant', 24, 20],
  // Passage vers l'aile d'extension.
  ['plant', 0, 28],
  ['plant', 35, 28],
  ['plant', 12, 28],
  ['plant', 24, 28],
];

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
    const { x0, y0, x1, y1 } = rect;
    // Plateau ouvert : aucune cloison, on circule librement entre les zones.
    rooms.push({
      id: spec.id,
      label: spec.label,
      color: spec.color,
      kind: spec.kind,
      rect,
      walls: false,
      doors: [],
    });

    if (spec.kind === 'department') {
      // Îlot de 6 postes dos à dos (3 + 3), séparés par une cloison basse.
      const rowA = y0 + 2;
      const rowB = y0 + 3;
      let n = 1;
      for (const [row, seatY] of [
        [rowA, y0 + 1],
        [rowB, y0 + 4],
      ] as const) {
        for (const dx of [1, 2, 3]) {
          const x = x0 + dx;
          furniture.push({ kind: 'desk', x, y: row, roomId: spec.id });
          if (n <= (spec.desks ?? 0))
            addAnchor({
              id: `${spec.id}-desk-${pad(n)}`,
              kind: 'desk',
              roomId: spec.id,
              x,
              y: seatY,
              facing: { x, y: row },
            });
          n++;
        }
      }
      // Coin réunion (table ronde) et coin lounge (fauteuils), tableau mobile, plantes.
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        furniture.push({ kind: 'round_table', x: x1 - 4 + dx, y: y0 + 1 + dy, roomId: spec.id });
      furniture.push({ kind: 'armchair', x: x1 - 1, y: y1 - 1, roomId: spec.id });
      furniture.push({ kind: 'armchair', x: x1 - 3, y: y1 - 1, roomId: spec.id });
      furniture.push({
        kind: spec.id === 'operations' ? 'server' : 'whiteboard',
        x: x0 + 6,
        y: y1,
        roomId: spec.id,
      });
      furniture.push({ kind: 'plant', x: x1, y: y0, roomId: spec.id });
      furniture.push({ kind: 'plant', x: x0, y: y1, roomId: spec.id });
    }

    if (spec.kind === 'meeting') {
      const cx = Math.floor((x0 + x1) / 2);
      const tx0 = cx - 1;
      for (let x = tx0; x <= tx0 + 3; x++) {
        for (const y of [y0 + 2, y0 + 3])
          furniture.push({ kind: 'meeting_table', x, y, roomId: spec.id });
      }
      let n = 1;
      for (let x = tx0; x <= tx0 + 3; x++) {
        addAnchor({
          id: `meeting-seat-${pad(n++)}`,
          kind: 'meeting_seat',
          roomId: spec.id,
          x,
          y: y0 + 1,
          facing: { x, y: y0 + 2 },
        });
        addAnchor({
          id: `meeting-seat-${pad(n++)}`,
          kind: 'meeting_seat',
          roomId: spec.id,
          x,
          y: y0 + 4,
          facing: { x, y: y0 + 3 },
        });
      }
      furniture.push({ kind: 'whiteboard', x: x0 + 1, y: y0, roomId: spec.id });
      furniture.push({ kind: 'armchair', x: x1 - 1, y: y1 - 1, roomId: spec.id });
      furniture.push({ kind: 'plant', x: x1, y: y0, roomId: spec.id });
      furniture.push({ kind: 'plant', x: x0, y: y1, roomId: spec.id });
    }

    if (spec.kind === 'cafe') {
      const blocked: Furniture[] = [
        { kind: 'counter', x: x0, y: y0, roomId: spec.id },
        { kind: 'counter', x: x0 + 1, y: y0, roomId: spec.id },
        { kind: 'counter', x: x0 + 2, y: y0, roomId: spec.id },
        { kind: 'plant', x: x1, y: y0, roomId: spec.id },
        { kind: 'cafe_table', x: x0 + 2, y: y0 + 3, roomId: spec.id },
        { kind: 'cafe_table', x: x0 + 6, y: y0 + 3, roomId: spec.id },
        { kind: 'sofa', x: x0 + 1, y: y1, roomId: spec.id },
        { kind: 'sofa', x: x0 + 2, y: y1, roomId: spec.id },
        { kind: 'armchair', x: x1 - 1, y: y1, roomId: spec.id },
        { kind: 'beanbag', x: x1 - 2, y: y1 - 2, roomId: spec.id },
      ];
      furniture.push(...blocked);
      const isBlocked = (t: Tile): boolean => blocked.some((f) => f.x === t.x && f.y === t.y);
      let n = 1;
      for (let y = y0 + 1; y <= y1 - 1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = { x, y };
          if (!isBlocked(t))
            addAnchor({ id: `cafe-spot-${pad(n++)}`, kind: 'cafe', roomId: spec.id, x, y });
        }
      }
    }

    if (spec.kind === 'entry') {
      furniture.push({ kind: 'reception', x: x0 + 1, y: y0 + 1, roomId: spec.id });
      furniture.push({ kind: 'plant', x: x1, y: y1, roomId: spec.id });
      furniture.push({ kind: 'armchair', x: x0 + 7, y: y0 + 1, roomId: spec.id });
      furniture.push({ kind: 'armchair', x: x0 + 9, y: y0 + 1, roomId: spec.id });
      addAnchor({ id: 'entry-spawn', kind: 'entry_spawn', roomId: spec.id, x: x0 + 2, y: y1 });
      let n = 1;
      for (const t of [
        { x: x0 + 7, y: y0 + 3 },
        { x: x0 + 8, y: y0 + 3 },
        { x: x0 + 7, y: y0 + 4 },
        { x: x0 + 8, y: y0 + 4 },
      ]) {
        addAnchor({ id: `entry-wait-${pad(n++)}`, kind: 'waiting', roomId: spec.id, ...t });
      }
    }
  }
  for (const [kind, x, y] of ATRIUM) furniture.push({ kind, x, y, roomId: null });

  const furnitureAt = new Map(furniture.map((f) => [key(f), f]));

  const roomAt = (t: Tile): Room | null => rooms.find((r) => inRect(t, r.rect)) ?? null;
  const tileKind = (t: Tile): TileKind => (roomAt(t) ? 'floor' : 'corridor');
  const isWalkable = (t: Tile): boolean =>
    t.x >= 0 && t.y >= 0 && t.x < cols && t.y < rows && !furnitureAt.has(key(t));

  return {
    id: 'hq-v1',
    version: 3,
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
