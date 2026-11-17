'use client';

import { useEffect, useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { api } from '../../lib/api';
import { usd } from '../../lib/format';

interface Summary {
  since: string;
  completed: number;
  failed: number;
  blocked: number;
  documents: number;
  pendingApprovals: number;
  costMicros: number;
  newAgents: number;
}
const KEY = (org: string) => `hq-last-visit:${org}`;
const HOUR = 3600_000;

/**
 * « Depuis ta dernière visite » : ce qui s'est passé depuis la visite précédente (chiffres réels
 * lus en base). La date de visite est gardée dans CE navigateur ; le bandeau se ferme d'un clic.
 */
export function WelcomeBanner({
  world,
  onMissions,
  onDeliverables,
  onApprovals,
}: {
  world: WorldSnapshot;
  onMissions: () => void;
  onDeliverables: () => void;
  onApprovals: () => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hidden, setHidden] = useState(false);
  const orgId = world.org.id;
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(KEY(orgId));
      localStorage.setItem(KEY(orgId), new Date().toISOString());
    } catch {
      /* stockage indisponible : pas de bandeau */
    }
    if (!last || Date.now() - Date.parse(last) < HOUR) return;
    api<Summary>(`/v1/summary?since=${encodeURIComponent(last)}`)
      .then((r) => setSummary(r.data))
      .catch(() => setSummary(null));
  }, [orgId]);
  if (!summary || hidden) return null;
  const s = summary;
  const anything = s.completed + s.failed + s.blocked + s.documents + s.pendingApprovals > 0;
  if (!anything) return null;
  const when = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(s.since),
  );
  return (
    <div className="welcome" role="status" data-testid="welcome-banner">
      <span className="welcome-title">Depuis ta dernière visite ({when}) :</span>
      {s.completed > 0 && (
        <button className="chip ok" onClick={onMissions}>
          ✓ {s.completed} mission(s) terminée(s)
        </button>
      )}
      {s.failed + s.blocked > 0 && (
        <button className="chip bad" onClick={onMissions}>
          ! {s.failed + s.blocked} bloquée(s) / échouée(s)
        </button>
      )}
      {s.documents > 0 && (
        <button className="chip" onClick={onDeliverables}>
          📄 {s.documents} document(s)
        </button>
      )}
      {s.pendingApprovals > 0 && (
        <button className="chip warn" onClick={onApprovals}>
          ⏳ {s.pendingApprovals} validation(s) t’attend(ent)
        </button>
      )}
      {s.costMicros > 0 && <span className="muted small">coût IA {usd(s.costMicros)}</span>}
      <button className="welcome-close" onClick={() => setHidden(true)} aria-label="Fermer">
        ✕
      </button>
    </div>
  );
}

/**
 * Premier démarrage (organisation live) : trois étapes guidées. Chaque étape est cochée
 * d'après l'état réel (agent créé, mission lancée, résultat obtenu).
 */
export function Onboarding({
  world,
  canCreate,
  onCreateAgent,
  onMission,
  onDeliverables,
}: {
  world: WorldSnapshot;
  canCreate: boolean;
  onCreateAgent: () => void;
  onMission: () => void;
  onDeliverables: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const KEY_DONE = `hq-onboarding:${world.org.id}`;
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(KEY_DONE) === 'done');
    } catch {
      /* ignoré */
    }
  }, [KEY_DONE]);
  if (world.org.mode !== 'live' || dismissed) return null;
  const hasAgent = world.agents.length > 0;
  const hasMission = world.tasks.length > 0;
  const hasResult = world.tasks.some((t) => t.status === 'succeeded');
  if (hasAgent && hasMission && hasResult) return null;
  const steps = [
    {
      done: hasAgent,
      title: 'Crée ton premier agent',
      text: 'Choisis son poste, ses consignes, ses outils et son budget.',
      action: canCreate ? { label: '+ Créer un agent', run: onCreateAgent } : null,
    },
    {
      done: hasMission,
      title: 'Donne-lui une mission',
      text: 'Ex. « Fais une veille sur mes concurrents et enregistre un rapport ».',
      action: hasAgent ? { label: '+ Lancer une mission', run: onMission } : null,
    },
    {
      done: hasResult,
      title: 'Lis le résultat',
      text: 'Le résumé s’affiche dans la mission ; les documents dans « Livrables ».',
      action: hasMission ? { label: 'Voir les livrables', run: onDeliverables } : null,
    },
  ];
  return (
    <div className="onboarding" data-testid="onboarding">
      <header>
        <strong>Bienvenue dans ton QG</strong>
        <button
          className="linklike"
          onClick={() => {
            try {
              localStorage.setItem(KEY_DONE, 'done');
            } catch {
              /* ignoré */
            }
            setDismissed(true);
          }}
        >
          Masquer
        </button>
      </header>
      <ol>
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? 'done' : ''}>
            <span className="step-n">{s.done ? '✓' : i + 1}</span>
            <span className="grow">
              <strong>{s.title}</strong>
              <span className="muted small">{s.text}</span>
            </span>
            {!s.done && s.action && (
              <button className="btn small-btn primary" onClick={s.action.run}>
                {s.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
