/**
 * Libellés français des droits (actions d'outils). Les outils intégrés ont déjà un libellé français ;
 * les connecteurs (serveurs MCP) exposent des noms techniques anglais (`create_branch`,
 * `add_comment_to_pending_review`…) : ils sont traduits par règles (verbe + objet), le nom technique
 * restant affiché en petit pour référence.
 */

type Noun = [singular: string, gender: 'm' | 'f', plural: string];

const VERBS: Record<string, string> = {
  get: 'Lire',
  read: 'Lire',
  list: 'Lister',
  search: 'Rechercher',
  find: 'Trouver',
  fetch: 'Récupérer',
  query: 'Interroger',
  check: 'Vérifier',
  download: 'Télécharger',
  view: 'Voir',
  describe: 'Décrire',
  create: 'Créer',
  new: 'Créer',
  add: 'Ajouter',
  update: 'Modifier',
  edit: 'Modifier',
  modify: 'Modifier',
  patch: 'Modifier',
  set: 'Définir',
  delete: 'Supprimer',
  remove: 'Retirer',
  merge: 'Fusionner',
  fork: 'Dupliquer (fork)',
  push: 'Envoyer (push)',
  send: 'Envoyer',
  post: 'Publier',
  publish: 'Publier',
  reply: 'Répondre à',
  comment: 'Commenter',
  upload: 'Téléverser',
  move: 'Déplacer',
  copy: 'Copier',
  rename: 'Renommer',
  assign: 'Assigner',
  close: 'Fermer',
  reopen: 'Rouvrir',
  open: 'Ouvrir',
  run: 'Lancer',
  trigger: 'Déclencher',
  execute: 'Exécuter',
  invoke: 'Lancer',
  call: 'Appeler',
  cancel: 'Annuler',
  approve: 'Approuver',
  request: 'Demander',
  submit: 'Soumettre',
  archive: 'Archiver',
  unarchive: 'Désarchiver',
  share: 'Partager',
  star: 'Mettre en favori',
  enable: 'Activer',
  disable: 'Désactiver',
  mark: 'Marquer',
  invite: 'Inviter',
  schedule: 'Planifier',
  draft: 'Préparer un brouillon de',
  write: 'Modifier',
  put: 'Écrire',
  append: 'Ajouter à',
  insert: 'Insérer',
  resolve: 'Résoudre',
  unresolve: 'Rouvrir',
  watch: 'Suivre',
  subscribe: 'S’abonner à',
  unsubscribe: 'Se désabonner de',
  label: 'Étiqueter',
  tag: 'Étiqueter',
  sync: 'Synchroniser',
  import: 'Importer',
  export: 'Exporter',
  generate: 'Générer',
  analyze: 'Analyser',
  summarize: 'Résumer',
  convert: 'Convertir',
  lock: 'Verrouiller',
  unlock: 'Déverrouiller',
  pin: 'Épingler',
  react: 'Réagir à',
  rerun: 'Relancer',
  retry: 'Relancer',
  dismiss: 'Écarter',
  manage: 'Gérer',
};

/** Verbes de consultation (aucun changement) : classés dans « Consulter ». */
const READ_VERBS = new Set([
  'get',
  'read',
  'list',
  'search',
  'find',
  'fetch',
  'query',
  'check',
  'download',
  'view',
  'describe',
]);

