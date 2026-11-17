import type { DemoTaskKind, ToolActionKind, ToolRisk } from './domain';

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
export const DEMO_TASK_CATALOG: Record<DemoTaskKind, DemoTaskSpec> = {
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
  send_followup: {
    title: 'Relancer un prospect par email (DEMO, validation requise)',
    departmentId: 'sales',
    toolId: 'email',
    action: 'send_email',
    description:
      "Envoi externe : la plateforme suspend l'action jusqu'à la décision d'un humain habilité (email simulé).",
    input: { ticketRef: 'demo-lead-042-relance' },
  },
  propose_hire: {
    title: 'Proposer un nouvel agent Support (DEMO)',
    departmentId: 'rh',
    toolId: 'platform',
    action: 'propose_agent',
    description:
      "Les RH proposent un agent ; seul un admin peut l'approuver. L'agent apparaît ensuite à l'accueil.",
    input: {
      departmentId: 'operations',
      title: 'Support',
      justification: 'File de tickets en hausse (données démo)',
    },
  },
  pricing_review: {
    title: 'Revue de remise client (réunion, DEMO)',
    departmentId: 'finance',
    toolId: 'platform',
    action: 'convene_meeting',
    description:
      'Réunion Finance + Sales en salle de réunion ; décisions structurées et délégation de la préparation de l’offre.',
    input: { topic: 'Remise de 12 % pour Acme Démo', participants: 'sales-manager,billing-01' },
  },
  prepare_offer: {
    title: 'Préparer une offre (DEMO)',
    departmentId: 'sales',
    toolId: 'docs',
    action: 'draft_doc',
    description: 'Brouillon d’offre interne (aucun envoi).',
    input: { topic: 'offre-acme-demo' },
  },
};

export interface ToolActionSpec {
  action: string;
  kind: ToolActionKind;
  risk: ToolRisk;
  label: string;
  /** Paramètre principal attendu par l'action, exposé au modèle. */
  input: { field: string; description: string };
  /** Paramètres supplémentaires (tous requis). */
  moreInputs?: { field: string; description: string }[];
}
export interface ToolCatalogEntry {
  id: string;
  name: string;
  code: string; // glyphe court affiché (icône originale, sans logo tiers)
  category: string;
  color: string;
  actions: ToolActionSpec[];
  /**
   * Où l'outil existe : `demo` = données fictives (organisation de démonstration uniquement) ;
   * `live` = outil réel (organisations live). Défaut : `demo`.
   */
  availability?: 'demo' | 'live';
  /** Exécuté par Anthropic côté serveur (recherche web…), pas par la passerelle d'outils. */
  serverSide?: boolean;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: 'crm',
    name: 'CRM',
    code: 'CRM',
    category: 'données',
    color: '#ea966c',
    actions: [
      {
        action: 'lookup_lead',
        kind: 'read',
        risk: 'read',
        label: 'Lire un prospect',
        input: {
          field: 'leadRef',
          description: 'Référence du prospect dans le CRM (ex. demo-lead-042)',
        },
      },
      {
        action: 'add_note',
        kind: 'write',
        risk: 'internal_write',
        label: 'Ajouter une note',
        input: { field: 'leadRef', description: 'Référence du prospect' },
      },
    ],
  },
  {
    id: 'email',
    name: 'Email (simulé)',
    code: 'MAIL',
    category: 'communication',
    color: '#88badc',
    actions: [
      {
        action: 'draft_email',
        kind: 'draft',
        risk: 'internal_write',
        label: 'Brouillon',
        input: { field: 'ticketRef', description: 'Référence du ticket ou du fil à traiter' },
      },
      {
        action: 'send_email',
        kind: 'send',
        risk: 'external_write',
        label: 'Envoyer',
        input: { field: 'ticketRef', description: 'Référence du ticket ou du fil à traiter' },
      },
    ],
  },
  {
    id: 'drive',
    name: 'Fichiers',
    code: 'DRV',
    category: 'documents',
    color: '#76c69a',
    actions: [
      {
        action: 'read_file',
        kind: 'read',
        risk: 'read',
        label: 'Lire un fichier',
        input: { field: 'fileRef', description: 'Référence du fichier' },
      },
    ],
  },
  {
    id: 'search',
    name: 'Recherche web (fixtures)',
    code: 'WEB',
    category: 'web',
    color: '#9c84de',
    actions: [
      {
        action: 'search',
        kind: 'search',
        risk: 'read',
        label: 'Rechercher',
        input: { field: 'query', description: 'Requête de recherche (fixtures locales)' },
      },
    ],
  },
  {
    id: 'erp',
    name: 'ERP / Facturation',
    code: 'ERP',
    category: 'finance',
    color: '#e7c16a',
    actions: [
      {
        action: 'fetch_invoice',
        kind: 'read',
        risk: 'read',
        label: 'Lire une facture',
        input: { field: 'invoiceRef', description: 'Référence de la facture' },
      },
      {
        action: 'issue_invoice',
        kind: 'execute',
        risk: 'high_impact',
        label: 'Émettre',
        input: { field: 'invoiceRef', description: 'Référence de la facture' },
      },
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    code: 'ANA',
    category: 'données',
    color: '#5aa5c9',
    actions: [
      {
        action: 'query_metrics',
        kind: 'read',
        risk: 'read',
        label: 'Lire des métriques',
        input: { field: 'metric', description: 'Identifiant de la métrique' },
      },
    ],
  },
  {
    id: 'ats',
    name: 'ATS (recrutement)',
    code: 'ATS',
    category: 'coordination',
    color: '#e8a5c0',
    actions: [
      {
        action: 'list_candidates',
        kind: 'read',
        risk: 'read',
        label: 'Lister candidats',
        input: { field: 'jobRef', description: 'Référence du poste' },
      },
    ],
  },
  {
    id: 'docs',
    name: 'Documents',
    code: 'DOC',
    category: 'documents',
    color: '#b59cf0',
    actions: [
      {
        action: 'draft_doc',
        kind: 'draft',
        risk: 'internal_write',
        label: 'Rédiger',
        input: { field: 'topic', description: 'Sujet du document' },
      },
    ],
  },
];

