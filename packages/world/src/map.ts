/**
 * Plan du QG (hq-v1, version 4 « Campus ») : salles, murs, portes, mobilier et ancres.
 * Données pures, sans rendu ; couloirs connectés et aucune collision avec le mobilier.
 */

export type RoomKind = 'department' | 'meeting' | 'cafe' | 'entry' | 'amenity';
export type RugMotif = 'dots' | 'diamonds' | 'stripes';
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
  | 'round_table'
  | 'foosball'
  | 'arcade'
  | 'bleacher'
  | 'bike_rack'
  | 'fridge'
  // Plan « Campus » : salles d'agrément.
  | 'bookshelf'
  | 'pool_table'
  | 'tv'
  | 'exec_desk'
  | 'kitchen_island'
  | 'stage'
  | 'auditorium_seat';

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
  /** Motif du tapis de la zone (rendu). */
  motif?: RugMotif;
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
  /** Tuiles de murs (cloisons et façades), bloquantes. */
  wallTiles: Tile[];
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
  walls?: boolean;
  doors?: Tile[];
  motif?: RugMotif;
}

/**
 * Plan « Campus » (v4) : un grand plateau central en zones pastel (un pôle par zone, deux îlots de
 * six postes), entouré de salles fermées à murs bas (réunion, café, accueil, salles d'agrément,
 * locaux libres pour les nouveaux pôles). Les murs sont des tuiles bloquantes, les portes des
 * ouvertures. Les identifiants de salles et d'ancres restent stables d'une version à l'autre.
 */
