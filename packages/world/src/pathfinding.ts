import type { Tile } from './map';

/**
 * A* 4-directions (pas de diagonale à travers le mobilier). Retourne le chemin sans la tuile
 * de départ, ou null si la cible est inaccessible.
 */
export function findPath(
  start: Tile,
  goal: Tile,
  isWalkable: (t: Tile) => boolean,
  maxNodes = 5000,
): Tile[] | null {
  const k = (t: Tile): string => `${t.x},${t.y}`;
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!isWalkable(goal)) return null;
  const h = (t: Tile): number => Math.abs(t.x - goal.x) + Math.abs(t.y - goal.y);
  const open: { t: Tile; f: number; g: number }[] = [{ t: start, f: h(start), g: 0 }];
  const came = new Map<string, Tile>();
  const gScore = new Map<string, number>([[k(start), 0]]);
  const closed = new Set<string>();
  let expanded = 0;

  while (open.length > 0 && expanded < maxNodes) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[best]!;
      if (a.f < b.f || (a.f === b.f && a.g > b.g)) best = i;
    }
    const cur = open.splice(best, 1)[0]!;
    const ck = k(cur.t);
    if (closed.has(ck)) continue;
    if (cur.t.x === goal.x && cur.t.y === goal.y) {
      const path: Tile[] = [];
      let node: Tile | undefined = cur.t;
      while (node && k(node) !== k(start)) {
        path.unshift(node);
        node = came.get(k(node));
      }
      return path;
    }
    closed.add(ck);
    expanded++;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: cur.t.x + dx, y: cur.t.y + dy };
      const nk = k(n);
      if (closed.has(nk) || !isWalkable(n)) continue;
      const g = cur.g + 1;
      if (g < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, g);
        came.set(nk, cur.t);
        open.push({ t: n, g, f: g + h(n) });
      }
    }
  }
  return null;
}