TOOL_CATALOG.push({
  id: 'platform',
  name: 'Plateforme (actions internes)',
  code: 'HQ',
  category: 'coordination',
  color: '#7c60c9',
  actions: [
    {
      action: 'propose_agent',
      kind: 'write',
      risk: 'internal_write',
      label: 'Proposer un agent (approbation admin)',
      input: { field: 'departmentId', description: 'Département cible (ex. operations)' },
      moreInputs: [
        { field: 'title', description: 'Intitulé du poste' },
        { field: 'justification', description: 'Besoin opérationnel observé' },
      ],
    },
    {
      action: 'convene_meeting',
      kind: 'execute',
      risk: 'internal_write',
      label: 'Réunir des agents',
      input: { field: 'topic', description: 'Sujet de la réunion' },
      moreInputs: [
        {
          field: 'participants',
          description: 'Identifiants des participants, séparés par des virgules',
        },
      ],
    },
    {
      action: 'delegate_task',
      kind: 'write',
      risk: 'internal_write',
      label: 'Déléguer une tâche',
      input: { field: 'kind', description: 'Type de tâche du catalogue' },
      moreInputs: [{ field: 'assigneeAgentId', description: 'Agent destinataire' }],
    },
  ],
});

/** Outils RÉELS (aucune donnée fictive) proposés aux organisations live. */
TOOL_CATALOG.push(
  {
    id: 'web',
    name: 'Web (réel)',
    code: 'NET',
    category: 'recherche',
    color: '#3b7dd8',
    availability: 'live',
    serverSide: true,
    actions: [
      {
        action: 'search',
        kind: 'search',
        risk: 'read',
        label: 'Rechercher sur Internet (0,01 $ par recherche)',
        input: { field: 'query', description: 'Requête de recherche' },
      },
      {
        action: 'fetch',
        kind: 'read',
        risk: 'read',
        label: 'Lire une page web citée dans la mission ou trouvée par une recherche',
        input: { field: 'url', description: 'Adresse de la page' },
      },
    ],
  },
  {
    id: 'company',
    name: 'Entreprise (cockpit)',
    code: 'HQS',
    category: 'pilotage',
    color: '#7c60c9',
    availability: 'live',
    actions: [
      {
        action: 'status',
        kind: 'read',
        risk: 'read',
        label: 'Lire l’état réel de l’entreprise (agents, missions, blocages, coûts)',
        input: {
          field: 'focus',
          description: 'Périmètre : « tout », ou un nom de département ou d’agent pour restreindre',
        },
      },
    ],
  },
  {
    id: 'library',
    name: 'Bibliothèque',
    code: 'LIB',
    category: 'documents',
    color: '#2b9471',
    availability: 'live',
    actions: [
      {
        action: 'save_document',
        kind: 'write',
        risk: 'internal_write',
        label: 'Enregistrer un document (rapport, note…) consultable dans le cockpit',
        input: { field: 'title', description: 'Titre du document' },
        moreInputs: [{ field: 'content', description: 'Contenu complet du document, en Markdown' }],
      },
      {
        action: 'list_documents',
        kind: 'read',
        risk: 'read',
        label: 'Lister les documents de l’entreprise',
        input: { field: 'query', description: 'Mot-clé à chercher dans les titres, ou « tout »' },
      },
      {
        action: 'read_document',
        kind: 'read',
        risk: 'read',
        label: 'Lire un document de la bibliothèque',
        input: { field: 'documentId', description: 'Identifiant du document' },
      },
    ],
  },
);

