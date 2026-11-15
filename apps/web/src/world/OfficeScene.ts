import * as Phaser from 'phaser';
import {
  OFFICE_LAYOUT,
  WORLD_SIZE,
  type AgentRole,
  type AgentStatus,
  type AgentView,
  type TilePosition,
  type WorldSnapshot,
} from '@company-os/contracts';

/**
 * Projection visuelle du monde. Ne détient AUCUN état métier : elle reçoit des snapshots
 * (dérivés des événements backend) et anime la transition entre deux états.
 * Tous les visuels sont générés procéduralement (pixel art original).
 */

const TILE_W = 64;
const TILE_H = 32;
const PX = 3; // taille d'un « pixel » d'art à l'écran

const ROLE_COLORS: Record<AgentRole, { shirt: number; hair: number }> = {
  ceo: { shirt: 0x2f3b8f, hair: 0x2b1d14 },
  engineering: { shirt: 0x2e8b57, hair: 0x6b3e1e },
  marketing: { shirt: 0xd9534f, hair: 0xe0b040 },
  sales: { shirt: 0xe08a1e, hair: 0x1a1a1a },
  hr: { shirt: 0x8e44ad, hair: 0x9c4a2a },
  finance: { shirt: 0x16a0a0, hair: 0x4a4a4a },
};
export const STATUS_COLORS: Record<AgentStatus, number> = {
  idle: 0x9aa3ad,
  walking: 0x3b82f6,
  working: 0x22c55e,
  meeting: 0xa855f7,
  offline: 0x4b5563,
};

const DESKS = OFFICE_LAYOUT.desks;
const MEETING = OFFICE_LAYOUT.meeting;
const COFFEE = OFFICE_LAYOUT.coffee;

interface AgentSprite {
  view: AgentView;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Ellipse;
  walkTimer: Phaser.Time.TimerEvent | null;
  moving: boolean;
}

export interface OfficeSceneCallbacks {
  onSelectAgent: (agentId: string | null) => void;
}

export class OfficeScene extends Phaser.Scene {
  private agents = new Map<string, AgentSprite>();
  private monitors = new Map<string, Phaser.GameObjects.Rectangle>();
  private origin = { x: 0, y: 0 };
  private pending: { world: WorldSnapshot; selected: string | null } | null = null;
  private ready = false;
  private firstSync = true;
  private selected: string | null = null;

  constructor(private readonly callbacks: OfficeSceneCallbacks) {
    super('office');
  }

  // ---------- coordonnées iso ----------
  private iso(p: TilePosition): { x: number; y: number } {
    return {
      x: this.origin.x + (p.x - p.y) * (TILE_W / 2),
      y: this.origin.y + (p.x + p.y) * (TILE_H / 2),
    };
  }