const NOUNS: Record<string, Noun> = {
  issue: ['ticket (issue)', 'm', 'tickets (issues)'],
  pull_request: ['demande de fusion (pull request)', 'f', 'demandes de fusion (pull requests)'],
  pr: ['demande de fusion (pull request)', 'f', 'demandes de fusion'],
  pending_review: ['revue en attente', 'f', 'revues en attente'],
  review: ['revue', 'f', 'revues'],
  review_comment: ['commentaire de revue', 'm', 'commentaires de revue'],
  comment: ['commentaire', 'm', 'commentaires'],
  file_contents: ['le contenu d’un fichier', 'm', 'le contenu de fichiers'],
  file_content: ['le contenu d’un fichier', 'm', 'le contenu de fichiers'],
  file: ['fichier', 'm', 'fichiers'],
  branch: ['branche', 'f', 'branches'],
  repository: ['dépôt', 'm', 'dépôts'],
  repo: ['dépôt', 'm', 'dépôts'],
  commit: ['commit', 'm', 'commits'],
  release: ['version publiée', 'f', 'versions publiées'],
  tag: ['étiquette de version', 'f', 'étiquettes de version'],
  label: ['étiquette', 'f', 'étiquettes'],
  workflow: ['workflow', 'm', 'workflows'],
  workflow_run: ['exécution de workflow', 'f', 'exécutions de workflow'],
  job: ['tâche automatisée', 'f', 'tâches automatisées'],
  job_logs: ['journal de tâche automatisée', 'm', 'journaux de tâches automatisées'],
  secret_scanning: ['analyse de secrets exposés', 'f', 'analyses de secrets exposés'],
  actions: ['action GitHub', 'f', 'actions GitHub'],
  reply: ['réponse', 'f', 'réponses'],
  secret_scanning_alert: ['alerte de secret exposé', 'f', 'alertes de secrets exposés'],
  code_scanning_alert: ['alerte de sécurité du code', 'f', 'alertes de sécurité du code'],
  alert: ['alerte', 'f', 'alertes'],
  notification: ['notification', 'f', 'notifications'],
  code: ['du code', 'm', 'du code'],
  me: ['mon profil', 'm', 'mon profil'],
  user: ['utilisateur', 'm', 'utilisateurs'],
  team: ['équipe', 'f', 'équipes'],
  member: ['membre', 'm', 'membres'],
  page: ['page', 'f', 'pages'],
  database: ['base de données', 'f', 'bases de données'],
  block: ['bloc', 'm', 'blocs'],
  message: ['message', 'm', 'messages'],
  channel: ['canal', 'm', 'canaux'],
  thread: ['fil de discussion', 'm', 'fils de discussion'],
  email: ['email', 'm', 'emails'],
  mail: ['email', 'm', 'emails'],
  draft: ['brouillon', 'm', 'brouillons'],
  event: ['événement', 'm', 'événements'],
  calendar: ['agenda', 'm', 'agendas'],
  document: ['document', 'm', 'documents'],
  doc: ['document', 'm', 'documents'],
  folder: ['dossier', 'm', 'dossiers'],
  drive: ['espace de fichiers', 'm', 'espaces de fichiers'],
  spreadsheet: ['feuille de calcul', 'f', 'feuilles de calcul'],
  sheet: ['feuille', 'f', 'feuilles'],
  row: ['ligne', 'f', 'lignes'],
  cell: ['cellule', 'f', 'cellules'],
  contact: ['contact', 'm', 'contacts'],
  deal: ['affaire', 'f', 'affaires'],
  lead: ['prospect', 'm', 'prospects'],
  company: ['entreprise', 'f', 'entreprises'],
  invoice: ['facture', 'f', 'factures'],
  customer: ['client', 'm', 'clients'],
  payment: ['paiement', 'm', 'paiements'],
  product: ['produit', 'm', 'produits'],
  order: ['commande', 'f', 'commandes'],
  task: ['tâche', 'f', 'tâches'],
  project: ['projet', 'm', 'projets'],
  note: ['note', 'f', 'notes'],
  post: ['publication', 'f', 'publications'],
  record: ['enregistrement', 'm', 'enregistrements'],
  table: ['table', 'f', 'tables'],
  view: ['vue', 'f', 'vues'],
  status: ['statut', 'm', 'statuts'],
  url: ['adresse web', 'f', 'adresses web'],
  link: ['lien', 'm', 'liens'],
  image: ['image', 'f', 'images'],
  attachment: ['pièce jointe', 'f', 'pièces jointes'],
  reaction: ['réaction', 'f', 'réactions'],
  discussion: ['discussion', 'f', 'discussions'],
  gist: ['extrait de code (gist)', 'm', 'extraits de code (gists)'],
  sub_issue: ['sous-ticket', 'm', 'sous-tickets'],
  milestone: ['jalon', 'm', 'jalons'],
  collaborator: ['collaborateur', 'm', 'collaborateurs'],
  organization: ['organisation', 'f', 'organisations'],
  org: ['organisation', 'f', 'organisations'],
  webhook: ['webhook', 'm', 'webhooks'],
  key: ['clé', 'f', 'clés'],
  secret: ['secret', 'm', 'secrets'],
  copilot: ['Copilot', 'm', 'Copilot'],
  auto_merge: ['fusion automatique', 'f', 'fusions automatiques'],
  pr_auto_merge: ['fusion automatique', 'f', 'fusions automatiques'],
};

const LINKS: Record<string, string> = {
  to: 'à',
  for: 'pour',
  from: 'depuis',
  in: 'dans',
  on: 'sur',
  by: 'par',
  and: 'et',
  with: 'avec',
  of: 'de',
  into: 'dans',
  as: 'comme',
  all: 'tous les',
};

const PLURAL_HINT = new Set(['list', 'search', 'find', 'query']);

