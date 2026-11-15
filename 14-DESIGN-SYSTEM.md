# 14 — Design system, ergonomie et spécification composants UI

## 1. Langage visuel
**Univers monde :** pixel art isométrique « chaleureux et premium » ; fond lavande clair, dégradés discrets, ombres douces ; cloisons épaisses et sols pastel par service. Personnages contrastés, silhouettes reconnaissables. **Univers panneaux :** UI desktop moderne et sobre, verre translucide utilisé très parcimonieusement, cartes petites, espaces réguliers, typographie nette ; éviter que la sophistication décorative rende le cockpit illisible.

Référence palette **indicative**, Claude peut affiner après screenshots :
```css
:root {
  --canvas-sky: #d6bde9;
  --canvas-cloud: #f1d8ee;
  --surface: #fcfbff;
  --surface-muted: #f4f0f9;
  --ink: #222035;
  --ink-soft: #625d74;
  --outline: #ddd3e9;
  --accent: #7c60c9;
  --finance: #76c69a;
  --hr: #e8a5c0;
  --sales: #ea966c;
  --marketing: #9c84de;
  --operations: #88badc;
  --leadership: #e7c16a;
  --danger: #ce4b61;
  --warning: #d49c30;
  --success: #2b9471;
}
```
Ne pas utiliser uniquement la couleur pour état ; associer icône + texte. La palette des salles ne doit pas être confondue avec succès/échec.

## 2. Composants React nécessaires
`CockpitShell`, `KpiBar`, `ModeBanner`, `WorldViewport`, `DepartmentLabel`, `ToolActivityWall`, `ToolActivityRow`, `InspectorDrawer`, `AgentInspector`, `TaskInspector`, `ToolInspector`, `MeetingInspector`, `ApprovalInbox`, `Timeline`, `TimelineEvent`, `WorkflowMiniGraph`, `AlertCenter`, `GlobalSearch`, `Toolbar`, `WorldFilters`, `ReplayControls`, `ConfirmRiskActionModal`, `ConnectionHealthBadge`, `CostChip`, `ErrorBoundary`, `EmptyState`, `LoadingSkeleton`, `Toast`.

Tous les contrôles sont reliés à une action autorisée ou à une projection de données ; éviter les faux boutons.

## 3. Bandeau global
Logo temporaire original « Living HQ », sélecteur organisation (plus tard), badge DEMO/LIVE, mini KPIs avec label et unités, champ recherche, boutons `New Task` / `New Agent`, liste alertes, avatar admin. Le badge DEMO doit rester visible même si le monde est magnifique ; l'opérateur doit savoir immédiatement si c'est réel.

## 4. Tool Wall — cellules d'activité
Une ligne d'utilisation d'outil comporte :
```text
[ICON] CRM                         [EN COURS]
       Nora · Lookup prospect       00:07
       Task #284 · read · demo     [inspecter]
```
En état d'échec : rouge/label **ÉCHEC**, error code bref, bouton trace. En état d'approbation : amber/label **VALIDATION**, bouton lire la demande. Éviter de remplacer le nom de tâche par « working » générique.

Deux onglets visuels *dans le panneau* (sans quitter l'écran) : `Actifs` et `Récents`. `Actifs` prioritaire et visible par défaut. Liste scrollable, compteur et sélection cliquable.

## 5. Inspector agent
Header avatar + identité + service + manager, badge état, provenance et timestamp ; section « Travail actuel » ; section « Outils actifs » ; section « Dernières actions » ; section « Coûts » ; actions contextualisées. Pour `viewer`, boutons mutateurs absents/désactivés. Un clic sur référence déclenche navigation vers tâche/invocation corrélée **dans le même panneau**.

## 6. Système d'alertes
Le cockpit doit mettre en avant seulement le **signal** : les alertes critiques peuvent interrompre le flux visuel avec bandeau, mais le bruit des actions normales reste dans timeline. Les alertes d'approbation ne doivent pas se cacher derrière le jeu ; badge dans header et boîte d'action au panneau droit.

## 7. Micro-interactions
- Avatar hover : nom, rôle, tâche, outil actif, 1 ligne max pour chaque champ.
- Avatar click : halo, panneau inspecteur, légère caméra focus si souhaité.
- Outil démarré : icône apparaissant sur avatar **et** ligne du mur ; une animation pulse maximum, pas de clignotement agressif.
- Réunion : avatars marchent vers sièges, bulle courte de sujet, panneau « réunion » au clic.
- Nouveau agent : animation d'arrivée 1 à 2 secondes, toast et augmentation compteur ; événement `agent.created` unique.
- Tool fail : icône erreur, lien inspecteur, et focus optionnel si incident critique.
- Reconnexion : indicateur discret de synchro, puis état cohérent ; ne pas rejouer tous les spawns de la journée.

## 8. Typographie et densité
Web panels : 12-14px labels, 14-16px textes principaux, KPI 20-26px. Carte : labels département lisibles sans zoom extrême, texte avatar limité à l'interaction pour ne pas saturer. Utiliser `rem` dans React ; sprite text BitmapFont ou DOM overlay selon tests réels, mais veiller à aligner overlay DOM et transformations caméra.

## 9. Responsive et réduction mouvement
Desktop : priorité. En dessous de 1200px, tool wall reste accessible via volet et KPI condensés ; mobile lecture seule facultative, pas de reproduction exacte sur 375px. `prefers-reduced-motion` : téléportation douce/sauts sans trajet et sans pulse ; les **états métier** et timeline restent identiques.

## 10. Checklist design après première implémentation
- Capture 1440×900 : carte donne visuellement une impression de vrai bureau isométrique habité, pas de rectangles plats.
- Capture 1920×1080 : exploite espace supplémentaire, pas 35 % de vide.
- Inspecteur ouvert : carte encore majoritaire et outil wall accessible.
- 12 agents : avatars distincts et non empilés, labels room lisibles.
- 5 invocations simultanées : tool wall compréhensible sans scroll horizontal.
- Erreur + approval : visibilité immédiate, pas seulement une couleur.
- Replay : badge visible, aucune confusion avec activité live.
