import type { TaskKind, ToolActionKind, ToolRisk } from './domain';

/** Catalogue des tâches démo déclenchables (scénarios déterministes, sans appel externe). */
export interface DemoTaskSpec {
  title: string;
  departmentId: string;
  toolId: string;
  action: string;
  description: string;
  /** Entrée fictive passée à l'adaptateur démo (aucune donnée réelle). */
  input: Record<string, string>;
}

/** Catalogue des tâches démo déclenchables (scénarios déterministes, sans appel externe). */
export const DEMO_TASK_CATALOG: Record<TaskKind, DemoTaskSpec> = {
  qualify_lead: {
    title: 'Qualifier un prospect (DEMO)',
    departmentId: 'sales',
    toolId: 'crm',
    action: 'lookup_lead',
    description: 'Recherche le prospect dans le CRM de démonstration et produit une qualification.',
    input: { leadRef: 'demo-lead-042' },
  },
  check_invoice: {
    title: 'Contrôler une facture (DEMO)',
    departmentId: 'finance',
    toolId: 'erp',
    action: 'fetch_invoice',
    description:
      "Lit une facture dans l'ERP de démonstration. Scénario d'erreur : l'ERP démo répond 503.",
    input: { invoiceRef: 'demo-inv-2026-117' },
  },
  forecast_cashflow: {
    title: 'Prévision de trésorerie (DEMO)',
    departmentId: 'finance',
    toolId: 'analytics',
    action: 'query_metrics',
    description: 'Interroge les métriques fictives pour une prévision à 30 jours.',
    input: { metric: 'cash_30d' },
  },
  draft_campaign: {
    title: 'Brouillon de campagne (DEMO)',
    departmentId: 'marketing',
    toolId: 'docs',
    action: 'draft_doc',
    description: 'Rédige un brouillon de campagne interne (aucune publication).',
    input: { topic: 'lancement-printemps' },
  },
  screen_candidates: {
    title: 'Présélection de candidats (DEMO)',
    departmentId: 'rh',
    toolId: 'ats',
    action: 'list_candidates',
    description: "Liste des candidatures fictives dans l'ATS de démonstration.",
    input: { jobRef: 'demo-job-support' },
  },
  answer_ticket: {
    title: 'Préparer une réponse support (DEMO)',
    departmentId: 'operations',
    toolId: 'email',
    action: 'draft_email',
    description: 'Prépare un brouillon de réponse (jamais envoyé).',
    input: { ticketRef: 'demo-ticket-311' },
  },
  weekly_review: {
    title: 'Revue hebdomadaire (DEMO)',
    departmentId: 'direction',
    toolId: 'analytics',
    action: 'query_metrics',
    description: 'Consolide les indicateurs fictifs de la semaine.',
    input: { metric: 'weekly_kpis' },
  },
};

export interface ToolActionSpec {
  action: string;
  kind: ToolActionKind;
  risk: ToolRisk;
  label: string;
}
export interface ToolCatalogEntry {
  id: string;
  name: string;
  code: string; // glyphe court affiché (icône originale, sans logo tiers)
  category: string;
  color: string;
  actions: ToolActionSpec[];
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: 'crm',
    name: 'CRM',
    code: 'CRM',
    category: 'données',
    color: '#ea966c',
    actions: [
      { action: 'lookup_lead', kind: 'read', risk: 'read', label: 'Lire un prospect' },
      { action: 'add_note', kind: 'write', risk: 'internal_write', label: 'Ajouter une note' },
    ],
  },
  {
    id: 'email',
    name: 'Email (simulé)',
    code: 'MAIL',
    category: 'communication',
    color: '#88badc',
    actions: [
      { action: 'draft_email', kind: 'draft', risk: 'internal_write', label: 'Brouillon' },
      { action: 'send_email', kind: 'send', risk: 'external_write', label: 'Envoyer' },
    ],
  },
  {
    id: 'drive',
    name: 'Fichiers',
    code: 'DRV',
    category: 'documents',
    color: '#76c69a',
    actions: [{ action: 'read_file', kind: 'read', risk: 'read', label: 'Lire un fichier' }],
  },
  {
    id: 'search',
    name: 'Recherche web (fixtures)',
    code: 'WEB',
    category: 'web',
    color: '#9c84de',
    actions: [{ action: 'search', kind: 'search', risk: 'read', label: 'Rechercher' }],
  },
  {
    id: 'erp',
    name: 'ERP / Facturation',
    code: 'ERP',
    category: 'finance',
    color: '#e7c16a',
    actions: [
      { action: 'fetch_invoice', kind: 'read', risk: 'read', label: 'Lire une facture' },
      { action: 'issue_invoice', kind: 'execute', risk: 'high_impact', label: 'Émettre' },
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    code: 'ANA',
    category: 'données',
    color: '#5aa5c9',
    actions: [{ action: 'query_metrics', kind: 'read', risk: 'read', label: 'Lire des métriques' }],
  },
  {
    id: 'ats',
    name: 'ATS (recrutement)',
    code: 'ATS',
    category: 'coordination',
    color: '#e8a5c0',
    actions: [{ action: 'list_candidates', kind: 'read', risk: 'read', label: 'Lister candidats' }],
  },
  {
    id: 'docs',
    name: 'Documents',
    code: 'DOC',
    category: 'documents',
    color: '#b59cf0',
    actions: [{ action: 'draft_doc', kind: 'draft', risk: 'internal_write', label: 'Rédiger' }],
  },
];

export const toolById = (id: string): ToolCatalogEntry | undefined =>
  TOOL_CATALOG.find((t) => t.id === id);
export const toolAction = (toolId: string, action: string): ToolActionSpec | undefined =>
  toolById(toolId)?.actions.find((a) => a.action === action);