function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Groupe de mots → nom connu (le plus long d'abord), au singulier ou au pluriel. */
function matchNoun(ws: string[], i: number): { noun: Noun; plural: boolean; len: number } | null {
  for (let len = Math.min(4, ws.length - i); len >= 1; len--) {
    const key = ws.slice(i, i + len).join('_');
    const n = NOUNS[key];
    if (n) return { noun: n, plural: false, len };
    if (key.endsWith('s')) {
      for (const sing of [
        key.endsWith('ies') ? `${key.slice(0, -3)}y` : '',
        key.endsWith('es') ? key.slice(0, -2) : '',
        key.slice(0, -1),
      ]) {
        const p = sing ? NOUNS[sing] : undefined;
        if (p) return { noun: p, plural: true, len };
      }
    }
  }
  return null;
}

const FIXED = /^(le|la|du|mon) /;
const article = (n: Noun, plural: boolean, afterLink: boolean): string =>
  plural ? (afterLink ? 'des' : 'les') : n[1] === 'f' ? 'une' : 'un';

/** Traduction d'un nom technique d'action (ex. `add_comment_to_pending_review`). */
export function translateActionName(name: string): string {
  let ws = tokens(name);
  if (ws.length === 0) return name;
  // Verbe en fin de nom (« issue_read », « actions_list ») : remis en tête.
  if (!VERBS[ws[0]!] && ws.length > 1 && VERBS[ws[ws.length - 1]!])
    ws = [ws[ws.length - 1]!, ...ws.slice(0, -1)];
  const verbKey = VERBS[ws[0]!] ? ws[0]! : '';
  const verbs: string[] = [];
  let i = 0;
  if (verbKey) {
    verbs.push(VERBS[verbKey]!);
    i = 1;
    // « create_or_update » : plusieurs verbes.
    while ((ws[i] === 'or' || ws[i] === 'and') && VERBS[ws[i + 1] ?? '']) {
      verbs.push(ws[i] === 'or' ? 'ou' : 'et', VERBS[ws[i + 1]!]!.toLowerCase());
      i += 2;
    }
  }
  const out: string[] = [];
  let afterLink = false;
  let firstNoun = true;
  while (i < ws.length) {
    const link = LINKS[ws[i]!];
    if (link) {
      out.push(link);
      afterLink = true;
      i++;
      continue;
    }
    // Suite de noms anglais (« issue comment ») : le dernier est le nom principal,
    // les précédents deviennent des compléments (« un commentaire de ticket »).
    const run: { noun: Noun; plural: boolean }[] = [];
    let m = matchNoun(ws, i);
    while (m) {
      run.push({ noun: m.noun, plural: m.plural });
      i += m.len;
      m = i < ws.length && !LINKS[ws[i]!] ? matchNoun(ws, i) : null;
    }
    if (run.length > 0) {
      const head = run[run.length - 1]!;
      const plural = head.plural || (firstNoun && PLURAL_HINT.has(verbKey));
      const word = plural ? head.noun[2] : head.noun[0];
      let phrase = FIXED.test(word) ? word : `${article(head.noun, plural, afterLink)} ${word}`;
      for (const mod of run.slice(0, -1).reverse()) {
        const w = (mod.plural ? mod.noun[2] : mod.noun[0]).replace(FIXED, '');
        phrase += ` de ${w}`;
      }
      out.push(phrase);
      firstNoun = false;
      afterLink = false;
      continue;
    }
    out.push(ws[i]!);
    i++;
    afterLink = false;
  }
  const text = [...verbs, ...out]
    .filter(Boolean)
    .join(' ')
    .replace(/\bà les\b/g, 'aux')
    .replace(/\bde le\b/g, 'du')
    .replace(/\bde (un|une) /g, 'd’$1 ')
    .replace(/\bde ([aeéiou])/g, 'd’$1');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** L'action ne fait que consulter (classée dans « Consulter »). */
export function isReadAction(a: { action: string; kind?: string; risk: string }): boolean {
  if (a.risk === 'read') return true;
  const v = tokens(a.action)[0] ?? '';
  return READ_VERBS.has(v);
}

/** Libellé affiché : le libellé français de l'outil intégré, sinon la traduction du nom technique. */
export function actionLabel(a: { action: string; label: string }): string {
  const technical = a.label.trim() === a.action || /^[a-z0-9_]+$/i.test(a.label.trim());
  return technical ? translateActionName(a.action) : a.label;
}

/** Ce que permet chaque outil intégré, en une phrase. */
export const TOOL_PURPOSE: Record<string, string> = {
  company: 'Voir l’état réel de l’entreprise : agents, missions, blocages et coûts.',
  library: 'Produire et relire les documents de l’entreprise (rapports, notes, fiches).',
  web: 'Chercher sur Internet et lire des pages web (chaque recherche coûte environ 0,01 $).',
  team: 'Piloter une équipe : voir ses subordonnés, leur confier des missions, recruter (avec ta validation).',
};
