'use client';

import { useState, type ReactNode } from 'react';
import type { ToolView } from '@company-os/contracts';

export function ToolIcon({
  tool,
  size = 30,
}: {
  tool: Pick<ToolView, 'code' | 'color' | 'name'> | undefined;
  size?: number;
}) {
  return (
    <span
      className="tool-icon"
      style={{
        background: tool?.color ?? '#ccc',
        width: size,
        height: size,
        fontSize: size < 28 ? 9 : 10,
      }}
      aria-hidden
      title={tool?.name}
    >
      {tool?.code ?? '?'}
    </span>
  );
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function Provenance({ value }: { value: string }) {
  return (
    <span className={`prov prov-${value}`}>{value === 'demo' ? 'DEMO' : value.toUpperCase()}</span>
  );
}

export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/**
 * Action sensible confirmée DANS la page (pas de fenêtre native, qui peut être bloquée par le
 * navigateur) : motif obligatoire, bouton de confirmation, erreur affichée au même endroit.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  question,
  placeholder,
  testId,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  question: string;
  placeholder: string;
  testId: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button className="btn danger" data-testid={testId} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="confirm-box" role="alertdialog" aria-label={label}>
      <p>{question}</p>
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        data-testid={`${testId}-reason`}
      />
      {error && (
        <p className="form-error" role="alert" data-testid={`${testId}-error`}>
          {error}
        </p>
      )}
      <div className="actions row">
        <button
          className="btn danger"
          disabled={busy || reason.trim().length < 3}
          data-testid={`${testId}-confirm`}
          onClick={() => {
            setBusy(true);
            setError(null);
            onConfirm(reason.trim())
              .then(() => setOpen(false))
              .catch((e: unknown) =>
                setError(e instanceof Error && e.message ? e.message : 'Erreur inattendue'),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? '…' : confirmLabel}
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>
          Annuler
        </button>
      </div>
      {reason.trim().length < 3 && (
        <p className="muted small">Motif obligatoire (3 caractères min.).</p>
      )}
    </div>
  );
}