  create(): void {
    this.generateTextures();
    const mapW = (WORLD_SIZE.width + WORLD_SIZE.height) * (TILE_W / 2);
    const mapH = (WORLD_SIZE.width + WORLD_SIZE.height) * (TILE_H / 2);
    this.origin = { x: WORLD_SIZE.height * (TILE_W / 2), y: 140 };
    this.drawRoom();
    this.cameras.main.setBackgroundColor('#1b1f2a');
    const fit = (): void => {
      const { width, height } = this.scale.gameSize;
      const zoom = Math.min(width / (mapW + 80), height / (mapH + 220));
      this.cameras.main.setZoom(Math.max(0.5, Math.min(zoom, 2)));
      this.cameras.main.centerOn(mapW / 2, this.origin.y + mapH / 2 - 60);
    };
    fit();
    this.scale.on('resize', fit);
    this.input.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.length === 0) this.callbacks.onSelectAgent(null);
      },
    );
    this.ready = true;
    if (this.pending) this.sync(this.pending.world, this.pending.selected);
  }

  // ---------- textures procédurales ----------
  private generateTextures(): void {
    const g = this.make.graphics({}, false);
    const px = (x: number, y: number, w: number, h: number, c: number): void => {
      g.fillStyle(c, 1);
      g.fillRect(x * PX, y * PX, w * PX, h * PX);
    };

    for (const [role, col] of Object.entries(ROLE_COLORS)) {
      for (const frame of [0, 1, 2]) {
        g.clear();
        // Personnage 12x22 « pixels »
        px(3, 0, 6, 3, col.hair); // cheveux
        px(3, 3, 6, 5, 0xf1c9a5); // visage
        px(2, 2, 1, 4, col.hair);
        px(4, 5, 1, 1, 0x222222); // yeux
        px(7, 5, 1, 1, 0x222222);
        px(2, 8, 8, 8, col.shirt); // torse
        px(1, 9, 1, 6, col.shirt); // bras
        px(10, 9, 1, 6, col.shirt);
        px(1, 15, 1, 1, 0xf1c9a5); // mains
        px(10, 15, 1, 1, 0xf1c9a5);
        px(5, 8, 2, 2, 0xffffff); // col
        const legs = 0x2d3142;
        if (frame === 0) {
          px(3, 16, 2, 5, legs);
          px(7, 16, 2, 5, legs);
        } else if (frame === 1) {
          px(2, 16, 2, 5, legs);
          px(7, 16, 2, 4, legs);
        } else {
          px(3, 16, 2, 4, legs);
          px(8, 16, 2, 5, legs);
        }
        px(frame === 1 ? 2 : 3, 21, 3, 1, 0x111111); // chaussures
        px(frame === 2 ? 8 : 7, 21, 3, 1, 0x111111);
        g.generateTexture(`avatar-${role}-${frame}`, 12 * PX, 22 * PX);
      }
    }

    const diamond = (key: string, top: number, edge: number): void => {
      g.clear();
      g.fillStyle(top, 1);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(TILE_W / 2, 0),
          new Phaser.Math.Vector2(TILE_W, TILE_H / 2),
          new Phaser.Math.Vector2(TILE_W / 2, TILE_H),
          new Phaser.Math.Vector2(0, TILE_H / 2),
        ],
        true,
      );
      g.lineStyle(1, edge, 0.6);
      g.strokePoints(
        [
          new Phaser.Math.Vector2(TILE_W / 2, 0),
          new Phaser.Math.Vector2(TILE_W, TILE_H / 2),
          new Phaser.Math.Vector2(TILE_W / 2, TILE_H),
          new Phaser.Math.Vector2(0, TILE_H / 2),
        ],
        true,
      );
      g.generateTexture(key, TILE_W, TILE_H);
    };
    diamond('floor-a', 0xc9a26b, 0x9c7a4a);
    diamond('floor-b', 0xbf965f, 0x9c7a4a);
    diamond('rug', 0x5b6ea8, 0x3f4f80);
    g.destroy();
  }

  // ---------- décor ----------
  private drawRoom(): void {
    for (let y = 0; y < WORLD_SIZE.height; y++) {
      for (let x = 0; x < WORLD_SIZE.width; x++) {
        const p = this.iso({ x, y });
        const nearMeeting = Math.abs(x - MEETING.x) <= 1 && Math.abs(y - MEETING.y) <= 1;
        const key = nearMeeting ? 'rug' : (x + y) % 2 === 0 ? 'floor-a' : 'floor-b';
        this.add.image(p.x, p.y + TILE_H / 2, key).setDepth(0);
      }
    }
    // Murs arrière (deux pans)
    const wall = this.add.graphics().setDepth(1);
    const h = 90;
    const a = this.iso({ x: 0, y: 0 });
    const b = this.iso({ x: WORLD_SIZE.width, y: 0 });
    const c = this.iso({ x: 0, y: WORLD_SIZE.height });
    wall.fillStyle(0xe8e1d4, 1);
    wall.fillPoints(
      [
        new Phaser.Math.Vector2(a.x, a.y - h),
        new Phaser.Math.Vector2(b.x, b.y - h),
        new Phaser.Math.Vector2(b.x, b.y),
        new Phaser.Math.Vector2(a.x, a.y),
      ],
      true,
    );
    wall.fillStyle(0xd3cabb, 1);
    wall.fillPoints(
      [
        new Phaser.Math.Vector2(a.x, a.y - h),
        new Phaser.Math.Vector2(c.x, c.y - h),
        new Phaser.Math.Vector2(c.x, c.y),
        new Phaser.Math.Vector2(a.x, a.y),
      ],
      true,
    );
    wall.fillStyle(0x8a7f6e, 1);
    wall.fillRect(a.x - 2, a.y - h, 4, h);
    // Fenêtres sur le mur droit
    for (const wx of [3, 7, 11]) {
      const w0 = this.iso({ x: wx, y: 0 });
      const w1 = this.iso({ x: wx + 2, y: 0 });
      wall.fillStyle(0x9fd3f0, 1);
      wall.fillPoints(
        [
          new Phaser.Math.Vector2(w0.x, w0.y - 70),
          new Phaser.Math.Vector2(w1.x, w1.y - 70),
          new Phaser.Math.Vector2(w1.x, w1.y - 30),
          new Phaser.Math.Vector2(w0.x, w0.y - 30),
        ],
        true,
      );
    }
    // Tableau « KPI » au mur gauche (décor)
    const k0 = this.iso({ x: 0, y: 3 });
    const k1 = this.iso({ x: 0, y: 6 });
    wall.fillStyle(0x2b3245, 1);
    wall.fillPoints(
      [
        new Phaser.Math.Vector2(k0.x, k0.y - 72),
        new Phaser.Math.Vector2(k1.x, k1.y - 72),
        new Phaser.Math.Vector2(k1.x, k1.y - 28),
        new Phaser.Math.Vector2(k0.x, k0.y - 28),
      ],
      true,
    );

    DESKS.forEach((d, i) => this.drawDesk(d, `desk-${i}`));
    this.drawBox(MEETING, 2, 1.2, 14, 0x7a5232, 0x5e3d24, 0x8e623e); // table réunion
    this.drawBox(COFFEE, 0.6, 0.6, 34, 0x444b57, 0x2f343d, 0x5a6270); // machine à café
    this.addLabel(COFFEE, 'Café', -26);
    this.addLabel({ x: MEETING.x + 1, y: MEETING.y + 1 }, 'Salle de réunion', 56);
  }

  private drawBox(
    at: TilePosition,
    wTiles: number,
    dTiles: number,
    height: number,
    top: number,
    left: number,
    right: number,
  ): void {
    const c = this.iso(at);
    const cx = c.x;
    const cy = c.y + TILE_H / 2;
    const hw = (TILE_W / 2) * ((wTiles + dTiles) / 2);
    const hh = (TILE_H / 2) * ((wTiles + dTiles) / 2);
    const g = this.add.graphics().setDepth(at.x + at.y + 0.5);
    const T = (x: number, y: number): Phaser.Math.Vector2 => new Phaser.Math.Vector2(x, y);
    g.fillStyle(left, 1);
    g.fillPoints(
      [T(cx - hw, cy - height), T(cx, cy + hh - height), T(cx, cy + hh), T(cx - hw, cy)],
      true,
    );
    g.fillStyle(right, 1);
    g.fillPoints(
      [T(cx + hw, cy - height), T(cx, cy + hh - height), T(cx, cy + hh), T(cx + hw, cy)],
      true,
    );
    g.fillStyle(top, 1);
    g.fillPoints(
      [
        T(cx, cy - hh - height),
        T(cx + hw, cy - height),
        T(cx, cy + hh - height),
        T(cx - hw, cy - height),
      ],
      true,
    );
  }

  private drawDesk(agentSpot: TilePosition, key: string): void {
    // Le bureau est placé derrière l'emplacement de l'agent (vu de dos).
    const desk = { x: agentSpot.x, y: agentSpot.y - 1 };
    this.drawBox(desk, 1.4, 0.8, 18, 0xf2f2f2, 0xbdbdbd, 0xd6d6d6);
    const c = this.iso(desk);
    // Écran : allumé (vert) quand l'agent associé travaille. C'est l'« outil visible ».
    const frame = this.add
      .rectangle(c.x, c.y - 14, 26, 18, 0x222831)
      .setDepth(desk.x + desk.y + 0.6);
    const screen = this.add
      .rectangle(c.x, c.y - 14, 22, 14, 0x39404d)
      .setDepth(desk.x + desk.y + 0.7);
    void frame;
    this.monitors.set(`${agentSpot.x},${agentSpot.y}`, screen);
    void key;
  }

  private addLabel(at: TilePosition, text: string, dy: number): void {
    const c = this.iso(at);
    this.add
      .text(c.x, c.y + dy, text, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#f5f5f5',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(0.2);
  }

  // ---------- synchronisation avec l'état backend ----------
  sync(world: WorldSnapshot, selected: string | null): void {
    if (!this.ready) {
      this.pending = { world, selected };
      return;
    }
    this.selected = selected;
    const animateSpawn = !this.firstSync;
    this.firstSync = false;

    const occupancy = new Map<string, number>();
    for (const view of world.agents) {
      const key = `${view.position.x},${view.position.y}`;
      const slot = occupancy.get(key) ?? 0;
      occupancy.set(key, slot + 1);
      const existing = this.agents.get(view.id);
      if (!existing) this.spawn(view, slot, animateSpawn);
      else this.updateAgent(existing, view, slot);
    }
    for (const [id, s] of this.agents) {
      if (!world.agents.some((a) => a.id === id)) {
        s.container.destroy();
        this.agents.delete(id);
      }
    }
    // Écrans : allumés si l'agent du poste travaille à son bureau.
    for (const [spot, screen] of this.monitors) {
      const working = world.agents.some(
        (a) => a.status === 'working' && `${a.position.x},${a.position.y}` === spot,
      );
      screen.setFillStyle(working ? 0x4ade80 : 0x39404d);
    }
    for (const s of this.agents.values()) s.ring.setVisible(s.view.id === this.selected);
  }

  private slotOffset(slot: number): { x: number; y: number } {
    if (slot === 0) return { x: 0, y: 0 };
    const angle = (slot - 1) * (Math.PI / 2.5);
    return { x: Math.cos(angle) * 26, y: Math.sin(angle) * 12 };
  }

  private spawn(view: AgentView, slot: number, animate: boolean): void {
    const p = this.iso(view.position);
    const off = this.slotOffset(slot);
    const container = this.add.container(p.x + off.x, p.y + TILE_H / 2 + off.y);
    const ring = this.add.ellipse(0, 0, 40, 18).setStrokeStyle(3, 0xfacc15).setVisible(false);
    const shadow = this.add.ellipse(0, 0, 30, 10, 0x000000, 0.25);
    const body = this.add.image(0, 0, `avatar-${view.role}-0`).setOrigin(0.5, 1);
    const name = this.add
      .text(0, -70, view.name, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffffff',
        backgroundColor: '#000000aa',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    const bubble = this.add
      .circle(name.width / 2 + 8, -76, 5, STATUS_COLORS[view.status])
      .setStrokeStyle(2, 0x111111);
    container.add([ring, shadow, body, name, bubble]);
    // Zone cliquable : le corps et le nom de l'avatar.
    for (const target of [body, name]) {
      target.setInteractive({ useHandCursor: true });
      target.on('pointerdown', () => this.callbacks.onSelectAgent(view.id));
    }
    container.setDepth(this.depthFor(view.position));
    container.setData('agentId', view.id);

    const sprite: AgentSprite = {
      view,
      container,
      body,
      bubble,
      ring,
      walkTimer: null,
      moving: false,
    };
    this.agents.set(view.id, sprite);

    if (animate) {
      // Apparition à la création : téléportation + étincelles.
      container.setScale(0, 0).setAlpha(0);
      this.tweens.add({
        targets: container,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        duration: 450,
        ease: 'Back.Out',
      });
      const beam = this.add
        .rectangle(container.x, container.y - 40, 30, 90, 0x93c5fd, 0.5)
        .setDepth(999);
      this.tweens.add({
        targets: beam,
        alpha: 0,
        scaleX: 0.2,
        duration: 700,
        onComplete: () => beam.destroy(),
      });
    }
  }

  private updateAgent(s: AgentSprite, view: AgentView, slot: number): void {
    const prev = s.view;
    s.view = view;
    s.bubble.setFillStyle(STATUS_COLORS[view.status]);
    if (prev.position.x !== view.position.x || prev.position.y !== view.position.y) {
      this.walk(s, prev.position, view.position, slot);
    } else if (!s.moving) {
      const p = this.iso(view.position);
      const off = this.slotOffset(slot);
      s.container.setPosition(p.x + off.x, p.y + TILE_H / 2 + off.y);
    }
  }

  private walk(s: AgentSprite, from: TilePosition, to: TilePosition, slot: number): void {
    // Chemin en L sur la grille (x puis y), animé tuile par tuile.
    const path: TilePosition[] = [];
    let cur = { ...from };
    while (cur.x !== to.x) {
      cur = { x: cur.x + Math.sign(to.x - cur.x), y: cur.y };
      path.push(cur);
    }
    while (cur.y !== to.y) {
      cur = { x: cur.x, y: cur.y + Math.sign(to.y - cur.y) };
      path.push(cur);
    }
    this.tweens.killTweensOf(s.container);
    s.moving = true;
    let frame = 1;
    s.walkTimer?.remove();
    s.walkTimer = this.time.addEvent({
      delay: 140,
      loop: true,
      callback: () => {
        frame = frame === 1 ? 2 : 1;
        s.body.setTexture(`avatar-${s.view.role}-${frame}`);
      },
    });
    const off = this.slotOffset(slot);
    const steps = path.map((t, i) => {
      const p = this.iso(t);
      const last = i === path.length - 1;
      return {
        x: p.x + (last ? off.x : 0),
        y: p.y + TILE_H / 2 + (last ? off.y : 0),
        duration: 220,
        onStart: () => s.container.setDepth(this.depthFor(t)),
      };
    });
    if (steps.length === 0) {
      s.moving = false;
      return;
    }
    this.tweens.chain({
      targets: s.container,
      tweens: steps,
      onComplete: () => {
        s.moving = false;
        s.walkTimer?.remove();
        s.walkTimer = null;
        s.body.setTexture(`avatar-${s.view.role}-0`);
      },
    });
  }

  private depthFor(p: TilePosition): number {
    return p.x + p.y + 0.8;
  }

  /** Utilisé par les tests e2e : position écran d'un agent. */
  agentScreenPosition(agentId: string): { x: number; y: number } | null {
    const s = this.agents.get(agentId);
    if (!s) return null;
    const cam = this.cameras.main;
    const world = { x: s.container.x, y: s.container.y - 30 };
    return {
      x: (world.x - cam.worldView.x) * cam.zoom,
      y: (world.y - cam.worldView.y) * cam.zoom,
    };
  }
}
