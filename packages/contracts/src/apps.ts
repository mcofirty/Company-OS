/**
 * Catalogue des applications connectables (docs/05 §11). Chaque entrée dit COMMENT la brancher :
 * - `mcp-oauth`  : serveur MCP officiel, bouton « Se connecter avec … » (OAuth, jetons chiffrés) ;
 * - `mcp-token`  : serveur MCP officiel + jeton d'accès que l'humain colle ;
 * - `mcp-url`    : passerelle d'automatisation (Zapier, Make, n8n) : adresse MCP personnelle
 *                  (contient un secret : chiffrée, jamais réaffichée) qui ouvre des milliers d'apps ;
 * - `via`        : application atteinte au travers d'une passerelle (ex. Gmail via Zapier) ;
 * - `builtin`    : outil intégré à la plateforme (Claude, Web, Bibliothèque…).
 * Les adresses sont celles des serveurs publiés par les éditeurs ; l'humain peut toujours saisir
 * une autre adresse (« Autre serveur MCP »).
 */
export type AppCategory =
  | 'ia'
  | 'développement'
  | 'communication'
  | 'productivité'
  | 'ventes & marketing'
  | 'finance'
  | 'automatisation';

export type AppConnect =
  | { kind: 'builtin'; toolId: string }
  | { kind: 'mcp-oauth'; url: string; docs: string }
  | {
      kind: 'mcp-token';
      url: string;
      header: 'authorization' | 'x-api-key';
      tokenLabel: string;
      tokenHelp: string;
      docs: string;
    }
  | { kind: 'mcp-url'; urlLabel: string; urlHelp: string; docs: string; example: string }
  | { kind: 'via'; gateways: ('zapier' | 'make' | 'n8n')[]; hint: string }
  | { kind: 'custom' };

export interface AppPreset {
  id: string;
  name: string;
  category: AppCategory;
  /** Clé d'icône (simple-icons, CC0) ; sinon pastille de couleur avec initiales. */
  icon?: string;
  color: string;
  description: string;
  /** Noms d'outils reconnus (ex. `gmail_send_email`) quand l'app passe par une passerelle. */
  aliases?: string[];
  connect: AppConnect;
}

const via = (
  id: string,
  name: string,
  category: AppCategory,
  color: string,
  description: string,
  aliases: string[],
  icon?: string,
): AppPreset => ({
  id,
  name,
  category,
  color,
  description,
  aliases,
  ...(icon ? { icon } : {}),
  connect: {
    kind: 'via',
    gateways: ['zapier', 'make', 'n8n'],
    hint: `Ajoute les actions ${name} dans ta passerelle (Zapier MCP, Make ou n8n), puis clique « Synchroniser » sur son connecteur : les outils ${name} apparaissent ici.`,
  },
});

