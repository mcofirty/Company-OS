import * as Phaser from 'phaser';
import type { AgentView, InvocationView, WorldSnapshot } from '@company-os/contracts';
import {
  departmentPresence,
  findPath,
  meetingSeats,
  HQ_MAP,
  visualIntent,
  type Anchor,
  type Furniture,
  type Room,
  type Tile,
  type VisualIntent,
} from '@company-os/world';
import {
  AVATAR_H,
  avatarKey,
  darken,
  generateTextures,
  hex,
  PX,
  type AvatarFrame,
  type AvatarView,
} from './textures';

/**
 * Projection visuelle du QG. Ne détient aucun état métier : elle reçoit le snapshot
 * (issu des événements backend) et anime les transitions. Les déplacements sont locaux
 * et ne modifient jamais le statut métier.
 */

export type Selection =
  | { kind: 'agent'; id: string }
  | { kind: 'department'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'invocation'; id: string }
  | { kind: 'tool'; id: string }
  | { kind: 'approval'; id: string }
  | { kind: 'meeting'; id: string };

export interface HqSceneCallbacks {
  onSelect: (sel: Selection | null) => void;
}

const TW = HQ_MAP.tileWidth;
const TH = HQ_MAP.tileHeight;
const COLS = HQ_MAP.cols;
const ROWS = HQ_MAP.rows;
const WALL_H = 120;
const PARTITION_H = 16;
const STEP_MS = 170;

interface AvatarObj {
  agent: AgentView;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Ellipse;
  name: Phaser.GameObjects.Container;
  chip: Phaser.GameObjects.Container;
  chipText: Phaser.GameObjects.Text;
  chipBg: Phaser.GameObjects.Graphics;
  hit: Phaser.GameObjects.Zone;
  tile: Tile;
  target: Anchor | null;
  intent: VisualIntent | null;
  view: AvatarView;
  flip: boolean;
  walking: boolean;
  hovered: boolean;
  frameTimer: Phaser.Time.TimerEvent | null;
}

export class HqScene extends Phaser.Scene {
  private origin = { x: 0, y: 0 };
  private avatars = new Map<string, AvatarObj>();
  private monitors = new Map<string, Phaser.GameObjects.Rectangle>();
  private labels = new Map<
    string,
    { text: Phaser.GameObjects.Text; bg: Phaser.GameObjects.Graphics; color: number }
  >();
  private ready = false;
  private firstSync = true;
  private pending: { world: WorldSnapshot; sel: Selection | null; now: number } | null = null;
  private selection: Selection | null = null;
  private reducedMotion = false;
  private dragging = false;
  private dragMoved = 0;

  constructor(private readonly cb: HqSceneCallbacks) {
    super('hq');
  }

