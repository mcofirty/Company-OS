import type { AgentRole, AgentStatus, DomainEvent } from '@company-os/contracts';

export const ROLE_LABEL: Record<AgentRole, string> = {
  ceo: 'Direction',
  engineering: 'Ingénierie',
  marketing: 'Marketing',
  sales: 'Ventes',
  hr: 'RH',
  finance: 'Finance',
};
export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Disponible',
  walking: 'Se déplace',
  working: 'Travaille',
  meeting: 'En réunion',
  offline: 'Hors ligne',
};

export function describeEvent(e: DomainEvent, names: Map<string, string>): string {
  const who = names.get(e.payload.agentId) ?? e.payload.agentId;
  switch (e.type) {
    case 'agent.spawned':
      return `${e.payload.name} rejoint l'entreprise (${ROLE_LABEL[e.payload.role]})`;
    case 'agent.moved':
      return `${who} se déplace (${e.payload.from.x},${e.payload.from.y}) → (${e.payload.to.x},${e.payload.to.y})`;
    case 'agent.status_changed':
      return `${who} : ${STATUS_LABEL[e.payload.status]}${e.payload.activity ? ` — ${e.payload.activity}` : ''}`;
  }
}

export const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
