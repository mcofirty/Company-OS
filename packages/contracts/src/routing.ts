import { MODEL_TIERS, type ModelChoice, type ModelTier } from './api';

/**
 * Optimisation automatique du modèle selon la mission (ADR-066).
 * Tier 1 (léger) : Haiku ; Tier 2 (moyen) : Sonnet ; Tier 3 (lourd) : Opus.
 * Règles locales, déterministes et gratuites (aucun appel LLM pour décider), expliquées en clair.
 */

export const TIER_NUMBER: Record<ModelTier, 1 | 2 | 3> = { economy: 1, balanced: 2, quality: 3 };
const BY_NUMBER: Record<1 | 2 | 3, ModelTier> = { 1: 'economy', 2: 'balanced', 3: 'quality' };
export const TIER_LABEL: Record<ModelTier, string> = {
  economy: 'Tier 1 · Léger · Haiku',
  balanced: 'Tier 2 · Moyen · Sonnet',
  quality: 'Tier 3 · Lourd · Opus',
};
/** Effort de raisonnement associé à chaque niveau. */
export const TIER_EFFORT: Record<ModelTier, 'low' | 'medium' | 'high'> = {
  economy: 'low',
  balanced: 'medium',
  quality: 'high',
};

export interface MissionContext {
  title: string;
  instructions: string;
  /** Rôle de l'agent : un responsable qui délègue a besoin de plus de raisonnement. */
  role?: 'manager' | 'specialist' | string;
  /** Nombre d'outils accordés à l'agent. */
  toolCount?: number;
  /** Profondeur de délégation (0 = demandée par un humain). */
  depth?: number;
  /** Nouvelle tentative (après échec ou blocage) : on monte d'un niveau. */
  attempt?: number;
  /** Suite d'une mission précédente. */
  followUp?: boolean;
  /** Part restante du budget mensuel de l'agent (0..1), si connue. */
  budgetLeft?: number | null;
  /** Niveau imposé par l'humain pour CETTE mission (prioritaire, sauf garde-fou budget). */
  forced?: ModelTier | null;
}

export interface RoutingDecision {
  tier: ModelTier;
  model: string;
  effort: 'low' | 'medium' | 'high';
  /** Explication courte, affichée dans le cockpit. */
  reason: string;
  score: number;
}

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const HEAVY = [
  'strateg',
  'analyse approfondie',
  'analyse complete',
  'audit',
  'business plan',
  'plan d action',
  'architecture',
  'juridique',
  'contrat',
  'conformite',
  'rgpd',
  'negoci',
  'arbitr',
  'decision',
  'diagnostic',
  'etude de marche',
  'benchmark',
  'compar',
  'modelis',
  'prevision',
  'budget annuel',
  'code',
  'debug',
  'refactor',
  'algorithm',
  'rapport complet',
  'synthese strategique',
  'recrutement',
  'roadmap',
  'feuille de route',
  'investiss',
];
const LIGHT = [
  'resume',
  'resumer',
  'reformul',
  'tradui',
  'corrige',
  'orthograph',
  'classe',
  'trie',
  'liste',
  'statut',
  'verifie',
  'rappel',
  'relance',
  'formate',
  'extrais',
  'mot cle',
  'salutation',
  'remercie',
  'confirme',
];

/** Décide du niveau de modèle pour une mission. Fonction pure, testée. */
export function routeModel(m: MissionContext): RoutingDecision {
  const text = norm(`${m.title}\n${m.instructions}`);
  const why: string[] = [];
  let score = 0;
  const heavy = HEAVY.filter((k) => text.includes(k));
  const light = LIGHT.filter((k) => text.includes(k));
  if (heavy.length) {
    score += Math.min(4, heavy.length * 2);
    why.push(`mission complexe (${heavy.slice(0, 2).join(', ')})`);
  }
  if (light.length && !heavy.length) {
    score -= 2;
    why.push(`tâche simple (${light.slice(0, 2).join(', ')})`);
  }
  const len = m.instructions.length;
  if (len > 1500) {
    score += 2;
    why.push('consignes longues');
  } else if (len > 600) {
    score += 1;
    why.push('consignes détaillées');
  } else if (len < 160) {
    score -= 1;
    why.push('consignes courtes');
  }
  if (m.role === 'manager') {
    score += 1;
    why.push('responsable qui délègue');
  }
  if ((m.toolCount ?? 0) >= 5) {
    score += 1;
    why.push(`${m.toolCount} outils`);
  }
  if ((m.depth ?? 0) >= 2) {
    score -= 1;
    why.push('sous-tâche déléguée');
  }
  if (m.followUp) {
    score += 1;
    why.push('suite d’une mission');
  }
  let n: 1 | 2 | 3 = score >= 3 ? 3 : score <= -2 ? 1 : 2;
  if (m.forced) {
    n = TIER_NUMBER[m.forced];
    why.length = 0;
    why.push('niveau choisi pour cette mission');
  } else if ((m.attempt ?? 1) > 1 && n < 3) {
    n = (n + 1) as 2 | 3;
    why.push('nouvel essai : un cran au-dessus');
  }
  // Garde-fou budget : on économise quand l'enveloppe du mois s'épuise.
  if (m.budgetLeft != null) {
    if (m.budgetLeft < 0.05 && n > 1) {
      n = 1;
      why.push('budget presque épuisé');
    } else if (m.budgetLeft < 0.2 && n > 2) {
      n = 2;
      why.push('budget bas');
    }
  }
  const tier = BY_NUMBER[n];
  return {
    tier,
    model: MODEL_TIERS[tier].model,
    effort: TIER_EFFORT[tier],
    reason: `${TIER_LABEL[tier]} : ${why.length ? why.join(', ') : 'mission standard'}`.slice(
      0,
      200,
    ),
    score,
  };
}

/** Politique modèle stockée sur une version d'agent. */
export interface StoredModelPolicy {
  model?: string;
  effort?: string;
  maxTokens?: number;
  /** Optimisation automatique selon la mission. */
  auto?: boolean;
}
/** Choix affiché pour une version : « auto » ou le niveau du modèle fixé. */
export function choiceOfPolicy(p: StoredModelPolicy | null | undefined): ModelChoice {
  if (p?.auto) return 'auto';
  const t = Object.entries(MODEL_TIERS).find(([, v]) => v.model === p?.model)?.[0];
  return (t as ModelTier | undefined) ?? 'quality';
}
/** Politique à enregistrer pour un choix (en « auto », le modèle sert de valeur par défaut). */
export function policyForChoice(
  choice: ModelChoice,
  base: StoredModelPolicy = {},
): StoredModelPolicy & { model: string; effort: 'low' | 'medium' | 'high'; auto: boolean } {
  if (choice === 'auto')
    return { ...base, model: MODEL_TIERS.balanced.model, effort: 'medium', auto: true };
  return { ...base, model: MODEL_TIERS[choice].model, effort: TIER_EFFORT[choice], auto: false };
}