const ROOM_SPECS: RoomSpec[] = [
  // ---- plateau central : zones de pôles, sans cloisons
  {
    id: 'sales',
    label: 'Sales',
    color: '#EA966C',
    kind: 'department',
    rect: { x0: 11, y0: 9, x1: 21, y1: 16 },
    motif: 'dots',
  },
  {
    id: 'finance',
    label: 'Finance',
    color: '#76C69A',
    kind: 'department',
    rect: { x0: 23, y0: 9, x1: 33, y1: 16 },
    motif: 'diamonds',
  },
  {
    id: 'direction',
    label: 'Direction générale',
    color: '#E7C16A',
    kind: 'department',
    rect: { x0: 35, y0: 9, x1: 45, y1: 16 },
    motif: 'stripes',
  },
  {
    id: 'marketing',
    label: 'Studio / Marketing',
    color: '#9C84DE',
    kind: 'department',
    rect: { x0: 11, y0: 19, x1: 21, y1: 27 },
    motif: 'diamonds',
  },
  {
    id: 'rh',
    label: 'Ressources humaines',
    color: '#E8A5C0',
    kind: 'department',
    rect: { x0: 23, y0: 19, x1: 33, y1: 27 },
    motif: 'dots',
  },
  {
    id: 'operations',
    label: 'Operations',
    color: '#88BADC',
    kind: 'department',
    rect: { x0: 35, y0: 19, x1: 45, y1: 27 },
    motif: 'stripes',
  },
  {
    id: 'play',
    label: 'Jeux & détente',
    color: '#F0C27A',
    kind: 'amenity',
    rect: { x0: 1, y0: 9, x1: 9, y1: 27 },
    motif: 'diamonds',
  },
  // ---- rangée nord
  {
    id: 'entry',
    label: 'Accueil',
    color: '#E9B9A0',
    kind: 'entry',
    rect: { x0: 1, y0: 1, x1: 9, y1: 7 },
    motif: 'dots',
  },
  {
    id: 'ceo',
    label: 'Bureau de la direction',
    color: '#8F7FBF',
    kind: 'amenity',
    rect: { x0: 11, y0: 1, x1: 18, y1: 7 },
    walls: true,
    doors: [{ x: 14, y: 8 }],
    motif: 'diamonds',
  },
  {
    id: 'meeting',
    label: 'Agora',
    color: '#8DBFA3',
    kind: 'meeting',
    rect: { x0: 20, y0: 1, x1: 28, y1: 7 },
    walls: true,
    doors: [{ x: 24, y: 8 }],
    motif: 'stripes',
  },
  {
    id: 'library',
    label: 'Bibliothèque',
    color: '#E39A7C',
    kind: 'amenity',
    rect: { x0: 30, y0: 1, x1: 36, y1: 7 },
    walls: true,
    doors: [{ x: 33, y: 8 }],
    motif: 'diamonds',
  },
  {
    id: 'focus',
    label: 'Salle calme',
    color: '#A9B4E6',
    kind: 'amenity',
    rect: { x0: 38, y0: 1, x1: 43, y1: 7 },
    walls: true,
    doors: [{ x: 40, y: 8 }],
    motif: 'dots',
  },
  {
    id: 'servers',
    label: 'Salle serveurs',
    color: '#AEB6C2',
    kind: 'amenity',
    rect: { x0: 45, y0: 1, x1: 55, y1: 7 },
    walls: true,
    doors: [{ x: 50, y: 8 }],
    motif: 'stripes',
  },
  // ---- colonne est
  {
    id: 'townhall',
    label: 'Town hall',
    color: '#D9826A',
    kind: 'amenity',
    rect: { x0: 47, y0: 9, x1: 55, y1: 19 },
    walls: true,
    doors: [{ x: 46, y: 14 }],
    motif: 'diamonds',
  },
  {
    id: 'annex-1',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 47, y0: 21, x1: 55, y1: 27 },
    walls: true,
    doors: [
      { x: 46, y: 24 },
      { x: 51, y: 28 },
    ],
    motif: 'dots',
  },
  // ---- rangée sud
  {
    id: 'auditorium',
    label: 'Amphithéâtre',
    color: '#D99AA6',
    kind: 'amenity',
    rect: { x0: 1, y0: 29, x1: 9, y1: 35 },
    walls: true,
    doors: [{ x: 9, y: 28 }],
    motif: 'dots',
  },
  {
    id: 'cafe',
    label: 'Café‑jardin',
    color: '#ECB08F',
    kind: 'cafe',
    rect: { x0: 11, y0: 29, x1: 19, y1: 35 },
    walls: true,
    doors: [{ x: 15, y: 28 }],
    motif: 'diamonds',
  },
  {
    id: 'kitchen',
    label: 'Cuisine',
    color: '#9FCDE6',
    kind: 'amenity',
    rect: { x0: 21, y0: 29, x1: 27, y1: 35 },
    walls: true,
    doors: [{ x: 24, y: 28 }],
    motif: 'stripes',
  },
  {
    id: 'annex-2',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 29, y0: 29, x1: 36, y1: 35 },
    walls: true,
    doors: [{ x: 33, y: 28 }],
    motif: 'dots',
  },
  {
    id: 'games',
    label: 'Salle de jeux',
    color: '#F3CF7F',
    kind: 'amenity',
    rect: { x0: 38, y0: 29, x1: 45, y1: 35 },
    walls: true,
    doors: [{ x: 42, y: 28 }],
    motif: 'diamonds',
  },
  {
    id: 'annex-3',
    label: 'Espace libre',
    color: '#CFC6DA',
    kind: 'department',
    rect: { x0: 47, y0: 29, x1: 55, y1: 35 },
    walls: true,
    doors: [{ x: 51, y: 28 }],
    motif: 'dots',
  },
];

/** Locaux libres attribués aux nouveaux pôles, dans l'ordre d'attribution. */
export const ANNEX_ROOM_IDS = ['annex-1', 'annex-2', 'annex-3'] as const;

const key = (t: Tile): string => `${t.x},${t.y}`;
const inRect = (t: Tile, r: Rect): boolean =>
  t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1;
const pad = (n: number): string => String(n).padStart(2, '0');

const COLS = 57;
const ROWS = 37;

