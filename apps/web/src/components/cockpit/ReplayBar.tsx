'use client';

import { time } from '../../lib/format';
import type { ReplayState } from '../../lib/useReplay';

/** Contrôles du replay : lecture, vitesse 0,5–4×, curseur ; bandeau REPLAY permanent. */
export function ReplayBar({ replay }: { replay: ReplayState }) {
  const total = replay.events.length;
  return (
    <div className="replay-bar" role="region" aria-label="Replay" data-testid="replay-bar">
      <strong className="replay-badge">REPLAY</strong>
      <span className="replay-time" data-testid="replay-time">
        {replay.loading
          ? 'Chargement du journal…'
          : replay.time
            ? `${new Date(replay.time).toLocaleDateString('fr-FR')} ${time(replay.time)}`
            : '—'}
      </span>
      <button
        className="btn"
        onClick={replay.togglePlay}
        disabled={replay.loading || total === 0}
        data-testid="replay-play"
      >
        {replay.playing ? '❚❚ Pause' : '▶ Lire'}
      </button>
      <select
        value={replay.speed}
        onChange={(e) => replay.setSpeed(Number(e.target.value))}
        aria-label="Vitesse de lecture"
      >
        {[0.5, 1, 2, 4].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <input
        type="range"
        min={0}
        max={total}
        value={replay.index}
        onChange={(e) => replay.seek(Number(e.target.value))}
        aria-label="Position dans l'historique"
        data-testid="replay-slider"
      />
      <span className="muted small">
        {replay.index}/{total} événements · lecture seule, aucune exécution
      </span>
      <button className="btn" onClick={replay.stop} data-testid="replay-exit">
        Quitter le replay
      </button>
    </div>
  );
}