export const APP_CATALOG: AppPreset[] = [
  // ---------- Intégrés ----------
  {
    id: 'claude',
    name: 'Claude',
    category: 'ia',
    icon: 'siClaude',
    color: '#D97757',
    description: 'Le cerveau de tes agents (Anthropic). Configuré sur le serveur.',
    connect: { kind: 'builtin', toolId: 'claude' },
  },
  {
    id: 'web',
    name: 'Web',
    category: 'ia',
    color: '#3b7dd8',
    description: 'Recherche et lecture de pages web.',
    connect: { kind: 'builtin', toolId: 'web' },
  },
  {
    id: 'library',
    name: 'Bibliothèque',
    category: 'productivité',
    color: '#2bb3a3',
    description: 'Documents produits par les agents.',
    connect: { kind: 'builtin', toolId: 'library' },
  },
  {
    id: 'company',
    name: 'Entreprise',
    category: 'productivité',
    color: '#7c60c9',
    description: 'État réel de ton entreprise (agents, missions, budgets).',
    connect: { kind: 'builtin', toolId: 'company' },
  },
  {
    id: 'team',
    name: 'Équipe',
    category: 'productivité',
    color: '#c9a227',
    description: 'Pilotage des équipes par les managers.',
    connect: { kind: 'builtin', toolId: 'team' },
  },
  // ---------- Serveurs MCP officiels ----------
  {
    id: 'github',
    name: 'GitHub',
    category: 'développement',
    icon: 'siGithub',
    color: '#181717',
    description: 'Dépôts, issues, pull requests, code.',
    connect: {
      kind: 'mcp-token',
      url: 'https://api.githubcopilot.com/mcp/',
      header: 'authorization',
      tokenLabel: 'Jeton d’accès personnel GitHub',
      tokenHelp:
        'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained : choisis les dépôts et les droits (lecture conseillée au début).',
      docs: 'https://github.com/github/github-mcp-server',
    },
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivité',
    icon: 'siNotion',
    color: '#000000',
    description: 'Pages, bases de données, notes d’équipe.',
    connect: {
      kind: 'mcp-oauth',
      url: 'https://mcp.notion.com/mcp',
      docs: 'https://developers.notion.com/docs/mcp',
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'développement',
    icon: 'siLinear',
    color: '#5E6AD2',
    description: 'Tickets, projets, cycles.',
    connect: {
      kind: 'mcp-oauth',
      url: 'https://mcp.linear.app/mcp',
      docs: 'https://linear.app/docs/mcp',
    },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'développement',
    icon: 'siSentry',
    color: '#362D59',
    description: 'Erreurs et incidents de tes applications.',
    connect: {
      kind: 'mcp-oauth',
      url: 'https://mcp.sentry.dev/mcp',
      docs: 'https://docs.sentry.io/product/sentry-mcp/',
    },
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'finance',
    icon: 'siStripe',
    color: '#635BFF',
    description: 'Paiements, clients, factures, abonnements.',
    connect: {
      kind: 'mcp-token',
      url: 'https://mcp.stripe.com',
      header: 'authorization',
      tokenLabel: 'Clé secrète restreinte Stripe (rk_…)',
      tokenHelp:
        'Stripe → Développeurs → Clés API → « Créer une clé restreinte » : n’accorde que la lecture au début. Les actions sensibles restent soumises à ta validation.',
      docs: 'https://docs.stripe.com/mcp',
    },
  },
  // ---------- Passerelles (des milliers d'applications) ----------
  {
    id: 'zapier',
    name: 'Zapier',
    category: 'automatisation',
    icon: 'siZapier',
    color: '#FF4F00',
    description: 'Passerelle vers 8 000+ apps : Gmail, WhatsApp, LinkedIn, Slack, Google…',
    connect: {
      kind: 'mcp-url',
      urlLabel: 'Adresse de ton serveur Zapier MCP',
      urlHelp:
        'Sur mcp.zapier.com : crée un serveur MCP, ajoute les actions voulues (ex. Gmail « Envoyer un email », WhatsApp, LinkedIn « Publier »), puis copie son adresse (elle contient un secret : elle sera chiffrée).',
      docs: 'https://zapier.com/mcp',
      example: 'https://mcp.zapier.com/api/mcp/s/…/mcp',
    },
  },
  {
    id: 'make',
    name: 'Make',
    category: 'automatisation',
    icon: 'siMake',
    color: '#6D00CC',
    description: 'Passerelle vers 2 000+ apps via tes scénarios Make.',
    connect: {
      kind: 'mcp-url',
      urlLabel: 'Adresse de ton serveur Make MCP',
      urlHelp:
        'Dans Make : Profil → API / jetons MCP, puis copie l’adresse du serveur MCP (elle contient un jeton : elle sera chiffrée).',
      docs: 'https://www.make.com',
      example: 'https://eu2.make.com/mcp/api/v1/u/…/sse',
    },
  },
  {
    id: 'n8n',
    name: 'n8n',
    category: 'automatisation',
    icon: 'siN8n',
    color: '#EA4B71',
    description: 'Tes workflows n8n exposés aux agents (nœud « MCP Server Trigger »).',
    connect: {
      kind: 'mcp-url',
      urlLabel: 'Adresse « Production URL » du nœud MCP Server Trigger',
      urlHelp:
        'Dans n8n : ajoute un nœud « MCP Server Trigger », branche les outils du workflow, active-le et copie sa Production URL.',
      docs: 'https://docs.n8n.io',
      example: 'https://ton-n8n.exemple.fr/mcp/…',
    },
  },
  // ---------- Applications via passerelle ----------
  via(
    'gmail',
    'Gmail',
    'communication',
    '#EA4335',
    'Lire, trier, rédiger et envoyer des emails.',
    ['gmail'],
    'siGmail',
  ),
  via(
    'whatsapp',
    'WhatsApp',
    'communication',
    '#25D366',
    'Envoyer et recevoir des messages WhatsApp.',
    ['whatsapp'],
    'siWhatsapp',
  ),
  via('linkedin', 'LinkedIn', 'ventes & marketing', '#0A66C2', 'Publier, suivre les prospects.', [
    'linkedin',
  ]),
  via('slack', 'Slack', 'communication', '#4A154B', 'Messages et canaux d’équipe.', ['slack']),
  via(
    'gdrive',
    'Google Drive',
    'productivité',
    '#4285F4',
    'Fichiers et dossiers partagés.',
    ['google_drive', 'gdrive', 'drive'],
    'siGoogledrive',
  ),
  via(
    'gcalendar',
    'Google Agenda',
    'productivité',
    '#4285F4',
    'Événements et disponibilités.',
    ['google_calendar', 'gcal', 'calendar'],
    'siGooglecalendar',
  ),
  via(
    'gsheets',
    'Google Sheets',
    'productivité',
    '#34A853',
    'Tableaux et listes.',
    ['google_sheets', 'sheets', 'spreadsheet'],
    'siGooglesheets',
  ),
  via(
    'gdocs',
    'Google Docs',
    'productivité',
    '#4285F4',
    'Documents texte.',
    ['google_docs', 'gdocs'],
    'siGoogledocs',
  ),
  via('canva', 'Canva', 'ventes & marketing', '#00C4CC', 'Visuels et designs.', ['canva']),
  via(
    'hubspot',
    'HubSpot',
    'ventes & marketing',
    '#FF7A59',
    'CRM : contacts, offres, emails.',
    ['hubspot'],
    'siHubspot',
  ),
  via('trello', 'Trello', 'productivité', '#0052CC', 'Tableaux et cartes.', ['trello'], 'siTrello'),
  via('asana', 'Asana', 'productivité', '#F06A6A', 'Projets et tâches.', ['asana'], 'siAsana'),
  via('clickup', 'ClickUp', 'productivité', '#7B68EE', 'Tâches et docs.', ['clickup'], 'siClickup'),
  via(
    'todoist',
    'Todoist',
    'productivité',
    '#E44332',
    'Listes de tâches.',
    ['todoist'],
    'siTodoist',
  ),
  via(
    'airtable',
    'Airtable',
    'productivité',
    '#18BFFF',
    'Bases de données collaboratives.',
    ['airtable'],
    'siAirtable',
  ),
  via(
    'calendly',
    'Calendly',
    'productivité',
    '#006BFF',
    'Prises de rendez-vous.',
    ['calendly'],
    'siCalendly',
  ),
  via(
    'discord',
    'Discord',
    'communication',
    '#5865F2',
    'Serveurs et messages.',
    ['discord'],
    'siDiscord',
  ),
  via(
    'telegram',
    'Telegram',
    'communication',
    '#26A5E4',
    'Messages et canaux.',
    ['telegram'],
    'siTelegram',
  ),
  via('x', 'X (Twitter)', 'ventes & marketing', '#000000', 'Publications.', ['twitter'], 'siX'),
  via(
    'instagram',
    'Instagram',
    'ventes & marketing',
    '#FF0069',
    'Publications et messages.',
    ['instagram'],
    'siInstagram',
  ),
  via(
    'facebook',
    'Facebook',
    'ventes & marketing',
    '#0866FF',
    'Pages et publications.',
    ['facebook'],
    'siFacebook',
  ),
  via(
    'youtube',
    'YouTube',
    'ventes & marketing',
    '#FF0000',
    'Vidéos et chaînes.',
    ['youtube'],
    'siYoutube',
  ),
  via(
    'mailchimp',
    'Mailchimp',
    'ventes & marketing',
    '#FFE01B',
    'Campagnes emailing.',
    ['mailchimp'],
    'siMailchimp',
  ),
  via(
    'brevo',
    'Brevo',
    'ventes & marketing',
    '#0B996E',
    'Emails et SMS marketing.',
    ['brevo', 'sendinblue'],
    'siBrevo',
  ),
  via(
    'shopify',
    'Shopify',
    'ventes & marketing',
    '#7AB55C',
    'Boutique, commandes, produits.',
    ['shopify'],
    'siShopify',
  ),
  via(
    'wordpress',
    'WordPress',
    'ventes & marketing',
    '#21759B',
    'Articles et pages.',
    ['wordpress'],
    'siWordpress',
  ),
  via('paypal', 'PayPal', 'finance', '#003087', 'Paiements.', ['paypal'], 'siPaypal'),
  via('dropbox', 'Dropbox', 'productivité', '#0061FF', 'Fichiers.', ['dropbox'], 'siDropbox'),
  via('figma', 'Figma', 'développement', '#F24E1E', 'Maquettes et designs.', ['figma'], 'siFigma'),
  via('jira', 'Jira', 'développement', '#0052CC', 'Tickets et sprints.', ['jira'], 'siJira'),
  via(
    'gitlab',
    'GitLab',
    'développement',
    '#FC6D26',
    'Dépôts et merge requests.',
    ['gitlab'],
    'siGitlab',
  ),
  via(
    'zendesk',
    'Zendesk',
    'communication',
    '#03363D',
    'Support client.',
    ['zendesk'],
    'siZendesk',
  ),
  via(
    'intercom',
    'Intercom',
    'communication',
    '#6AFDEF',
    'Conversations clients.',
    ['intercom'],
    'siIntercom',
  ),
  via('miro', 'Miro', 'productivité', '#FFD02F', 'Tableaux blancs.', ['miro'], 'siMiro'),
  via('outlook', 'Outlook', 'communication', '#0078D4', 'Emails et calendrier Microsoft.', [
    'outlook',
    'microsoft_outlook',
  ]),
  via('teams', 'Microsoft Teams', 'communication', '#6264A7', 'Messages d’équipe Microsoft.', [
    'teams',
    'microsoft_teams',
  ]),
  // ---------- Libre ----------
  {
    id: 'custom',
    name: 'Autre serveur MCP',
    category: 'automatisation',
    color: '#625d74',
    description: 'N’importe quel serveur MCP (adresse HTTPS + jeton éventuel).',
    connect: { kind: 'custom' },
  },
];

export const appById = (id: string | null | undefined): AppPreset | undefined =>
  id ? APP_CATALOG.find((a) => a.id === id) : undefined;

/** Passerelles qui ouvrent plusieurs applications (outils reconnus par leur nom). */
export const GATEWAY_APPS = ['zapier', 'make', 'n8n'] as const;

/** Application reconnue dans un nom d'outil de passerelle (ex. `gmail_send_email` → gmail). */
export function appOfToolName(name: string): AppPreset | undefined {
  const n = name.toLowerCase();
  return APP_CATALOG.find(
    (a) =>
      a.connect.kind === 'via' &&
      (a.aliases ?? []).some(
        (al) => n.startsWith(al) || n.includes(`_${al}`) || n.includes(`${al}_`),
      ),
  );
}
