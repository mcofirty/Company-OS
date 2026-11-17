'use client';

import { useEffect, useRef } from 'react';
import type { Game } from 'phaser';
import type { WorldSnapshot } from '@company-os/contracts';
import type { HqScene, Selection } from '../../world/HqScene';

declare global {
  interface Window {
    __hqScene?: HqScene;
  }
}

interface Props {
  world: WorldSnapshot | null;
  selection: Selection | null;
  now: number;
  onSelect: (s: Selection | null) => void;
  onReady: (scene: HqScene) => void;
  onEmptyRoom?: (roomId: string) => void;
}

/** Monde Phaser initialisé côté client uniquement et détruit proprement au démontage. */
export function WorldViewport({ world, selection, now, onSelect, onReady, onEmptyRoom }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HqScene | null>(null);
  const cb = useRef({ onSelect, onReady, onEmptyRoom });
  cb.current = { onSelect, onReady, onEmptyRoom };

  useEffect(() => {
    let game: Game | null = null;
    let disposed = false;
    void (async () => {
      const Phaser = await import('phaser');
      const { HqScene } = await import('../../world/HqScene');
      if (disposed || !host.current) return;
      const s = new HqScene({
        onSelect: (sel) => cb.current.onSelect(sel),
        onEmptyRoom: (r) => cb.current.onEmptyRoom?.(r),
      });
      scene.current = s;
      if (process.env.NODE_ENV !== 'production') window.__hqScene = s;
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
      game.events.once('ready', () => cb.current.onReady(s));
    })();
    return () => {
      disposed = true;
      game?.destroy(true);
      scene.current = null;
      delete window.__hqScene;
    };
  }, []);

  useEffect(() => {
    if (world) scene.current?.sync(world, selection, now);
  }, [world, selection, now]);

  return (
    <div
      ref={host}
      className="world-canvas"
      data-testid="world-canvas"
      aria-label="Quartier général isométrique"
    />
  );
}
