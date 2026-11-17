'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export type Tier = 'quality' | 'balanced' | 'economy';
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
        {(
          models ?? [
            { tier: 'quality', label: 'Qualité', hint: '', estimatedMissionUsd: null },
            { tier: 'balanced', label: 'Équilibré', hint: '', estimatedMissionUsd: null },
            { tier: 'economy', label: 'Économique', hint: '', estimatedMissionUsd: null },
          ]
        ).map((m) => (
          <option key={m.tier} value={m.tier}>
            {m.label}
            {m.hint ? ` — ${m.hint}` : ''}
            {fmt(m.estimatedMissionUsd)}
          </option>
        ))}
      </select>
    </label>
  );
}
