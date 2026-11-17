'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export type Tier = 'auto' | 'quality' | 'balanced' | 'economy';

/** Libellés courts des choix de modèle (optimisation automatique, ADR-066). */
export const TIER_CHOICE_LABEL: Record<Tier, string> = {
  auto: 'Auto (selon la mission)',
  economy: 'Tier 1 · Léger · Haiku',
  balanced: 'Tier 2 · Moyen · Sonnet',
  quality: 'Tier 3 · Lourd · Opus',
};
interface ModelInfo {
  tier: Tier;
  model: string;
  label: string;
  hint: string;
  estimatedMissionUsd: number | null;
}

let cache: ModelInfo[] | null = null;

/** Niveau de modèle d'un agent, avec le coût estimé d'une mission type (tarifs du serveur). */
export function ModelTierSelect({
  value,
  onChange,
  testId = 'agent-model',
}: {
  value: Tier;
  onChange: (t: Tier) => void;
  testId?: string;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(cache);
  useEffect(() => {
    if (cache) return;
    api<ModelInfo[]>('/v1/models')
      .then((r) => {
        cache = r.data;
        setModels(r.data);
      })
      .catch(() => setModels([]));
  }, []);
  const fmt = (n: number | null) =>
    n === null
      ? ''
      : n < 0.01
        ? ' · < 0,01 $ / mission'
        : ` · ≈ ${n.toFixed(2).replace('.', ',')} $ / mission`;
  return (
    <label>
      Modèle
      <select value={value} onChange={(e) => onChange(e.target.value as Tier)} data-testid={testId}>
        <option value="auto">Auto — Haiku, Sonnet ou Opus selon chaque mission (recommandé)</option>
        {(
          models ?? [
            { tier: 'economy', label: '', hint: '', estimatedMissionUsd: null },
            { tier: 'balanced', label: '', hint: '', estimatedMissionUsd: null },
            { tier: 'quality', label: '', hint: '', estimatedMissionUsd: null },
          ]
        ).map((m) => (
          <option key={m.tier} value={m.tier}>
            {TIER_CHOICE_LABEL[m.tier]}
            {m.hint ? ` — ${m.hint}` : ''}
            {fmt(m.estimatedMissionUsd)}
          </option>
        ))}
      </select>
    </label>
  );
}
