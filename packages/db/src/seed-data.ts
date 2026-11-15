import type { AgentRole } from '@company-os/contracts';

/** Organisation démo (UUID fixe, données entièrement fictives). */
export const DEMO_ORG = {
  id: '6f1c2b0e-3d4a-4e8b-9a7c-1d2e3f4a5b6c',
  name: 'Living HQ — démo',
  mode: 'demo',
} as const;

export const DEV_ADMIN = {
  id: '0b7c9d2e-1f3a-4b5c-8d6e-7f8091a2b3c4',
  providerSubject: 'local-dev-admin',
  displayName: 'Admin local (dev)',
} as const;

export const DEMO_DEPARTMENTS = [
  {
    id: 'direction',
    name: 'Direction générale',
    color: '#E7C16A',
    capacity: 2,
    managerAgentId: 'coo-01',
  },
  { id: 'sales', name: 'Sales', color: '#EA966C', capacity: 4, managerAgentId: 'sales-manager' },
  {
    id: 'marketing',
    name: 'Studio / Marketing',
    color: '#9C84DE',
    capacity: 3,
    managerAgentId: 'growth-manager',
  },
  {
    id: 'finance',
    name: 'Finance',
    color: '#76C69A',
    capacity: 3,
    managerAgentId: 'finance-manager',
  },
  {
    id: 'rh',
    name: 'Ressources humaines',
    color: '#E8A5C0',
    capacity: 3,
    managerAgentId: 'hr-manager',
  },
  {
    id: 'operations',
    name: 'Operations',
    color: '#88BADC',
    capacity: 3,
    managerAgentId: 'ops-manager',
  },
] as const;

export interface DemoAgentSeed {
  id: string;
  name: string;
  title: string;
  role: AgentRole;
  departmentId: string;
  managerId: string | null;
  avatarId: string;
  deskAnchor: string;
  grants: Record<string, string[]>;
}

const sales = { crm: ['lookup_lead', 'add_note'], email: ['draft_email'] };

export const DEMO_AGENTS: DemoAgentSeed[] = [
  {
    id: 'coo-01',
    name: 'Iris',
    title: 'COO',
    role: 'manager',
    departmentId: 'direction',
    managerId: null,
    avatarId: 'avatar-01',
    deskAnchor: 'direction-desk-01',
    grants: { analytics: ['query_metrics'], docs: ['draft_doc'] },
  },
  {
    id: 'sales-manager',
    name: 'Malik',
    title: 'Responsable Sales',
    role: 'manager',
    departmentId: 'sales',
    managerId: 'coo-01',
    avatarId: 'avatar-02',
    deskAnchor: 'sales-desk-01',
    grants: sales,
  },
  {
    id: 'sdr-01',
    name: 'Nora',
    title: 'SDR',
    role: 'specialist',
    departmentId: 'sales',
    managerId: 'sales-manager',
    avatarId: 'avatar-03',
    deskAnchor: 'sales-desk-02',
    grants: sales,
  },
  {
    id: 'sdr-02',
    name: 'Théo',
    title: 'SDR',
    role: 'specialist',
    departmentId: 'sales',
    managerId: 'sales-manager',
    avatarId: 'avatar-04',
    deskAnchor: 'sales-desk-03',
    grants: sales,
  },
  {
    id: 'growth-manager',
    name: 'Inès',
    title: 'Growth Manager',
    role: 'manager',
    departmentId: 'marketing',
    managerId: 'coo-01',
    avatarId: 'avatar-05',
    deskAnchor: 'marketing-desk-01',
    grants: { docs: ['draft_doc'], search: ['search'], analytics: ['query_metrics'] },
  },
  {
    id: 'content-01',
    name: 'Sam',
    title: 'Content',
    role: 'specialist',
    departmentId: 'marketing',
    managerId: 'growth-manager',
    avatarId: 'avatar-06',
    deskAnchor: 'marketing-desk-02',
    grants: { docs: ['draft_doc'], search: ['search'] },
  },
  {
    id: 'finance-manager',
    name: 'Aurélien',
    title: 'Responsable Finance',
    role: 'manager',
    departmentId: 'finance',
    managerId: 'coo-01',
    avatarId: 'avatar-07',
    deskAnchor: 'finance-desk-01',
    grants: { erp: ['fetch_invoice'], analytics: ['query_metrics'] },
  },
  {
    id: 'billing-01',
    name: 'Mei',
    title: 'Facturation',
    role: 'specialist',
    departmentId: 'finance',
    managerId: 'finance-manager',
    avatarId: 'avatar-08',
    deskAnchor: 'finance-desk-02',
    grants: { erp: ['fetch_invoice'], analytics: ['query_metrics'] },
  },
  {
    id: 'hr-manager',
    name: 'Chloé',
    title: 'Responsable RH',
    role: 'manager',
    departmentId: 'rh',
    managerId: 'coo-01',
    avatarId: 'avatar-01',
    deskAnchor: 'rh-desk-01',
    grants: { ats: ['list_candidates'], docs: ['draft_doc'] },
  },
  {
    id: 'recruiter-01',
    name: 'Yanis',
    title: 'Recrutement',
    role: 'specialist',
    departmentId: 'rh',
    managerId: 'hr-manager',
    avatarId: 'avatar-02',
    deskAnchor: 'rh-desk-02',
    grants: { ats: ['list_candidates'], docs: ['draft_doc'] },
  },
  {
    id: 'ops-manager',
    name: 'Lena',
    title: 'Responsable Ops',
    role: 'manager',
    departmentId: 'operations',
    managerId: 'coo-01',
    avatarId: 'avatar-03',
    deskAnchor: 'operations-desk-01',
    grants: { docs: ['draft_doc'], email: ['draft_email'] },
  },
  {
    id: 'support-01',
    name: 'Kofi',
    title: 'Support',
    role: 'specialist',
    departmentId: 'operations',
    managerId: 'ops-manager',
    avatarId: 'avatar-04',
    deskAnchor: 'operations-desk-02',
    grants: { docs: ['draft_doc'], email: ['draft_email'] },
  },
];