/** Murs (lignes de tuiles), portes comprises : les portes sont retirées ensuite. */
const WALL_LINES: [number, number, number, number][] = [
  // périmètre
  [0, 0, COLS - 1, 0],
  [0, ROWS - 1, COLS - 1, ROWS - 1],
  [0, 0, 0, ROWS - 1],
  [COLS - 1, 0, COLS - 1, ROWS - 1],
  // rangée nord
  [10, 8, 56, 8],
  [10, 0, 10, 8],
  [19, 0, 19, 8],
  [29, 0, 29, 8],
  [37, 0, 37, 8],
  [44, 0, 44, 8],
  // colonne est
  [46, 8, 46, 28],
  [46, 20, 56, 20],
  // rangée sud
  [0, 28, 56, 28],
  [10, 28, 10, 36],
  [20, 28, 20, 36],
  [28, 28, 28, 36],
  [37, 28, 37, 36],
  [46, 28, 46, 36],
];

/** Décor des allées (hors salles) : chaque tuile listée bloque le passage. */
const AISLE: [FurnitureKind, number, number][] = [
  ['tree', 28, 17],
  ['tree', 29, 17],
  ['tree', 28, 18],
  ['tree', 29, 18],
  ['booth', 16, 17],
  ['booth', 40, 17],
  ['booth', 41, 17],
  ['plant', 13, 18],
  ['plant', 44, 18],
  ['plant', 22, 9],
  ['plant', 34, 27],
  ['bike_rack', 2, 8],
  ['bike_rack', 3, 8],
];

/** Mobilier fixe des salles d'agrément et de jeux. */
function amenityFurniture(id: string, r: Rect): [FurnitureKind, number, number][] {
  const out: [FurnitureKind, number, number][] = [];
  const row = (k: FurnitureKind, x0: number, x1: number, y: number): void => {
    for (let x = x0; x <= x1; x++) out.push([k, x, y]);
  };
  switch (id) {
    case 'play':
      out.push(['pingpong', 4, 11], ['pingpong', 5, 11]);
      out.push(['pool_table', 4, 16], ['pool_table', 5, 16]);
      out.push(['foosball', 4, 21], ['foosball', 5, 21]);
      out.push(['arcade', 1, 13], ['arcade', 1, 14]);
      out.push(['beanbag', 7, 23], ['beanbag', 8, 24], ['beanbag', 6, 25], ['beanbag', 3, 25]);
      out.push(['sofa', 7, 27], ['sofa', 8, 27], ['plant', 9, 9], ['plant', 1, 27]);
      break;
    case 'ceo':
      row('bookshelf', 13, 16, 1);
      out.push(['exec_desk', 14, 4], ['exec_desk', 15, 4]);
      out.push(['sofa', 14, 7], ['sofa', 15, 7], ['plant', 11, 1], ['plant', 18, 7]);
      break;
    case 'library':
      row('bookshelf', 30, 36, 1);
      for (let y = 2; y <= 5; y++) out.push(['bookshelf', 30, y]);
      out.push(['armchair', 33, 4], ['armchair', 35, 4], ['cafe_table', 34, 5], ['plant', 36, 7]);
      break;
    case 'focus':
      out.push(['beanbag', 39, 3], ['beanbag', 41, 4], ['beanbag', 39, 6], ['armchair', 42, 2]);
      out.push(['plant', 43, 7]);
      break;
    case 'servers':
      for (let x = r.x0 + 1; x <= r.x1 - 1; x++) {
        if (x === 50) continue; // allée face à la porte
        out.push(['server', x, 2], ['server', x, 5]);
      }
      break;
    case 'townhall':
      out.push(['tv', 51, 9], ['tv', 52, 9]);
      row('bleacher', 48, 54, 14);
      row('bleacher', 48, 54, 17);
      out.push(['plant', 47, 9], ['plant', 55, 19]);
      break;
    case 'auditorium':
      for (let y = 30; y <= 34; y++) out.push(['stage', 1, y]);
      for (const x of [3, 4, 5, 6, 7, 8])
        for (const y of [29, 30, 31, 33, 34, 35]) out.push(['auditorium_seat', x, y]);
      break;
    case 'kitchen':
      row('counter', 21, 26, 35);
      out.push(['fridge', 27, 35]);
      row('kitchen_island', 23, 25, 32);
      out.push(['plant', 21, 29]);
      break;
    case 'games':
      out.push(['arcade', 38, 35], ['arcade', 39, 35], ['arcade', 40, 35]);
      out.push(['tv', 44, 29], ['sofa', 43, 31], ['sofa', 44, 31], ['plant', 38, 29]);
      break;
    default:
      break;
  }
  return out;
}