  // ---------- géométrie ----------
  /** Point de grille (coins des tuiles) -> monde. */
  private P(gx: number, gy: number): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(
      this.origin.x + ((gx - gy) * TW) / 2,
      this.origin.y + ((gx + gy) * TH) / 2,
    );
  }
  private center(t: Tile): Phaser.Math.Vector2 {
    return this.P(t.x + 0.5, t.y + 0.5);
  }

  create(): void {
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    generateTextures(this);
    this.origin = { x: ROWS * (TW / 2) + 60, y: WALL_H + 80 };
    this.cameras.main.setBackgroundColor('#d6bde9');
    this.drawSky();
    this.drawFloor();
    this.drawBuildingWalls();
    for (const r of HQ_MAP.rooms) this.drawPartitions(r);
    for (const f of HQ_MAP.furniture) this.drawFurniture(f);
    for (const r of HQ_MAP.rooms) this.drawRoomLabel(r);
    this.setupCamera();
    this.ready = true;
    if (this.pending) this.sync(this.pending.world, this.pending.sel, this.pending.now);
  }

  // ---------- décor ----------
  private drawSky(): void {
    const clouds: [number, number, number][] = [
      [0.08, 0.12, 1],
      [0.7, 0.08, 1.4],
      [0.45, 0.2, 0.8],
      [0.88, 0.3, 1],
    ];
    for (const [fx, fy, s] of clouds) {
      this.add
        .image(fx * 1600, fy * 600, 'cloud')
        .setScrollFactor(0.15)
        .setScale(s)
        .setAlpha(0.85)
        .setDepth(-100);
    }
  }

  private roomFloorColor(room: Room | null, t: Tile): number {
    if (!room) return (t.x + t.y) % 2 === 0 ? 0xf1e7d6 : 0xe9dcc6;
    const base = hex(room.color);
    const light = Phaser.Display.Color.IntegerToColor(base).lighten(
      room.kind === 'entry' ? 6 : 18,
    ).color;
    return (t.x + t.y) % 2 === 0 ? light : darken(light, 0.95);
  }

  private drawFloor(): void {
    const g = this.add.graphics().setDepth(-10);
    // Épaisseur de la dalle flottante (bords avant).
    const thick = 26;
    const frontL = [this.P(0, ROWS), this.P(COLS, ROWS)];
    const frontR = [this.P(COLS, 0), this.P(COLS, ROWS)];
    g.fillStyle(0x8a6a52, 1);
    g.fillPoints(
      [
        frontL[0]!,
        frontL[1]!,
        new Phaser.Math.Vector2(frontL[1]!.x, frontL[1]!.y + thick),
        new Phaser.Math.Vector2(frontL[0]!.x, frontL[0]!.y + thick),
      ],
      true,
    );
    g.fillStyle(0x73563f, 1);
    g.fillPoints(
      [
        frontR[0]!,
        frontR[1]!,
        new Phaser.Math.Vector2(frontR[1]!.x, frontR[1]!.y + thick),
        new Phaser.Math.Vector2(frontR[0]!.x, frontR[0]!.y + thick),
      ],
      true,
    );
    g.fillStyle(0x7cc46b, 1);
    g.fillPoints(
      [
        frontL[0]!,
        frontL[1]!,
        new Phaser.Math.Vector2(frontL[1]!.x, frontL[1]!.y + 6),
        new Phaser.Math.Vector2(frontL[0]!.x, frontL[0]!.y + 6),
      ],
      true,
    );
    g.fillStyle(0x68ad59, 1);
    g.fillPoints(
      [
        frontR[0]!,
        frontR[1]!,
        new Phaser.Math.Vector2(frontR[1]!.x, frontR[1]!.y + 6),
        new Phaser.Math.Vector2(frontR[0]!.x, frontR[0]!.y + 6),
      ],
      true,
    );

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = { x, y };
        const room = HQ_MAP.roomAt(t);
        g.fillStyle(this.roomFloorColor(room, t), 1);
        g.fillPoints(
          [this.P(x, y), this.P(x + 1, y), this.P(x + 1, y + 1), this.P(x, y + 1)],
          true,
        );
      }
    }
    // Liseré d'allée
    g.lineStyle(1, 0xffffff, 0.18);
    for (let y = 0; y <= ROWS; y++)
      g.lineBetween(this.P(0, y).x, this.P(0, y).y, this.P(COLS, y).x, this.P(COLS, y).y);
    for (let x = 0; x <= COLS; x++)
      g.lineBetween(this.P(x, 0).x, this.P(x, 0).y, this.P(x, ROWS).x, this.P(x, ROWS).y);
  }

  private drawBuildingWalls(): void {
    const g = this.add.graphics().setDepth(-5);
    const a = this.P(0, 0);
    const b = this.P(COLS, 0);
    const c = this.P(0, ROWS);
    const up = (v: Phaser.Math.Vector2, h: number): Phaser.Math.Vector2 =>
      new Phaser.Math.Vector2(v.x, v.y - h);
    // Mur droit (le long de gy=0) et mur gauche (le long de gx=0)
    g.fillStyle(0xf3ead9, 1);
    g.fillPoints([up(a, WALL_H), up(b, WALL_H), b, a], true);
    g.fillStyle(0xe4d8c3, 1);
    g.fillPoints([up(a, WALL_H), up(c, WALL_H), c, a], true);
    // Plinthes et chaperons
    g.fillStyle(0xcdbca0, 1);
    g.fillPoints([up(a, 8), up(b, 8), b, a], true);
    g.fillPoints([up(a, 8), up(c, 8), c, a], true);
    g.fillStyle(0xb9a68a, 1);
    g.fillPoints([up(a, WALL_H + 6), up(b, WALL_H + 6), up(b, WALL_H), up(a, WALL_H)], true);
    g.fillPoints([up(a, WALL_H + 6), up(c, WALL_H + 6), up(c, WALL_H), up(a, WALL_H)], true);
    // Fenêtres
    const window = (p0: Phaser.Math.Vector2, p1: Phaser.Math.Vector2): void => {
      g.fillStyle(0x8fb7d9, 1);
      g.fillPoints([up(p0, 92), up(p1, 92), up(p1, 34), up(p0, 34)], true);
      g.fillStyle(0xcfe6f7, 1);
      g.fillPoints([up(p0, 88), up(p1, 88), up(p1, 64), up(p0, 64)], true);
      g.lineStyle(3, 0xffffff, 1);
      g.strokePoints([up(p0, 92), up(p1, 92), up(p1, 34), up(p0, 34)], true);
      const m0 = new Phaser.Math.Vector2((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      g.lineBetween(m0.x, m0.y - 92, m0.x, m0.y - 34);
    };
    for (let x = 2; x < COLS - 2; x += 5) window(this.P(x, 0), this.P(x + 3, 0));
    for (let y = 12; y < ROWS - 2; y += 5) window(this.P(0, y), this.P(0, y + 3));
    g.lineStyle(2, 0xa38f72, 1);
    g.lineBetween(a.x, a.y, a.x, a.y - WALL_H);
    // Enseigne peinte sur le mur gauche
    const s = this.P(0, 9.5);
    this.add
      .text(s.x, s.y - 66, 'QUARTIER GÉNÉRAL', {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#7c60c9',
      })
      .setOrigin(0.5)
      .setRotation(Math.atan2(-TH / 2, TW / 2))
      .setResolution(2)
      .setDepth(-4);
  }

  /** Boîte isométrique : empreinte (x,y,w,d) en tuiles, hauteur h en px. */
  private box(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    d: number,
    h: number,
    top: number,
    left: number,
    right: number,
  ): void {
    const lift = (v: Phaser.Math.Vector2): Phaser.Math.Vector2 =>
      new Phaser.Math.Vector2(v.x, v.y - h);
    const p00 = this.P(x, y);
    const p10 = this.P(x + w, y);
    const p11 = this.P(x + w, y + d);
    const p01 = this.P(x, y + d);
    g.fillStyle(left, 1);
    g.fillPoints([p01, p11, lift(p11), lift(p01)], true);
    g.fillStyle(right, 1);
    g.fillPoints([p10, p11, lift(p11), lift(p10)], true);
    g.fillStyle(top, 1);
    g.fillPoints([lift(p00), lift(p10), lift(p11), lift(p01)], true);
  }

  private drawPartitions(room: Room): void {
    if (!room.walls) return;
    const base = hex(room.color);
    const { x0, y0, x1, y1 } = room.rect;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (HQ_MAP.tileKind({ x, y }) !== 'wall') continue;
        const g = this.add.graphics().setDepth(x + y + 1);
        this.box(
          g,
          x + 0.1,
          y + 0.1,
          0.8,
          0.8,
          PARTITION_H,
          darken(base, 0.82),
          darken(base, 0.62),
          darken(base, 0.7),
        );
        g.fillStyle(0x2c2640, 0.35);
        const t = this.P(x + 0.5, y + 0.5);
        g.fillRect(t.x - 1, t.y - PARTITION_H - 2, 2, 2);
      }
    }
  }

  private drawFurniture(f: Furniture): void {
    const g = this.add.graphics().setDepth(f.x + f.y + 0.9);
    const { x, y } = f;
    switch (f.kind) {
      case 'desk': {
        this.box(g, x + 0.08, y + 0.2, 0.84, 0.6, 18, 0xfafaf7, 0xc9c6bd, 0xdedbd2);
        const c = this.center(f);
        const frame = this.add
          .rectangle(c.x, c.y - 34, 26, 18, 0x2b2f3a)
          .setDepth(f.x + f.y + 0.95);
        const screen = this.add
          .rectangle(c.x, c.y - 34, 22, 13, 0x4b5263)
          .setDepth(f.x + f.y + 0.96);
        void frame;
        const seatKey = `${x},${y + 1}`;
        this.monitors.set(seatKey, screen);
        break;
      }
      case 'meeting_table':
        this.box(g, x, y, 1, 1, 14, 0xa77b52, 0x7d5a3a, 0x8f6845);
        break;
      case 'counter':
        this.box(g, x + 0.05, y + 0.1, 0.9, 0.8, 22, 0xd9c3a0, 0x9c7f58, 0xb69670);
        if (x % 2 === 0)
          this.box(g, x + 0.3, y + 0.3, 0.35, 0.35, 38, 0x4d5562, 0x2f343d, 0x3c424d);
        break;
      case 'cafe_table':
        this.box(g, x + 0.2, y + 0.2, 0.6, 0.6, 14, 0xf5efe6, 0xc3b8a7, 0xd8cdbc);
        break;
      case 'sofa':
        this.box(g, x, y + 0.1, 1, 0.8, 12, 0x63b7ae, 0x3f877f, 0x4f9d94);
        this.box(g, x, y + 0.75, 1, 0.2, 22, 0x6fc4bb, 0x3f877f, 0x4f9d94);
        break;
      case 'whiteboard':
        this.box(g, x + 0.1, y + 0.4, 0.8, 0.12, 40, 0xffffff, 0xe6e6ea, 0xf3f3f6);
        g.fillStyle(0x7c60c9, 1);
        g.fillRect(this.center(f).x - 10, this.center(f).y - 30, 14, 2);
        g.fillStyle(0xea966c, 1);
        g.fillRect(this.center(f).x - 6, this.center(f).y - 24, 12, 2);
        break;
      case 'server':
        this.box(g, x + 0.2, y + 0.2, 0.6, 0.6, 44, 0x3b4252, 0x262b36, 0x2f3542);
        g.fillStyle(0x4ade80, 1);
        for (let i = 0; i < 4; i++)
          g.fillRect(this.center(f).x + 4, this.center(f).y - 38 + i * 8, 3, 2);
        break;
      case 'reception':
        this.box(g, x, y, 2, 0.8, 22, 0xe7c16a, 0xb08a3c, 0xc79d4a);
        break;
      case 'plant': {
        this.box(g, x + 0.3, y + 0.3, 0.4, 0.4, 12, 0xc77d4e, 0x9b5b34, 0xb06a40);
        const c = this.center(f);
        for (const [dx, dy, r, col] of [
          [0, -26, 11, 0x4f9e4a],
          [-7, -20, 8, 0x5fb55a],
          [7, -19, 8, 0x3f8a3d],
          [0, -34, 7, 0x6cc466],
        ] as const) {
          g.fillStyle(col, 1);
          g.fillCircle(c.x + dx, c.y + dy, r);
        }
        break;
      }
    }
  }

  private drawRoomLabel(room: Room): void {
    const p = this.P((room.rect.x0 + room.rect.x1 + 1) / 2, room.rect.y0);
    const color = hex(room.color);
    const text = this.add
      .text(p.x, p.y - 34, room.label, {
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#222035',
        padding: { left: 30, right: 14, top: 7, bottom: 7 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5001);
    const bg = this.add.graphics().setDepth(5000);
    this.labels.set(room.id, { text, bg, color });
    this.paintLabel(room.id);
    if (room.kind === 'department') {
      text.setInteractive({ useHandCursor: true });
      text.on('pointerup', () => {
        if (this.dragMoved < 6) this.cb.onSelect({ kind: 'department', id: room.id });
      });
    }
  }

  private paintLabel(roomId: string): void {
    const l = this.labels.get(roomId);
    if (!l) return;
    const b = l.text.getBounds();
    l.bg.clear();
    l.bg.fillStyle(0x000000, 0.12);
    l.bg.fillRoundedRect(b.x + 2, b.y + 4, b.width, b.height, 14);
    l.bg.fillStyle(0xfffdf8, 0.97);
    l.bg.fillRoundedRect(b.x, b.y, b.width, b.height, 14);
    l.bg.lineStyle(3, l.color, 1);
    l.bg.strokeRoundedRect(b.x, b.y, b.width, b.height, 14);
    l.bg.fillStyle(l.color, 1);
    l.bg.fillRoundedRect(b.x + 9, b.y + b.height / 2 - 7, 14, 14, 4);
  }

  // ---------- caméra ----------
  private mapBounds(): Phaser.Geom.Rectangle {
    const left = this.P(0, ROWS).x - 40;
    const right = this.P(COLS, 0).x + 40;
    const top = this.P(0, 0).y - WALL_H - 50;
    const bottom = this.P(COLS, ROWS).y + 50;
    return new Phaser.Geom.Rectangle(left, top, right - left, bottom - top);
  }

  home(): void {
    const cam = this.cameras.main;
    const b = this.mapBounds();
    const zoom = Math.min(cam.width / b.width, cam.height / b.height);
    cam.setZoom(Phaser.Math.Clamp(zoom, 0.3, 2));
    cam.centerOn(b.centerX, b.centerY);
  }

  zoomBy(f: number): void {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 0.3, 2.2));
  }

  focusAgent(id: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    const cam = this.cameras.main;
    cam.pan(a.container.x, a.container.y - 30, this.reducedMotion ? 0 : 350, 'Sine.easeInOut');
    if (cam.zoom < 0.8) cam.zoomTo(0.9, this.reducedMotion ? 0 : 350);
  }

  private setupCamera(): void {
    this.home();
    this.scale.on('resize', () => this.home());
    this.input.on('pointerdown', () => {
      this.dragging = true;
      this.dragMoved = 0;
    });
    this.input.on(
      'pointerup',
      (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        this.dragging = false;
        if (over.length === 0 && this.dragMoved < 6) this.cb.onSelect(null);
      },
    );
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      const cam = this.cameras.main;
      const dx = p.x - p.prevPosition.x;
      const dy = p.y - p.prevPosition.y;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.3, 2.2));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
    this.input.mouse?.disableContextMenu();
    this.game.canvas.addEventListener('dblclick', () => this.home());
  }

  // ---------- avatars ----------
  sync(world: WorldSnapshot, sel: Selection | null, now: number): void {
    if (!this.ready) {
      this.pending = { world, sel, now };
      return;
    }
    this.selection = sel;
    const animateSpawn = !this.firstSync;
    this.firstSync = false;
    const activeInv = new Map<string, InvocationView>();
    for (const i of world.invocations) {
      if (i.status === 'running' || i.status === 'requested' || i.status === 'authorized')
        activeInv.set(i.agentId, i);
    }
    const toolColor = new Map(world.tools.map((t) => [t.id, t]));

    const seats = meetingSeats(world.meetings);
    this.updateMeetingBubble(world);
    world.agents.forEach((agent, index) => {
      const intent = visualIntent(agent, index, now, HQ_MAP, seats.get(agent.id) ?? null);
      let av = this.avatars.get(agent.id);
      if (!av) av = this.spawn(agent, intent, animateSpawn);
      av.agent = agent;
      if (intent && (!av.target || av.target.id !== intent.anchor.id))
        this.moveTo(av, intent.anchor);
      av.intent = intent;
      av.container.setVisible(intent !== null);
      this.updateChip(av, activeInv.get(agent.id), toolColor);
      if (!av.walking) this.applyPose(av);
      const selected = sel?.kind === 'agent' && sel.id === agent.id;
      av.ring.setVisible(selected);
      av.name.setVisible(selected || av.hovered);
    });
    for (const [id, av] of this.avatars) {
      if (!world.agents.some((a) => a.id === id)) {
        av.container.destroy();
        av.hit.destroy();
        this.avatars.delete(id);
      }
    }
    // Écrans des postes : reflètent l'état réel de l'agent présent à son bureau.
    for (const [seat, screen] of this.monitors) {
      const av = [...this.avatars.values()].find(
        (a) =>
          a.intent?.mode === 'desk' &&
          !a.walking &&
          `${a.intent.anchor.x},${a.intent.anchor.y}` === seat,
      );
      const act = av?.agent.activity;
      const inv = av ? activeInv.get(av.agent.id) : undefined;
      const tool = inv ? toolColor.get(inv.toolId) : undefined;
      screen.setFillStyle(
        act === 'using_tool' && tool
          ? hex(tool.color)
          : act === 'working'
            ? 0x6ee7a8
            : act === 'blocked'
              ? 0xef5a6f
              : av
                ? 0x9db4d8
                : 0x4b5263,
      );
    }
    // Badges de département « X/Y au poste »
    for (const room of HQ_MAP.rooms) {
      if (room.kind !== 'department') continue;
      const { atDesk, total } = departmentPresence(world.agents, room.id, now, seats);
      const l = this.labels.get(room.id);
      const txt = `${room.label}  ·  ${atDesk}/${total} au poste`;
      if (l && l.text.text !== txt) {
        l.text.setText(txt);
        this.paintLabel(room.id);
      }
    }
  }

  private spawn(agent: AgentView, intent: VisualIntent | null, animate: boolean): AvatarObj {
    const start = animate
      ? (HQ_MAP.anchors['entry-spawn'] as Anchor)
      : (intent?.anchor ?? (HQ_MAP.anchors['entry-spawn'] as Anchor));
    const c = this.center(start);
    const container = this.add.container(c.x, c.y);
    const ring = this.add
      .ellipse(0, 0, 54, 24)
      .setStrokeStyle(4, 0x7c60c9)
      .setFillStyle(0x7c60c9, 0.18)
      .setVisible(false);
    const shadow = this.add.ellipse(0, 0, 36, 14, 0x2a2140, 0.25);
    const body = this.add.image(0, 4, avatarKey(agent.avatarId, 'front', 'idle')).setOrigin(0.5, 1);
    const nameText = this.add
      .text(0, 0, `${agent.name} · ${agent.title}`, {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '17px',
        color: '#ffffff',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    const nb = nameText.getBounds();
    const nameBg = this.add.graphics();
    nameBg.fillStyle(0x222035, 0.92);
    nameBg.fillRoundedRect(-nb.width / 2, -nb.height, nb.width, nb.height, 8);
    const name = this.add.container(0, -AVATAR_H * PX - 10, [nameBg, nameText]).setVisible(false);
    const chipBg = this.add.graphics();
    const chipText = this.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    const chip = this.add.container(22, -AVATAR_H * PX + 6, [chipBg, chipText]).setVisible(false);
    container.add([ring, shadow, body, chip, name]);
    container.setDepth(start.x + start.y + 1.5);

    // Zone cliquable découplée du rendu (docs/06 §3).
    const hit = this.add
      .zone(c.x, c.y - 36, 46, 84)
      .setInteractive({ useHandCursor: true })
      .setDepth(9000);
    const av: AvatarObj = {
      agent,
      container,
      body,
      ring,
      name,
      chip,
      chipText,
      chipBg,
      hit,
      tile: { x: start.x, y: start.y },
      target: animate ? null : (intent?.anchor ?? null),
      intent,
      view: 'front',
      flip: false,
      walking: false,
      hovered: false,
      frameTimer: null,
    };
    hit.on('pointerup', () => {
      if (this.dragMoved < 6) this.cb.onSelect({ kind: 'agent', id: av.agent.id });
    });
    hit.on('pointerover', () => {
      av.hovered = true;
      av.name.setVisible(true);
    });
    hit.on('pointerout', () => {
      av.hovered = false;
      av.name.setVisible(this.selection?.kind === 'agent' && this.selection.id === av.agent.id);
    });
    this.avatars.set(agent.id, av);

    if (animate && !this.reducedMotion) {
      // Arrivée d'un nouvel agent (agent.created inédit) : faisceau à l'accueil.
      container.setScale(0.2).setAlpha(0);
      this.tweens.add({ targets: container, scale: 1, alpha: 1, duration: 600, ease: 'Back.Out' });
      const beam = this.add.rectangle(c.x, c.y - 60, 46, 150, 0xc4b5fd, 0.55).setDepth(8000);
      this.tweens.add({
        targets: beam,
        alpha: 0,
        scaleX: 0.1,
        duration: 1100,
        onComplete: () => beam.destroy(),
      });
    }
    if (!animate && intent) this.faceAnchor(av, intent.anchor);
    return av;
  }

  private faceAnchor(av: AvatarObj, a: Anchor): void {
    if (!a.facing) {
      av.view = 'front';
      av.flip = false;
      return;
    }
    this.faceDir(av, a.facing.x - a.x, a.facing.y - a.y);
  }
  private faceDir(av: AvatarObj, dx: number, dy: number): void {
    if (dx > 0) [av.view, av.flip] = ['front', false];
    else if (dy > 0) [av.view, av.flip] = ['front', true];
    else if (dx < 0) [av.view, av.flip] = ['back', false];
    else if (dy < 0) [av.view, av.flip] = ['back', true];
  }

  private setFrame(av: AvatarObj, frame: AvatarFrame): void {
    av.body.setTexture(avatarKey(av.agent.avatarId, av.view, frame)).setFlipX(av.flip);
  }

  private applyPose(av: AvatarObj): void {
    av.frameTimer?.remove();
    av.frameTimer = null;
    const pose = av.intent?.pose ?? 'idle';
    if (av.intent) this.faceAnchor(av, av.intent.anchor);
    if ((pose === 'work' || pose === 'tool') && av.intent?.mode === 'desk') {
      let f = false;
      this.setFrame(av, 'work1');
      if (!this.reducedMotion) {
        av.frameTimer = this.time.addEvent({
          delay: pose === 'tool' ? 260 : 480,
          loop: true,
          callback: () => {
            f = !f;
            this.setFrame(av, f ? 'work2' : 'work1');
          },
        });
      }
    } else {
      this.setFrame(av, 'idle');
    }
  }

  private updateChip(
    av: AvatarObj,
    inv: InvocationView | undefined,
    tools: Map<string, { code: string; color: string }>,
  ): void {
    let label = '';
    let color = 0x222035;
    if (av.agent.activity === 'using_tool' && inv) {
      const t = tools.get(inv.toolId);
      label = t?.code ?? inv.toolId;
      color = t ? hex(t.color) : color;
    } else if (av.agent.activity === 'waiting_approval') {
      label = 'VALIDATION';
      color = 0xd49c30;
    } else if (av.agent.activity === 'in_meeting') {
      label = 'RÉUNION';
      color = 0x7c60c9;
    } else if (av.agent.activity === 'blocked') {
      label = '! BLOQUÉ';
      color = 0xce4b61;
    } else if (av.intent?.mode === 'break') {
      label = 'PAUSE';
      color = 0x83c6c1;
    }
    av.chip.setVisible(label !== '');
    if (!label || av.chipText.text === label) return;
    av.chipText.setText(label);
    const b = av.chipText.getBounds();
    av.chipBg.clear();
    av.chipBg.fillStyle(color, 1);
    av.chipBg.fillRoundedRect(-b.width / 2, -b.height, b.width, b.height, 7);
    av.chipBg.lineStyle(2, 0xffffff, 0.9);
    av.chipBg.strokeRoundedRect(-b.width / 2, -b.height, b.width, b.height, 7);
  }

  private moveTo(av: AvatarObj, target: Anchor): void {
    av.target = target;
    this.tweens.killTweensOf(av.container);
    av.frameTimer?.remove();
    const place = (t: Tile): void => {
      const c = this.center(t);
      av.container.setPosition(c.x, c.y).setDepth(t.x + t.y + 1.5);
      av.hit.setPosition(c.x, c.y - 36);
      av.tile = { x: t.x, y: t.y };
    };
    const path = findPath(av.tile, target, HQ_MAP.isWalkable);
    if (this.reducedMotion || !path || path.length === 0) {
      place(target);
      av.walking = false;
      this.applyPose(av);
      return;
    }
    av.walking = true;
    let frame = false;
    av.frameTimer = this.time.addEvent({
      delay: 150,
      loop: true,
      callback: () => {
        frame = !frame;
        this.setFrame(av, frame ? 'walk1' : 'walk2');
      },
    });
    const steps = path.map((t) => {
      const c = this.center(t);
      return {
        x: c.x,
        y: c.y,
        duration: STEP_MS,
        onStart: () => {
          this.faceDir(av, t.x - av.tile.x, t.y - av.tile.y);
          av.container.setDepth(Math.max(t.x + t.y, av.tile.x + av.tile.y) + 1.5);
        },
        onUpdate: () => av.hit.setPosition(av.container.x, av.container.y - 36),
        onComplete: () => {
          av.tile = { x: t.x, y: t.y };
          av.container.setDepth(t.x + t.y + 1.5);
        },
      };
    });
    this.tweens.chain({
      targets: av.container,
      tweens: steps,
      onComplete: () => {
        av.walking = false;
        av.frameTimer?.remove();
        av.frameTimer = null;
        this.applyPose(av);
      },
    });
  }

  private meetingBubble: Phaser.GameObjects.Container | null = null;

  /** Bulle de sujet au-dessus de la table pendant une réunion réelle (cliquable). */
  private updateMeetingBubble(world: WorldSnapshot): void {
    const m = world.meetings.find((x) => x.status === 'in_progress');
    if (!m) {
      this.meetingBubble?.destroy();
      this.meetingBubble = null;
      return;
    }
    if (this.meetingBubble?.getData('id') === m.id) return;
    this.meetingBubble?.destroy();
    const c = this.P(HQ_MAP.anchors['meeting-seat-01']!.x + 2, 12.5);
    const text = this.add
      .text(0, 0, `◎ ${m.topic}`, {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffffff',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    const b = text.getBounds();
    const bg = this.add.graphics();
    bg.fillStyle(0x7c60c9, 0.95);
    bg.fillRoundedRect(-b.width / 2, -b.height, b.width, b.height, 10);
    this.meetingBubble = this.add
      .container(c.x, c.y - 120, [bg, text])
      .setDepth(7000)
      .setData('id', m.id);
    text.setInteractive({ useHandCursor: true });
    text.on('pointerup', () => this.cb.onSelect({ kind: 'meeting', id: m.id }));
  }

  /** Hook e2e (hors production) : position écran (canvas) d'un avatar. */
  agentScreenPosition(id: string): { x: number; y: number } | null {
    const av = this.avatars.get(id);
    if (!av) return null;
    const cam = this.cameras.main;
    return {
      x: (av.hit.x - cam.worldView.x) * cam.zoom,
      y: (av.hit.y - cam.worldView.y) * cam.zoom,
    };
  }
  isWalking(id: string): boolean {
    return this.avatars.get(id)?.walking ?? false;
  }
}
