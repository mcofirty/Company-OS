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
  AVATAR_TEX,
  generateTextures,
  hex,
  PX,
  type AvatarFrame,
  type AvatarView,
} from './textures';
import {
  bakeStatic,
  chairBackSprite,
  commitDecor,
  DECOR_TEX,
  furnitureSprite,
  glowSprite,
  meetingChairSprite,
  partitionSprite,
  screenSprite,
  type DecorSprite,
} from './decor';
import type { HqWorldView, Selection, WorldCallbacks } from './types';

/**
 * Projection visuelle du QG. Ne détient aucun état métier : elle reçoit le snapshot
 * (issu des événements backend) et anime les transitions. Les déplacements sont locaux
 * et ne modifient jamais le statut métier.
 */

export type { Selection } from './types';
export type HqSceneCallbacks = WorldCallbacks;

const TW = HQ_MAP.tileWidth;
const TH = HQ_MAP.tileHeight;
const COLS = HQ_MAP.cols;
const ROWS = HQ_MAP.rows;
const WALL_H = 120;
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
  /** Halo rouge pulsé : agent bloqué (visible de loin). */
  halo: Phaser.GameObjects.Ellipse;
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

/** 2-3 premiers mots d'un titre, pour une bulle courte. */
function shortWords(s: string, n: number): string {
  const words = s
    .replace(/[«»"—–-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .join(' ');
  return words.length > 24 ? `${words.slice(0, 23)}…` : words;
}
/** Pictogramme selon la nature de la mission. */
function pictogram(title: string): string {
  const t = title.toLowerCase();
  if (/rapport|synth|bilan|point/.test(t)) return '📊';
  if (/veille|recherche|analyse|étude/.test(t)) return '🔎';
  if (/email|mail|relance|répon/.test(t)) return '✉';
  if (/factur|budget|compta|paie/.test(t)) return '€';
  if (/recrut|candidat/.test(t)) return '👤';
  return '✍';
}

export class HqScene extends Phaser.Scene implements HqWorldView {
  private origin = { x: 0, y: 0 };
  private avatars = new Map<string, AvatarObj>();
  private monitors = new Map<
    string,
    { screen: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }
  >();
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
  /** Échelle inverse du zoom appliquée aux textes (lisibles quel que soit le zoom). */
  private textScale = 1;
  private lastZoom = 0;
  private dockKey = '';
  private dockObjs: Phaser.GameObjects.GameObject[] = [];

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
    this.drawStatic();
    for (const r of HQ_MAP.rooms) this.drawPartitions(r);
    for (const f of HQ_MAP.furniture) this.drawFurniture(f);
    this.drawSeats();
    commitDecor(this);
    for (const { img, d } of this.decorPending)
      img.setTexture(DECOR_TEX, d.key).setOrigin(d.originX, d.originY);
    this.decorPending = [];
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

  /** Sol, tapis, lumière et murs du bâtiment : une seule image cuite au démarrage. */
  private drawStatic(): void {
    const bake = bakeStatic(this, this.origin);
    for (const ch of bake.chunks)
      this.add
        .image(ch.x, ch.y, bake.key, ch.frame)
        .setOrigin(0, 0)
        .setScale(bake.scale)
        .setDepth(-10);
    // Enseigne peinte sur le mur gauche
    const s = this.P(0, 9.5);
    this.add
      .text(s.x, s.y - 70, 'QUARTIER GÉNÉRAL', {
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

  private decorPending: { img: Phaser.GameObjects.Image; d: DecorSprite }[] = [];
  /** Image de décor ; sa frame d'atlas est attribuée après empaquetage (commitDecor). */
  private placeDecor(
    t: { x: number; y: number },
    d: DecorSprite,
    depth: number,
  ): Phaser.GameObjects.Image {
    const c = this.center(t);
    const img = this.add.image(c.x, c.y, '__DEFAULT').setScale(d.scale).setDepth(depth);
    this.decorPending.push({ img, d });
    return img;
  }

  private drawPartitions(room: Room): void {
    if (!room.walls) return;
    const { x0, y0, x1, y1 } = room.rect;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (HQ_MAP.tileKind({ x, y }) !== 'wall') continue;
        this.placeDecor({ x, y }, partitionSprite(this, room, { x, y }), x + y + 1);
      }
    }
  }

  private drawFurniture(f: Furniture): void {
    const room = f.roomId ? (HQ_MAP.rooms.find((r) => r.id === f.roomId) ?? null) : null;
    const depth = f.x + f.y + 0.9;
    this.placeDecor(f, furnitureSprite(this, f, room), depth);
    if (f.kind === 'desk') {
      const glow = this.placeDecor(f, glowSprite(this), depth + 0.04).setVisible(false);
      const screen = this.placeDecor(f, screenSprite(this), depth + 0.06).setTint(0x4b5263);
      this.monitors.set(`${f.x},${f.y + 1}`, { screen, glow });
    }
  }

  /** Dossiers des postes (devant l'avatar assis) et sièges de la salle de réunion. */
  private drawSeats(): void {
    for (const a of Object.values(HQ_MAP.anchors)) {
      const d = a.x + a.y;
      if (a.kind === 'desk') this.placeDecor(a, chairBackSprite(this, false), d + 1.6);
      if (a.kind === 'meeting_seat' && a.facing) {
        if (a.facing.y > a.y) this.placeDecor(a, meetingChairSprite(this, true), d + 0.9);
        else {
          this.placeDecor(a, meetingChairSprite(this, false), d + 0.9);
          this.placeDecor(a, chairBackSprite(this, true), d + 1.6);
        }
      }
    }
  }

  private drawRoomLabel(room: Room): void {
    const p = this.P((room.rect.x0 + room.rect.x1 + 1) / 2, room.rect.y0);
    const color = hex(room.color);
    const text = this.add
      .text(p.x, p.y - 34, room.label, {
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#222035',
        padding: { left: 24, right: 10, top: 5, bottom: 5 },
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
        if (this.dragMoved < 6) {
          // Département qui occupe cette pièce dans l'organisation affichée (démo ou live).
          const dept = this.lastWorld?.departments.find((d) => d.roomId === room.id);
          if (dept) this.cb.onSelect({ kind: 'department', id: dept.id });
          else this.cb.onEmptyRoom?.(room.id);
        }
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
    const sq = 10 * this.textScale;
    l.bg.fillRoundedRect(b.x + 8 * this.textScale, b.y + b.height / 2 - sq / 2, sq, sq, 3);
  }

  // ---------- caméra ----------
  private mapBounds(): Phaser.Geom.Rectangle {
    const left = this.P(0, ROWS).x - 40;
    const right = this.P(COLS + 3, 0).x + 40; // inclut le dock d'outils
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
    this.lastWorld = world;
    this.ensureDock(world);
    const animateSpawn = !this.firstSync;
    this.firstSync = false;
    const activeInv = new Map<string, InvocationView>();
    for (const i of world.invocations) {
      if (i.status === 'running' || i.status === 'requested' || i.status === 'authorized')
        activeInv.set(i.agentId, i);
    }
    const toolColor = new Map(world.tools.map((t) => [t.id, t]));
    const taskTitle = new Map(world.tasks.map((t) => [t.id, t.title]));

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
      this.updateChip(av, activeInv.get(agent.id), toolColor, taskTitle);
      if (!av.walking) this.applyPose(av);
      const selected = sel?.kind === 'agent' && sel.id === agent.id;
      av.ring.setVisible(selected);
      // Filtre de département : les autres restent visibles mais atténués (docs/12 scénario E).
      av.container.setAlpha(
        this.highlightDept && agent.departmentId !== this.highlightDept ? 0.3 : 1,
      );
      av.name.setVisible(selected || av.hovered);
    });
    for (const [id, av] of this.avatars) {
      if (!world.agents.some((a) => a.id === id)) {
        // Replay arrière : l'agent n'existe pas encore -> stopper ses animations avant destruction.
        this.tweens.killTweensOf(av.container);
        av.frameTimer?.remove();
        av.frameTimer = null;
        av.container.destroy();
        av.hit.destroy();
        this.avatars.delete(id);
      }
    }
    // Écrans des postes : reflètent l'état réel de l'agent présent à son bureau.
    for (const [seat, { screen, glow }] of this.monitors) {
      const av = [...this.avatars.values()].find(
        (a) =>
          a.intent?.mode === 'desk' &&
          !a.walking &&
          `${a.intent.anchor.x},${a.intent.anchor.y}` === seat,
      );
      const act = av?.agent.activity;
      const inv = av ? activeInv.get(av.agent.id) : undefined;
      const tool = inv ? toolColor.get(inv.toolId) : undefined;
      const color =
        act === 'using_tool' && tool
          ? hex(tool.color)
          : act === 'working'
            ? 0x6ee7a8
            : act === 'blocked'
              ? 0xef5a6f
              : av
                ? 0x9db4d8
                : 0x4b5263;
      screen.setTint(color);
      glow
        .setTint(color)
        .setAlpha(0.35)
        .setVisible(av !== undefined);
    }
    // Badges de département « X/Y au poste »
    for (const room of HQ_MAP.rooms) {
      if (room.kind !== 'department') continue;
      const dept = world.departments.find((d) => d.roomId === room.id);
      const l = this.labels.get(room.id);
      let txt = 'Espace libre — extension possible';
      if (dept) {
        const { atDesk, total } = departmentPresence(world.agents, dept.id, now, seats);
        txt = `${dept.name}  ·  ${atDesk}/${total} au poste`;
      }
      const col = dept ? hex(dept.color) : (l?.color ?? 0);
      if (l && (l.text.text !== txt || l.color !== col)) {
        l.color = col;
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
    const shadow = this.add.ellipse(0, 1, 32, 12, 0x2a2140, 0.22);
    const halo = this.add
      .ellipse(0, 0, 70, 30, 0xce4b61, 0.28)
      .setStrokeStyle(4, 0xce4b61, 0.9)
      .setVisible(false);
    if (!this.reducedMotion) {
      this.tweens.add({
        targets: halo,
        scaleX: 1.25,
        scaleY: 1.25,
        alpha: 0.35,
        duration: 700,
        yoyo: true,
        repeat: -1,
      });
    }
    const body = this.add
      .image(0, 4, AVATAR_TEX, avatarKey(agent.avatarId, 'front', 'idle'))
      .setOrigin(0.5, 1);
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
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
        padding: { x: 7, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    const chip = this.add.container(0, -AVATAR_H * PX - 6, [chipBg, chipText]).setVisible(false);
    container.add([halo, ring, shadow, body, chip, name]);
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
      halo,
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
    av.body.setFrame(avatarKey(av.agent.avatarId, av.view, frame)).setFlipX(av.flip);
  }

  private applyPose(av: AvatarObj): void {
    av.frameTimer?.remove();
    av.frameTimer = null;
    const pose = av.intent?.pose ?? 'idle';
    if (av.intent) this.faceAnchor(av, av.intent.anchor);
    const mode = av.intent?.mode;
    if ((pose === 'work' || pose === 'tool') && mode === 'desk') {
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
      // Au poste sans tâche ou en réunion : assis ; ailleurs : debout.
      this.setFrame(av, mode === 'desk' || mode === 'meeting' ? 'sit' : 'idle');
    }
  }

  /** Bulle d'activité au-dessus de l'avatar : ce qu'il fait, en 2-3 mots. */
  private updateChip(
    av: AvatarObj,
    inv: InvocationView | undefined,
    tools: Map<string, { code: string; color: string; name: string }>,
    taskTitles: Map<string, string>,
  ): void {
    let label = '';
    let color = 0x222035;
    const a = av.agent;
    const title = a.currentTaskId ? taskTitles.get(a.currentTaskId) : undefined;
    if (a.activity === 'using_tool' && inv) {
      const t = tools.get(inv.toolId);
      label = `🛠 ${shortWords(t?.name ?? inv.toolId, 2)}`;
      color = t ? hex(t.color) : color;
    } else if (a.activity === 'waiting_approval') {
      label = '⏳ Attend ta validation';
      color = 0xd49c30;
    } else if (a.activity === 'in_meeting') {
      label = '◎ En réunion';
      color = 0x7c60c9;
    } else if (a.activity === 'blocked') {
      label = '⚠ Bloqué';
      color = 0xce4b61;
    } else if ((a.activity === 'working' || a.currentTaskId) && title) {
      label = `${pictogram(title)} ${shortWords(title, 3)}`;
      color = 0x3b7dd8;
    } else if (av.intent?.life) {
      // Vie de bureau cosmétique (agent sans mission) : couleurs douces, jamais d'alerte.
      const LIFE: Record<string, [string, number]> = {
        coffee: ['☕ Pause café', 0x83c6c1],
        chat: ['💬 Discute', 0x9b8fd6],
        read: ['📖 Lit la veille', 0x8fb7a0],
        stretch: ['🙆 S’étire', 0xb7a38f],
        plants: ['🪴 Arrose les plantes', 0x7fb07f],
      };
      const l = LIFE[av.intent.life];
      if (l) [label, color] = l;
    } else if (av.intent?.mode === 'break') {
      label = '☕ Pause';
      color = 0x83c6c1;
    }
    av.halo.setVisible(a.activity === 'blocked');
    av.chip.setVisible(label !== '');
    av.chip.setScale(this.textScale);
    av.name.setScale(this.textScale);
    if (!label || av.chipText.text === label) return;
    av.chipText.setText(label);
    const b = av.chipText.getBounds();
    const w = b.width / av.chip.scaleX;
    const h = b.height / av.chip.scaleY;
    av.chipBg.clear();
    av.chipBg.fillStyle(0x000000, 0.18);
    av.chipBg.fillRoundedRect(-w / 2 + 1, -h + 3, w, h, 9);
    av.chipBg.fillStyle(color, 1);
    av.chipBg.fillRoundedRect(-w / 2, -h, w, h, 9);
    av.chipBg.lineStyle(2, 0xffffff, 0.95);
    av.chipBg.strokeRoundedRect(-w / 2, -h, w, h, 9);
    // Pointe de bulle vers l'avatar.
    av.chipBg.fillStyle(color, 1);
    av.chipBg.fillTriangle(-5, -1, 5, -1, 0, 6);
  }

  /** Textes lisibles à tout zoom : échelle inverse du zoom, bornée. */
  private applyTextScale(): void {
    const zoom = this.cameras.main.zoom;
    if (Math.abs(zoom - this.lastZoom) < 0.01) return;
    this.lastZoom = zoom;
    this.textScale = Phaser.Math.Clamp(0.7 / zoom, 1, 2.3);
    for (const [id, l] of this.labels) {
      l.text.setScale(this.textScale);
      this.paintLabel(id);
    }
    for (const av of this.avatars.values()) {
      av.chip.setScale(this.textScale);
      av.name.setScale(this.textScale);
    }
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
    // Cycle de marche en 4 temps : pas gauche, passage, pas droit, passage.
    const cycle: AvatarFrame[] = ['walk1', 'walk3', 'walk2', 'walk3'];
    let frame = 0;
    this.setFrame(av, cycle[0]!);
    av.frameTimer = this.time.addEvent({
      delay: 95,
      loop: true,
      callback: () => {
        if (!av.container.scene) return;
        frame = (frame + 1) % cycle.length;
        this.setFrame(av, cycle[frame]!);
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
        if (!av.container.scene) return; // avatar détruit pendant la marche (replay)
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
    const seat = HQ_MAP.anchors['meeting-seat-01']!;
    const c = this.P(seat.x + 2, seat.y + 1.5);
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

  // ---------- filtre et liens agent -> outil (docs/06 §8) ----------
  private highlightDept: string | null = null;
  private linksMode = false;
  private lastWorld: WorldSnapshot | null = null;
  private dock = new Map<string, Phaser.Math.Vector2>();
  private linkGfx: Phaser.GameObjects.Graphics | null = null;
  private overflowText: Phaser.GameObjects.Text | null = null;
  private linkPhase = 0;
  /** Liens actuellement dessinés (hook e2e). */
  drawnLinks: { agentId: string; toolId: string }[] = [];
  hiddenLinks = 0;

  setHighlight(dept: string | null): void {
    this.highlightDept = dept;
    if (this.lastWorld) this.sync(this.lastWorld, this.selection, Date.now());
  }
  setLinksMode(on: boolean): void {
    this.linksMode = on;
  }

  /** Dock d'outils le long du bord avant-droit de la dalle (cliquable). */
  private ensureDock(world: WorldSnapshot): void {
    // Reconstruit le dock quand la liste d'outils change (ex. connecteur ajouté / retiré).
    const key = world.tools.map((t) => `${t.id}:${t.code}:${t.color}`).join('|');
    if (key === this.dockKey) return;
    this.dockKey = key;
    for (const o of this.dockObjs) o.destroy();
    this.dockObjs = [];
    this.dock.clear();
    if (world.tools.length === 0) return;
    const n = world.tools.length;
    world.tools.forEach((tool, i) => {
      const p = this.P(COLS + 1.9, 1.5 + (i * (ROWS - 3)) / Math.max(1, n - 1));
      const text = this.add
        .text(0, 0, tool.code, {
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#ffffff',
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5)
        .setResolution(2);
      const b = text.getBounds();
      const bg = this.add.graphics();
      bg.fillStyle(hex(tool.color), 1);
      bg.fillRoundedRect(-b.width / 2, -b.height / 2, b.width, b.height, 8);
      bg.lineStyle(3, 0xffffff, 0.9);
      bg.strokeRoundedRect(-b.width / 2, -b.height / 2, b.width, b.height, 8);
      const c = this.add.container(p.x, p.y, [bg, text]).setDepth(6000);
      // Nom complet au survol (les codes à 3 lettres ne suffisent pas).
      const tip = this.add
        .text(p.x + b.width / 2 + 8, p.y, tool.name, {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '16px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: '#222035',
          padding: { x: 8, y: 5 },
        })
        .setOrigin(0, 0.5)
        .setResolution(2)
        .setDepth(9500)
        .setVisible(false);
      text.setInteractive({ useHandCursor: true });
      text.on('pointerover', () => tip.setScale(this.textScale).setVisible(true));
      text.on('pointerout', () => tip.setVisible(false));
      text.on('pointerup', () => {
        if (this.dragMoved < 6) this.cb.onSelect({ kind: 'tool', id: tool.id });
      });
      this.dockObjs.push(c, tip);
      this.dock.set(tool.id, p);
    });
    this.linkGfx ??= this.add.graphics().setDepth(5900);
  }

  override update(_time: number, delta: number): void {
    this.applyTextScale();
    if (!this.linkGfx || !this.lastWorld) return;
    this.linkPhase = (this.linkPhase + delta * 0.05) % 20;
    this.drawLinks(this.lastWorld);
  }

  private drawLinks(world: WorldSnapshot): void {
    const g = this.linkGfx!;
    g.clear();
    const active = world.invocations
      .filter((i) => ['requested', 'authorized', 'running', 'waiting_approval'].includes(i.status))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    const sel = this.selection?.kind === 'agent' ? this.selection.id : null;
    const shown = sel ? active.filter((i) => i.agentId === sel) : this.linksMode ? active : [];
    const MAX = 5;
    const drawn = shown.slice(0, MAX);
    this.drawnLinks = drawn.map((i) => ({ agentId: i.agentId, toolId: i.toolId }));
    this.hiddenLinks = Math.max(0, shown.length - MAX);
    for (const inv of drawn) {
      const av = this.avatars.get(inv.agentId);
      const to = this.dock.get(inv.toolId);
      if (!av || !to) continue;
      const tool = world.tools.find((t) => t.id === inv.toolId);
      const from = new Phaser.Math.Vector2(av.container.x, av.container.y - 40);
      const color =
        inv.status === 'waiting_approval' ? 0xd49c30 : tool ? hex(tool.color) : 0x7c60c9;
      this.dashed(g, from, to, color);
    }
    if (this.hiddenLinks > 0) {
      const anchor = this.dock.values().next().value as Phaser.Math.Vector2 | undefined;
      if (anchor && !this.overflowText) {
        this.overflowText = this.add
          .text(anchor.x, anchor.y - 40, '', {
            fontFamily: 'Inter, sans-serif',
            fontSize: '18px',
            fontStyle: 'bold',
            color: '#222035',
            backgroundColor: '#ffffffdd',
            padding: { x: 8, y: 4 },
          })
          .setOrigin(0.5)
          .setResolution(2)
          .setDepth(6001);
      }
      this.overflowText?.setText(`+${this.hiddenLinks} liens regroupés`).setVisible(true);
    } else {
      this.overflowText?.setVisible(false);
    }
  }

  private dashed(
    g: Phaser.GameObjects.Graphics,
    a: Phaser.Math.Vector2,
    b: Phaser.Math.Vector2,
    color: number,
  ): void {
    const len = Phaser.Math.Distance.BetweenPoints(a, b);
    const dir = new Phaser.Math.Vector2(b.x - a.x, b.y - a.y).normalize();
    g.lineStyle(4, color, 0.9);
    for (let d = this.linkPhase - 20; d < len; d += 20) {
      const s = Math.max(0, d);
      const e = Math.min(len, d + 12);
      if (e <= s) continue;
      g.lineBetween(a.x + dir.x * s, a.y + dir.y * s, a.x + dir.x * e, a.y + dir.y * e);
    }
    g.fillStyle(color, 1);
    g.fillCircle(a.x, a.y, 5);
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
  agentAlpha(id: string): number | null {
    return this.avatars.get(id)?.container.alpha ?? null;
  }
  isWalking(id: string): boolean {
    return this.avatars.get(id)?.walking ?? false;
  }
}