export function buildHqMap(): WorldMap {
  const cols = COLS;
  const rows = ROWS;
  const rooms: Room[] = [];
  const furniture: Furniture[] = [];
  const anchors: Record<string, Anchor> = {};
  const addAnchor = (a: Anchor): void => {
    anchors[a.id] = a;
  };

  const doorSet = new Set<string>();
  for (const spec of ROOM_SPECS) for (const d of spec.doors ?? []) doorSet.add(key(d));
  // Entrée principale : porte vitrée sur la façade nord de l'accueil.
  doorSet.add(key({ x: 5, y: 0 }));
  const wallSet = new Set<string>();
  for (const [x0, y0, x1, y1] of WALL_LINES)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        const k = key({ x, y });
        if (!doorSet.has(k)) wallSet.add(k);
      }
  // L'accueil s'ouvre sur l'espace jeux (pas de mur entre eux) : déjà le cas, aucun segment.

  for (const spec of ROOM_SPECS) {
    const { rect } = spec;
    const { x0, y0, x1, y1 } = rect;
    rooms.push({
      id: spec.id,
      label: spec.label,
      color: spec.color,
      kind: spec.kind,
      rect,
      walls: spec.walls ?? false,
      doors: spec.doors ?? [],
      motif: spec.motif ?? 'dots',
    });

    if (spec.kind === 'department') {
      // Îlots de six postes dos à dos (3 + 3) ; deux îlots dans les grandes zones.
      const islands = y1 - y0 >= 7 ? [y0, y0 + 4] : [y0];
      let n = 1;
      for (const top of islands) {
        for (const [row, seatY] of [
          [top + 1, top],
          [top + 2, top + 3],
        ] as const) {
          for (const dx of [1, 2, 3]) {
            const x = x0 + dx;
            furniture.push({ kind: 'desk', x, y: row, roomId: spec.id });
            addAnchor({
              id: `${spec.id}-desk-${pad(n++)}`,
              kind: 'desk',
              roomId: spec.id,
              x,
              y: seatY,
              facing: { x, y: row },
            });
          }
        }
      }
      // Coin réunion (table ronde), coin salon, tableau, plantes.
      const tx = x1 - 3;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        furniture.push({ kind: 'round_table', x: tx + dx, y: y0 + 1 + dy, roomId: spec.id });
      if (islands.length > 1) {
        furniture.push({ kind: 'sofa', x: x1 - 3, y: y1 - 1, roomId: spec.id });
        furniture.push({ kind: 'sofa', x: x1 - 2, y: y1 - 1, roomId: spec.id });
        furniture.push({
          kind: spec.id === 'operations' ? 'server' : 'whiteboard',
          x: x0 + 6,
          y: y0 + 4,
          roomId: spec.id,
        });
      }
      // Plantes loin des portes des salles voisines.
      furniture.push({ kind: 'plant', x: x1, y: y0 + 3, roomId: spec.id });
      furniture.push({ kind: 'plant', x: x0 + 5, y: y1, roomId: spec.id });
    }

    if (spec.kind === 'meeting') {
      const tx0 = x0 + 2;
      for (let x = tx0; x <= tx0 + 3; x++)
        for (const y of [y0 + 2, y0 + 3])
          furniture.push({ kind: 'meeting_table', x, y, roomId: spec.id });
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
      furniture.push({ kind: 'tv', x: tx0 + 1, y: y0, roomId: spec.id });
      furniture.push({ kind: 'tv', x: tx0 + 2, y: y0, roomId: spec.id });
      furniture.push({ kind: 'plant', x: x1, y: y0, roomId: spec.id });
      furniture.push({ kind: 'plant', x: x0, y: y1, roomId: spec.id });
      furniture.push({ kind: 'armchair', x: x1, y: y1, roomId: spec.id });
    }

    if (spec.kind === 'cafe') {
      const blocked: Furniture[] = [
        { kind: 'counter', x: x0, y: y1, roomId: spec.id },
        { kind: 'counter', x: x0 + 1, y: y1, roomId: spec.id },
        { kind: 'counter', x: x0 + 2, y: y1, roomId: spec.id },
        { kind: 'plant', x: x0, y: y0, roomId: spec.id },
        { kind: 'plant', x: x1, y: y0, roomId: spec.id },
        { kind: 'plant', x: x1, y: y1, roomId: spec.id },
        { kind: 'tree', x: x0 + 4, y: y0 + 3, roomId: spec.id },
        { kind: 'cafe_table', x: x0 + 2, y: y0 + 1, roomId: spec.id },
        { kind: 'cafe_table', x: x0 + 6, y: y0 + 1, roomId: spec.id },
        { kind: 'cafe_table', x: x0 + 2, y: y0 + 5, roomId: spec.id },
        { kind: 'cafe_table', x: x0 + 6, y: y0 + 5, roomId: spec.id },
        { kind: 'sofa', x: x1 - 1, y: y1, roomId: spec.id },
      ];
      furniture.push(...blocked);
      const isBlocked = (t: Tile): boolean => blocked.some((f) => f.x === t.x && f.y === t.y);
      let n = 1;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = { x, y };
          // La tuile devant la porte reste libre (passage).
          if (isBlocked(t) || (x === 15 && y === y0)) continue;
          addAnchor({ id: `cafe-spot-${pad(n++)}`, kind: 'cafe', roomId: spec.id, x, y });
        }
      }
    }

    if (spec.kind === 'entry') {
      furniture.push({ kind: 'reception', x: 4, y: 3, roomId: spec.id });
      furniture.push({ kind: 'sofa', x: 1, y: 1, roomId: spec.id });
      furniture.push({ kind: 'sofa', x: 2, y: 1, roomId: spec.id });
      furniture.push({ kind: 'plant', x: 9, y: 1, roomId: spec.id });
      furniture.push({ kind: 'plant', x: 1, y: 7, roomId: spec.id });
      furniture.push({ kind: 'armchair', x: 8, y: 2, roomId: spec.id });
      addAnchor({ id: 'entry-spawn', kind: 'entry_spawn', roomId: spec.id, x: 5, y: 1 });
      let n = 1;
      for (const t of [
        { x: 7, y: 5 },
        { x: 8, y: 5 },
        { x: 7, y: 6 },
        { x: 8, y: 6 },
      ]) {
        addAnchor({ id: `entry-wait-${pad(n++)}`, kind: 'waiting', roomId: spec.id, ...t });
      }
    }

    if (spec.kind === 'amenity')
      for (const [kind, x, y] of amenityFurniture(spec.id, rect))
        furniture.push({ kind, x, y, roomId: spec.id });
  }
  for (const [kind, x, y] of AISLE) furniture.push({ kind, x, y, roomId: null });

  const furnitureAt = new Map(furniture.map((f) => [key(f), f]));

  const roomAt = (t: Tile): Room | null => rooms.find((r) => inRect(t, r.rect)) ?? null;
  const tileKind = (t: Tile): TileKind => {
    const k = key(t);
    if (wallSet.has(k)) return 'wall';
    if (doorSet.has(k)) return 'door';
    return roomAt(t) ? 'floor' : 'corridor';
  };
  const isWalkable = (t: Tile): boolean =>
    t.x >= 0 &&
    t.y >= 0 &&
    t.x < cols &&
    t.y < rows &&
    !wallSet.has(key(t)) &&
    t.y > 0 && // façade nord (porte d'entrée comprise) : on ne sort pas du bâtiment
    !furnitureAt.has(key(t));

  const wallTiles: Tile[] = [...wallSet].map((k) => {
    const [x, y] = k.split(',').map(Number) as [number, number];
    return { x, y };
  });

  return {
    id: 'hq-v1',
    version: 4,
    cols,
    rows,
    tileWidth: 64,
    tileHeight: 32,
    rooms,
    furniture,
    anchors,
    wallTiles,
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
