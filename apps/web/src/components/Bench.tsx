'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { syntheticWorld } from '../world/bench';

const WorldViewport = dynamic(
  () => import('./cockpit/WorldViewport').then((m) => m.WorldViewport),
  { ssr: false },
);

declare global {
  interface Window {
    __bench?: { agents: number; samples: number[] };
  }
}

/**
 * Banc de rendu (docs/08 §3) : N avatars synthétiques qui bougent en continu, compteur d'images
 * par seconde. Aucune requête réseau. Paramètre : /bench?agents=50
 */
export function Bench() {
  const [count, setCount] = useState(50);
  const [tick, setTick] = useState(0);
  const [fps, setFps] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get('agents'));
    if (Number.isFinite(n) && n > 0) setCount(Math.min(200, Math.floor(n)));
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      setTick((x) => x + 1);
      setNow(Date.now());
    }, 3000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    window.__bench = { agents: count, samples: [] };
    let frames = 0;
    let start = performance.now();
    let raf = 0;
    const loop = (t: number): void => {
      frames++;
      if (t - start >= 1000) {
        const v = Math.round((frames * 1000) / (t - start));
        setFps(v);
        window.__bench?.samples.push(v);
        frames = 0;
        start = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  const world = useMemo(() => syntheticWorld(count, tick, now), [count, tick, now]);
  return (
    <div className="bench">
      <header className="bench-head" data-testid="bench-head">
        <strong>BANC DE CHARGE</strong> monde synthétique local · aucune donnée réelle ni requête
        réseau · {count} avatars · <span data-testid="bench-fps">{fps ?? '…'} img/s</span>
      </header>
      <div className="bench-world">
        <WorldViewport
          world={world}
          selection={null}
          now={now}
          renderer="3d"
          onSelect={() => undefined}
          onReady={() => undefined}
        />
      </div>
    </div>
  );
}