/**
 * Équipe (organisations live, managers seulement) : un manager pilote SES subordonnés directs.
 * Recruter = proposition soumise à un administrateur humain (rien n'est créé avant décision) ;
 * droits demandés ⊆ droits du manager, jamais l'outil Équipe lui-même.
 */
export const TEAM_TOOL_ID = 'team';
TOOL_CATALOG.push({
  id: TEAM_TOOL_ID,
  name: 'Équipe (managers)',
  code: 'EQP',
  category: 'coordination',
  color: '#c9a227',
  availability: 'live',
  actions: [
    {
      action: 'list',
      kind: 'read',
      risk: 'read',
      label: 'Voir son équipe et ses résultats',
      input: { field: 'focus', description: '« tout » ou un identifiant de subordonné' },
    },
    {
      action: 'assign',
      kind: 'write',
      risk: 'internal_write',
      label: 'Confier une mission à un subordonné direct',
      input: { field: 'assigneeAgentId', description: 'Identifiant d’un subordonné direct' },
      moreInputs: [
        { field: 'title', description: 'Titre court de la mission' },
        { field: 'instructions', description: 'Consignes précises et résultat attendu' },
      ],
    },
    {
      action: 'wait',
      kind: 'read',
      risk: 'read',
      label: 'Attendre les résultats des missions confiées, puis les recevoir',
      input: {
        field: 'taskIds',
        description:
          '« toutes » (missions confiées pendant CETTE mission) ou identifiants séparés par des virgules',
      },
    },
    {
      action: 'recruit',
      kind: 'write',
      risk: 'internal_write',
      label: 'Proposer un subordonné (validation admin obligatoire)',
      input: { field: 'name', description: 'Prénom du nouvel agent' },
      moreInputs: [
        { field: 'title', description: 'Intitulé du poste' },
        { field: 'goal', description: 'Son job : objectif permanent en une phrase' },
        { field: 'instructions', description: 'Consignes de travail (ton, règles, livrables)' },
        {
          field: 'tools',
          description:
            'Outils demandés, séparés par des virgules, au format outil.action (parmi VOS outils)',
        },
        { field: 'justification', description: 'Pourquoi ce recrutement est nécessaire' },
      ],
    },
  ],
});

/** L'outil existe-t-il pour ce mode d'organisation ? */
export const toolAvailableIn = (
  t: Pick<ToolCatalogEntry, 'availability'>,
  mode: 'demo' | 'live',
  allowDemoTools = false,
): boolean => {
  const where = t.availability ?? 'demo';
  if (mode === 'demo') return where === 'demo';
  return where === 'live' || allowDemoTools;
};

export const toolById = (id: string): ToolCatalogEntry | undefined =>
  TOOL_CATALOG.find((t) => t.id === id);
export const toolAction = (toolId: string, action: string): ToolActionSpec | undefined =>
  toolById(toolId)?.actions.find((a) => a.action === action);
