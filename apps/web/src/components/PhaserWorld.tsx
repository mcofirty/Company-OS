'use client';

import { useEffect, useRef } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import type { Game } from 'phaser';
import type { OfficeScene } from '../world/OfficeScene';

interface Props {
  world: WorldSnapshot | null;
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

declare global {
  interface Window {
    __officeScene?: OfficeScene;
  }
}

export function PhaserWorld({ world, selectedAgentId, onSelectAgent }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const onSelectRef = useRef(onSelectAgent);
  onSelectRef.current = onSelectAgent;

  useEffect(() => {
    let game: Game | null = null;
    let disposed = false;
    void (async () => {
      const Phaser = await import('phaser');
      const { OfficeScene } = await import('../world/OfficeScene');
      if (disposed || !host.current) return;
      const scene = new OfficeScene({ onSelectAgent: (id) => onSelectRef.current(id) });
      sceneRef.current = scene;
      window.__officeScene = scene;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        pixelArt: true,
        backgroundColor: '#1b1f2a',
        scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
        scene: [scene],
        banner: false,
      });
    })();
    return () => {
      disposed = true;
      game?.destroy(true);
      sceneRef.current = null;
      delete window.__officeScene;
    };
  }, []);

  useEffect(() => {
    if (world) sceneRef.current?.sync(world, selectedAgentId);
  });

  return <div ref={host} className="world-canvas" data-testid="world-canvas" />;
}
