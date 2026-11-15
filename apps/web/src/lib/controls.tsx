'use client';

import { createContext, useContext } from 'react';
import type { Me } from './useHq';

/**
 * Ce que l'utilisateur peut faire dans l'UI (docs/14 §5 : boutons mutateurs absents pour un
 * viewer). Indicatif seulement : le serveur revérifie chaque action. En replay, tout est en
 * lecture seule (docs/10 §6).
 */
export interface Controls {
  readOnly: boolean;
  caps: Me['capabilities'];
  role: Me['role'] | null;
}

const NONE: Me['capabilities'] = {
  createTask: false,
  pauseAgent: false,
  deactivateAgent: false,
  decideApproval: false,
  systemControl: false,
  ackAlert: false,
};

export const ControlsContext = createContext<Controls>({ readOnly: true, caps: NONE, role: null });

export function controlsFrom(me: Me | null, readOnly: boolean): Controls {
  const caps = me?.capabilities ?? NONE;
  return {
    readOnly,
    role: me?.role ?? null,
    caps: readOnly ? NONE : caps,
  };
}

export const useControls = (): Controls => useContext(ControlsContext);
