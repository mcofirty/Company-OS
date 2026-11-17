'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, apiPost, ApiFailure } from '../../lib/api';
import { time } from '../../lib/format';

interface OpsView {
  available: boolean;
  online?: boolean;
  autoUpdate?: boolean;
  agentSeenAt?: string | null;
  backups?: { file: string; size: number; createdAt: string }[];
  job?: { action: string; state: string; at: string; file?: string; detail?: string } | null;
  update?: { state: string; at: string; from?: string; to?: string; subject?: string } | null;
}
const errText = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Erreur inattendue');
const size = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : n > 1e3 ? `${Math.round(n / 1e3)} Ko` : `${n} o`;
const STATE: Record<string, string> = { running: 'en cours…', ok: 'réussie', error: 'en échec' };

/**
 * Serveur : mises à jour automatiques et sauvegardes (administrateur). Les actions passent par
 * l'agent hôte du VPS (une minute au plus pour démarrer).
 */
export function ServerSettings({
  toast,
}: {
  toast: (t: { text: string; tone: 'success' | 'danger' }) => void;
}) {
  const [view, setView] = useState<OpsView | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const load = useCallback(() => {
    api<OpsView>('/v1/ops')
      .then((r) => setView(r.data))
      .catch(() => setView({ available: false }));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (!view) return <p className="muted">Chargement…</p>;
  if (!view.available)
    return (
      <div className="page-empty" data-testid="ops-unavailable">
        <p>
          <strong>Agent du serveur pas encore actif.</strong> Il s’installe tout seul lors de la
          prochaine mise à jour du serveur (une dernière fois depuis le terminal :{' '}
          <code>cd /opt/company-os && git pull && bash infra/deploy/update.sh</code>). Ensuite :
          mises à jour automatiques et sauvegardes depuis cette page.
        </p>
      </div>
    );
  const job = view.job;
  return (
    <div className="server-settings" data-testid="server-settings">
      <section className="panel">
        <h3>Mises à jour automatiques</h3>
        <p>
          {view.autoUpdate ? '✅ Activées' : '⏸ Désactivées (AUTO_UPDATE=false)'} · le serveur
          vérifie GitHub toutes les 10 minutes et installe les nouveautés après une sauvegarde.
        </p>
        <p className="muted small">
          Agent du serveur : {view.online ? '🟢 en ligne' : '🔴 silencieux'}
          {view.agentSeenAt ? ` · vu à ${time(view.agentSeenAt)}` : ''}
        </p>
        {view.update && (
          <p data-testid="ops-update">
            Dernière mise à jour : <strong>{STATE[view.update.state] ?? view.update.state}</strong>{' '}
            le {time(view.update.at)}
            {view.update.subject ? ` — « ${view.update.subject} »` : ''}
            {view.update.to ? ` (${view.update.to})` : ''}
          </p>
        )}
      </section>
      <section className="panel">
        <header className="panel-head">
          <h3>Sauvegardes</h3>
          <span className="grow" />
          <button
            className="btn primary small-btn"
            disabled={job?.state === 'running'}
            onClick={() =>
              apiPost('/v1/ops/backup', {})
                .then(() => {
                  toast({ text: 'Sauvegarde demandée (démarre sous une minute)', tone: 'success' });
                  load();
                })
                .catch((e: unknown) => toast({ text: errText(e), tone: 'danger' }))
            }
            data-testid="ops-backup"
          >
            Sauvegarder maintenant
          </button>
        </header>
        <p className="muted small">
          Automatique chaque nuit à 3 h 30 et avant chaque mise à jour · conservées 14 jours.
        </p>
        {job && (
          <p data-testid="ops-job">
            {job.action === 'restore' ? 'Restauration' : 'Sauvegarde'}{' '}
            {STATE[job.state] ?? job.state} ({time(job.at)}){job.file ? ` · ${job.file}` : ''}
          </p>
        )}
        <ul className="backup-list">
          {(view.backups ?? []).map((b) => (
            <li key={b.file}>
              <span className="grow">
                {time(b.createdAt)} · <span className="muted">{size(b.size)}</span>
              </span>
              {confirm === b.file ? (
                <span className="confirm-box danger">
                  Remplace TOUTES les données actuelles (une sauvegarde de l’état actuel est faite
                  avant). Tapez RESTAURER :
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    data-testid="ops-restore-typed"
                  />
                  <button
                    className="btn danger small-btn"
                    disabled={typed !== 'RESTAURER'}
                    onClick={() =>
                      apiPost('/v1/ops/restore', { file: b.file, confirm: 'RESTAURER' })
                        .then(() => {
                          toast({
                            text: 'Restauration demandée : le cockpit va redémarrer',
                            tone: 'success',
                          });
                          setConfirm(null);
                          load();
                        })
                        .catch((e: unknown) => toast({ text: errText(e), tone: 'danger' }))
                    }
                  >
                    Restaurer
                  </button>
                  <button className="btn ghost small-btn" onClick={() => setConfirm(null)}>
                    Annuler
                  </button>
                </span>
              ) : (
                <button
                  className="btn small-btn"
                  onClick={() => {
                    setTyped('');
                    setConfirm(b.file);
                  }}
                >
                  Restaurer…
                </button>
              )}
            </li>
          ))}
          {(view.backups ?? []).length === 0 && (
            <li className="muted">Aucune sauvegarde pour l’instant.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
