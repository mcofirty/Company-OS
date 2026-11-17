'use client';

import type { CameraView } from '../../world/types';
import type { DisplayPrefs } from '../../lib/display';

const VIEWS: [CameraView, string][] = [
  ['top', 'Plongée'],
  ['tq', '3/4'],
  ['close', 'Rapprochée'],
];

/**
 * Barre de contrôle du QG (verre) : angle de vue, nuit, transparence de l'interface,
 * rendu 3D / 2D, légende travail réel / vie de bureau, masquage de l'interface (touche H).
 */
export function WorldControls({
  prefs,
  onPrefs,
  view,
  onView,
  uiHidden,
  onToggleUi,
}: {
  prefs: DisplayPrefs;
  onPrefs: (p: Partial<DisplayPrefs>) => void;
  view: CameraView;
  onView: (v: CameraView) => void;
  uiHidden: boolean;
  onToggleUi: () => void;
}) {
  const is3d = prefs.renderer === '3d';
  return (
    <div
      className="world-controls glass-ui"
      role="toolbar"
      aria-label="Affichage du QG"
      data-testid="world-controls"
    >
      {is3d && (
        <div className="wc-seg" role="group" aria-label="Angle de vue">
          {VIEWS.map(([k, label]) => (
            <button
              key={k}
              aria-pressed={view === k}
              onClick={() => onView(k)}
              data-testid={`view-${k}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {is3d && (
        <button
          className="wc-btn"
          aria-pressed={prefs.night}
          onClick={() => onPrefs({ night: !prefs.night })}
          data-testid="toggle-night"
        >
          {prefs.night ? '☀️ Jour' : '🌙 Nuit'}
        </button>
      )}
      {!uiHidden && (
        <>
          <span className="wc-sep" aria-hidden />
          <label className="wc-slider" title="Transparence de l’interface">
            Transparence
            <input
              type="range"
              min={30}
              max={95}
              value={Math.round((1.25 - prefs.glass) * 100)}
              onChange={(e) => onPrefs({ glass: 1.25 - Number(e.target.value) / 100 })}
              aria-label="Transparence de l’interface"
              data-testid="glass-slider"
            />
          </label>
          <span className="wc-sep" aria-hidden />
          <div className="wc-seg" role="group" aria-label="Rendu">
            <button
              aria-pressed={is3d}
              onClick={() => onPrefs({ renderer: '3d' })}
              data-testid="renderer-3d"
            >
              3D
            </button>
            <button
              aria-pressed={!is3d}
              onClick={() => onPrefs({ renderer: '2d' })}
              data-testid="renderer-2d"
            >
              2D
            </button>
          </div>
          <span className="wc-legend">
            <span>
              <i className="lg-work" /> Travail réel
            </span>
            <span>
              <i className="lg-life" /> Vie de bureau
            </span>
          </span>
        </>
      )}
      <button
        className="wc-btn"
        onClick={onToggleUi}
        aria-pressed={uiHidden}
        title="Masquer / afficher l’interface (touche H)"
        data-testid="toggle-ui"
      >
        {uiHidden ? '◑ Interface' : '◐ Masquer'}
      </button>
    </div>
  );
}
