'use client';

import { useEffect, useRef } from 'react';
import type { Game } from 'phaser';
import type { WorldSnapshot } from '@company-os/contracts';
import type { HqWorldView, Selection } from '../../world/types';

declare global {
  interface Window {
    __hqScene?: HqWorldView;
  }
}

/** Rendu du QG : 3D « studio » (par défaut) ou 2D classique (Phaser). */
export type WorldRenderer = '3d' | '2d';

interface Props {
  world: WorldSnapshot | null;
  selection: Selection | null;
  now: number;
  renderer: WorldRenderer;
  onSelect: (s: Selection | null) => void;
  onReady: (scene: HqWorldView | null) => void;
  onEmptyRoom?: (roomId: string) => void;
  /** Appelé si la 3D est indisponible (WebGL absent) : bascule sur le rendu 2D. */
  onFallback?: () => void;
}

/** Monde initialisé côté client uniquement et détruit proprement au démontage. */
export function WorldViewport({
  world,
  selection,
  now,
  renderer,
  onSelect,
  onReady,
  onEmptyRoom,
  onFallback,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HqWorldView | null>(null);
  const cb = useRef({ onSelect, onReady, onEmptyRoom, onFallback });
  cb.current = { onSelect, onReady, onEmptyRoom, onFallback };
  const latest = useRef({ world, selection, now });
  latest.current = { world, selection, now };

  useEffect(() => {
    let game: Game | null = null;
    let dispose: (() => void) | null = null;
    let disposed = false;
    const callbacks = {
      onSelect: (sel: Selection | null) => cb.current.onSelect(sel),
      onEmptyRoom: (r: string) => cb.current.onEmptyRoom?.(r),
    };
    const ready = (s: HqWorldView): void => {
      scene.current = s;
      if (process.env.NODE_ENV !== 'production') window.__hqScene = s;
      const l = latest.current;
      if (l.world) s.sync(l.world, l.selection, l.now);
      cb.current.onReady(s);
    };
    void (async () => {
      if (renderer === '3d') {
        const { StudioScene, webglAvailable } = await import('../../world/StudioScene');
        if (disposed || !host.current) return;
        if (!webglAvailable()) {
          cb.current.onFallback?.();
          return;
        }
        const s = new StudioScene(host.current, callbacks);
        dispose = () => s.dispose();
        ready(s);
        return;
      }
      const Phaser = await import('phaser');
      const { HqScene } = await import('../../world/HqScene');
      if (disposed || !host.current) return;
      const s = new HqScene(callbacks);
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        pixelArt: true,
        antialias: false,
        backgroundColor: '#d6bde9',
        scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
        scene: [s],
        banner: false,
      });
      game.events.once('ready', () => ready(s));
    })();
    return () => {
      disposed = true;
      dispose?.();
      game?.destroy(true);
      scene.current = null;
      cb.current.onReady(null);
      delete window.__hqScene;
    };
  }, [renderer]);

  useEffect(() => {
    if (world) scene.current?.sync(world, selection, now);
  }, [world, selection, now]);

  return (
    <div
      ref={host}
      className={`world-canvas ${renderer === '3d' ? 'is-3d' : 'is-2d'}`}
      data-testid="world-canvas"
      aria-label="Quartier général"
    />
  );
}
