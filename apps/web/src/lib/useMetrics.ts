'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export type MetricsWindow = '1h' | '24h' | '7d';
export interface ToolHealth {
  toolId: string;
  calls: number;
  failures: number;
  errorRate: number | null;
  p95Ms: number | null;
  lastUsedAt: string | null;
  health: 'healthy' | 'degraded';
}
export interface MetricsSummary {
  window: MetricsWindow;
  since: string;
  tasks: {
    succeeded: number;
    failed: number;
    blocked: number;
    successRate: number | null;
    sample: number;
  };
  llm: { calls: number; costMicros: number };
  tools: ToolHealth[];
}

/** KPI serveur par fenêtre ; rafraîchis quand le journal avance (au plus toutes les 5 s). */
export function useMetrics(
  window: MetricsWindow,
  lastSeq: number | undefined,
  enabled: boolean,
): MetricsSummary | null {
  const [data, setData] = useState<MetricsSummary | null>(null);
  const bucket = Math.floor(Date.now() / 5000);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<MetricsSummary>(`/v1/metrics/summary?window=${window}`)
      .then((r) => !cancelled && setData(r.data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [window, enabled, lastSeq === undefined ? 0 : bucket]);
  return data;
}
