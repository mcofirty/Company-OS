'use client';

import type { ReactNode } from 'react';
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
