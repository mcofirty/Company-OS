import {
  OFFICE_LAYOUT,
  type AgentRole,
  type NewDomainEvent,
  type TilePosition,
} from '@company-os/contracts';

export const DEMO_COMPANY = {
  id: 'co_demo',
  name: 'Demo Corp (simulation)',
  mode: 'demo',
} as const;

export const DEMO_AGENTS: { id: string; name: string; role: AgentRole; desk: TilePosition }[] = [
  { id: 'ag_demo_ceo', name: 'Iris', role: 'ceo', desk: OFFICE_LAYOUT.desks[0] },
  { id: 'ag_demo_eng', name: 'Bastien', role: 'engineering', desk: OFFICE_LAYOUT.desks[1] },
  { id: 'ag_demo_mkt', name: 'Nora', role: 'marketing', desk: OFFICE_LAYOUT.desks[2] },
  { id: 'ag_demo_sales', name: 'Malik', role: 'sales', desk: OFFICE_LAYOUT.desks[3] },
  { id: 'ag_demo_hr', name: 'Chloé', role: 'hr', desk: OFFICE_LAYOUT.desks[4] },
];

export function demoSpawnEvents(): NewDomainEvent[] {
  return DEMO_AGENTS.map((a) => ({
    type: 'agent.spawned',
    companyId: DEMO_COMPANY.id,
    mode: 'demo',
    actor: { kind: 'system', id: null },
    payload: { agentId: a.id, name: a.name, role: a.role, position: a.desk },
  }));
}
