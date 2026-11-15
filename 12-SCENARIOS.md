# 12 — Parcours de démonstration, exigences métier et exemples de flux

## Scénario A — Qualification d'un prospect (DEMO)
**Préconditions :** agent `Nora / Sales`, outil `CRM`, seed demo, aucun effet externe.

1. Depuis cockpit, admin clique « Nouvelle tâche » > `Qualifier un prospect (DEMO)`.
2. Backend crée `task.created`, `task.started` avec correlationId, écrit dans outbox.
3. UI met à jour compteur et déplace Nora vers son bureau Sales (pas téléportation brutale sauf reduced-motion).
4. `AgentRun` démo commence ; un adaptateur `CRM demo.lookup_lead` est invoqué via `ToolGateway` avec validation Zod.
5. `tool.invocation.started` crée ligne du mur : icône CRM · Nora · lookup_lead · durée en direct. Si overlay activé, lien animé agent→CRM.
6. Outil renvoie fixture « Prospect qualifié, secteur SaaS, demande de démo ». `tool.invocation.succeeded` ferme la ligne et affiche résultat résumé. Le `task.completed` met l'agent idle, produit timeline et KPI.
7. Inspecteur montre tâche, run, invocation, résultat redacted, provenance DEMO, coût `$0.00` pour appel IA si aucun LLM utilisé.
8. Refresh et reconnexion : mêmes objets et statuts, aucun outil exécuté à nouveau. Replay : visualisation sans appel outil.

**Assertions :** un event par transition logique ; `seq` croissant ; correlationId commun ; outil actif pendant durée de l'invocation ; aucune requête internet.

## Scénario B — Manager sollicite Finance (LIVE ou DEMO)
**Préconditions :** manager Sales, agent finance, permissions valides.

1. Sales demande un prix personnalisé ; manager reçoit `pricing_review`.
2. Agent Finance lit conditions autorisées via outil de lecture, prépare montant calculé par moteur déterministe et son explication.
3. Un `meeting.proposed` puis `meeting.started` si coordination explicite requise. Les avatars se réunissent dans la salle.
4. Fin : `meeting.completed` avec décision « préparer offre », tâche fille assignée et trace.
5. Si remise dépasse politique, `approval.requested` puis pause ; admin approuve/rejette ; résultat explicite.

**Assertions :** manager ne donne pas de droit financier supplémentaire ; aucune offre externe n'est envoyée automatiquement sans permission.

## Scénario C — RH recommande une capacité supplémentaire
**Préconditions :** 2 agents ops saturés, RH activée, admin connecté.

1. Le système calcule un KPI de file en hausse (donnée mesurée ou demo étiquetée).
2. RH crée proposition pour `Support-02` avec objectif, outils, budget, manager et avatar.
3. Inspecteur RH et notification approbation affichent la proposition ; l'admin inspecte les droits.
4. Approbation admin : agent créé en `draft`, grants explicites, activation.
5. `agent.created` / `agent.activated` : un nouveau personnage apparaît à l'entrée et marche jusqu'à un poste Ops libre ; badge `2/3` devient `3/3`.
6. L'historique RH/manager conserve origine de création et approbateur.

**Assertions :** pas de clone avant admin ; refus conserve l'historique mais ne crée pas d'agent actif ; nouvelle session restaure l'agent sans seconde animation d'arrivée.

## Scénario D — Erreur outils et gestion du risque
1. Adapter Finance ERP retourne un timeout, puis échec après politique retry.
2. `tool.invocation.failed` et `task.blocked`, avatar badge warning, mur des outils en erreur, alerte timeline.
3. Operator inspecte : action, tentatives, résumé erreur, IDs de trace ; ne voit pas credential ni contenu financier non autorisé.
4. Admin suspend agent ou relance de manière idempotente, avec justification.

**Assertions :** aucune fausse tâche terminée ; aucune répétition d'un side effect irréversible.

## Scénario E — Multi-outils simultanés sur un seul PC
1. Marketing utilise Documents, Sales utilise CRM, RH utilise ATS, Finance utilise ERP : 4 invocations concurrentes persistées.
2. Sur carte, avatars réellement associés à ces tâches ; panneau droit affiche les 4 lignes actifs triées par incident/durée.
3. Filtre Finance : surbrillance agent Finance et ERP, les autres restent visibles atténués ou regroupés.
4. Sélection Sales -> overlay anime seulement Sales→CRM ; click CRM -> trace détaillée.
5. Deux invocations échouent : tool wall signale erreurs et timeline ; KPI incidents exacts.

**Assertions :** pas de débordement à 1440×900 ; tous les outils restent identifiables ; événements respectent la source serveur.

## Scénario F — Retour d'une coupure navigateur
1. Un utilisateur quitte la page pendant un workflow.
2. Le worker continue le travail (sans dépendre du navigateur).
3. Le serveur persiste trois événements pendant la déconnexion.
4. L'utilisateur revient ; charge snapshot+lastSeq ; rejoue uniquement les événements manquants si nécessaire.
5. La timeline reflète le workflow terminé ; pas de seconde publication/email, pas de duplication d'avatar ni de coût.

**Assertions :** preuve via DB/API, pas seule capture d'écran.

## Scénario G — Replay historique
1. L'utilisateur choisit hier, 15h30, active Replay.
2. La carte représente les avatars à l'état historique, KPI sur cette période, tool wall « historique » et parcours outil.
3. Play 2× : mouvements/échanges historiques accélérés ; clic inspecteur en lecture seule.
4. En sortie, refetch live ; aucune requête LLM / outil n'a été lancée durant replay.

**Assertions :** `REPLAY` visible ; tool usage historique non présenté comme actif en temps réel.
