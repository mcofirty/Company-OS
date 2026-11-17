'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Préférences d'affichage du QG, propres à ce navigateur (aucune donnée métier) : rendu 3D ou
 * 2D, transparence de l'interface en verre, ambiance de nuit.
 */
export type Renderer = '3d' | '2d';
export interface DisplayPrefs {
  renderer: Renderer;
  /** Opacité des panneaux en verre (0,3 à 0,95). */
  glass: number;
  night: boolean;
}
const KEY = 'hq-display';
export const DEFAULT_DISPLAY: DisplayPrefs = { renderer: '3d', glass: 0.72, night: false };

export function parseDisplay(raw: string | null): DisplayPrefs {
  try {
    const v = JSON.parse(raw ?? '{}') as Partial<DisplayPrefs>;
    return {
      renderer: v.renderer === '2d' ? '2d' : '3d',
      glass:
        typeof v.glass === 'number' && Number.isFinite(v.glass)
          ? Math.min(0.95, Math.max(0.3, v.glass))
          : DEFAULT_DISPLAY.glass,
      night: v.night === true,
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export function useDisplay(): [DisplayPrefs, (p: Partial<DisplayPrefs>) => void] {
  const [prefs, setPrefs] = useState<DisplayPrefs>(DEFAULT_DISPLAY);
  useEffect(() => {
    try {
      setPrefs(parseDisplay(localStorage.getItem(KEY)));
    } catch {
      /* stockage indisponible : valeurs par défaut */
    }
  }, []);
  const update = useCallback((p: Partial<DisplayPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* préférence pour cette session seulement */
      }
      return next;
    });
  }, []);
  return [prefs, update];
}
