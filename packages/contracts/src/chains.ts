/**
 * Modèles de missions en chaîne : chaque étape reçoit le résultat de la précédente ; la dernière
 * étape est toujours une validation humaine (jamais publiée sans toi).
 */
export interface ChainStepTemplate {
  title: string;
  instructions: string;
  /** Pôle conseillé pour choisir l'agent de l'étape (simple suggestion). */
  hint: string;
}
export interface ChainTemplate {
  id: string;
  title: string;
  description: string;
  steps: ChainStepTemplate[];
}

export const CHAIN_TEMPLATES: ChainTemplate[] = [
  {
    id: 'content-linkedin',
    title: 'Veille → Article → Post LinkedIn',
    description:
      'Une veille sur le sujet, un article de fond, puis un post LinkedIn prêt à publier.',
    steps: [
      {
        title: 'Veille',
        instructions:
          'Fais une veille sur le sujet : 5 à 8 faits ou tendances récents, sourcés, et ce qu’ils changent pour nous.',
        hint: 'marketing',
      },
      {
        title: 'Article',
        instructions:
          'À partir de la veille, rédige un article de fond (600 à 900 mots) : titre, chapô, intertitres, conclusion actionnable. Enregistre-le dans la bibliothèque.',
        hint: 'marketing',
      },
      {
        title: 'Post LinkedIn',
        instructions:
          'Tire de l’article un post LinkedIn (1 200 caractères max) avec accroche, 3 points clés, appel à l’action et 3 à 5 hashtags. Propose 2 variantes d’accroche. Ne publie rien.',
        hint: 'marketing',
      },
    ],
  },
  {
    id: 'weekly-report',
    title: 'Collecte → Analyse → Rapport',
    description:
      'Les chiffres de la semaine, leur analyse, puis un rapport clair pour la direction.',
    steps: [
      {
        title: 'Collecte',
        instructions:
          'Rassemble les chiffres et faits marquants de la période sur le sujet (outils disponibles, bibliothèque, missions récentes).',
        hint: 'finance',
      },
      {
        title: 'Analyse',
        instructions:
          'Analyse les données collectées : évolutions, causes probables, risques et opportunités. Sépare faits et hypothèses.',
        hint: 'direction',
      },
      {
        title: 'Rapport',
        instructions:
          'Rédige un rapport d’une page pour la direction : synthèse, 3 décisions proposées, prochaines étapes. Enregistre-le dans la bibliothèque.',
        hint: 'direction',
      },
    ],
  },
  {
    id: 'prospect-outreach',
    title: 'Recherche prospect → Message personnalisé',
    description:
      'Un dossier sur le prospect, puis un message d’approche personnalisé (non envoyé).',
    steps: [
      {
        title: 'Recherche',
        instructions:
          'Constitue un dossier sur le prospect : activité, actualité, besoins probables, interlocuteurs. Sources citées.',
        hint: 'sales',
      },
      {
        title: 'Message',
        instructions:
          'Rédige un message d’approche personnalisé (email et variante LinkedIn), court, avec une proposition de valeur précise. Ne l’envoie pas.',
        hint: 'sales',
      },
    ],
  },
];

export const chainTemplate = (id: string): ChainTemplate | undefined =>
  CHAIN_TEMPLATES.find((t) => t.id === id);
