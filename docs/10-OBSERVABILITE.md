# 10 — Observabilité, traces, KPIs, coûts et replay

## 1. Objectif
Une entreprise autonome doit être **observable à trois échelles simultanées** : vue globale (KPI), vue d'équipe (département, mission et outils), vue transactionnelle (run, appels LLM/outils, résultat, erreurs). La vision principale est le bureau isométrique, mais les panneaux **fonctionnels** donnent l'explication opérationnelle.

## 2. Tracing
Chaque demande reçoit un `requestId` et un `correlationId`. Une tâche enfant porte un `causationId`. Instrumenter via OpenTelemetry :
- `http.request` (latence, code), `socket.broadcast` (seq, org, clients, refus), `db.query` (santé/latence) ;
- `temporal.workflow` / `temporal.activity` (id, type, tentative, timeout), `agent.run` (id, modèle, tours), `llm.invoke` (provider, modèle, tokens, durée, prix), `tool.invoke` (toolId, action, risque, durée, statut), `policy.evaluate`, `approval.wait` ;
- lier les spans aux objets métier via `agentId`, `taskId`, `toolInvocationId`, `workflowId` (ne pas passer prompt brut, email, CV, secret dans les tags).

Logger Pino JSON avec correlation. Une UI d'inspection doit exposer des **étapes d'exécution observables**, jamais une chaîne de pensée privée. Un traceId est un identifiant de diagnostic, pas un lien public ouvert sans vérification.

## 3. Tableau KPI exact
| KPI | Définition / unité | Source |
|---|---|---|
| Agents actifs | agents administrativement `active` | agents |
| Agents occupés | agents avec run/tâche actifs à T | agent_runs/tasks |
| Tâches en cours | tasks `queued/running/waiting_approval/blocked` séparées | tasks |
| Tâches terminées | `succeeded` pendant la période choisie | tasks |
| Réunions | meetings `in_progress` | meetings |
| Outils actifs | invocations `running` distinctes, et outils uniques séparés | tool_invocations |
| Approbations en attente | approvals `pending` | approval_requests |
| Taux de succès | completed succeeded / completed succeeded+failed sur période | tasks ; afficher n |
| Coût IA | somme coût mesuré/estimé, par modèle, période | llm_usage |
| Durée p95 tool | latence p95 des invocations terminées | tool_invocations |
| Erreurs outils | nb failed / total finished sur période | tool_invocations |
| Budget utilisé | utilisé/limite par scope/période | budgets |

Aucun total ne doit mélanger démo et live sans l'indiquer. Les KPIs doivent proposer fenêtres `1h`, `24h`, `7d`, et nom de l'org. Pour démo seeded, préciser « scénario fictif » ; pour données insuffisantes, afficher `—` plutôt que `100 %` inventé.

## 4. Timeline
Filtre par service/agent/outil/statut/risque ; tri `occurredAt` avec `seq` pour trancher égalités ; virtualization dès plusieurs centaines d'items. Chaque ligne : icône, verbe, cible, courte description sanitisée, auteur, statut, horodatage, action « Inspecter ». Les outils en activité utilisent les **vraies** invocations. Réduire les bruits (`heartbeat`, animation) en regroupant par tâche et en permettant détails.

## 5. Alertes
| Niveau | Exemple | Action |
|---|---|---|
| info | agent créé / workflow terminé | notification non intrusive |
| warning | quota >80 %, outil lent, attente approbation | badge + panneau |
| error | invocation failed, workflow failed, violation policy | alerte persistante + inspecteur |
| critical | stop global, fuite potentielle, budget dépassé | bandeau, nouvelles opérations bloquées |

Les alertes sont des **données métier persistées**, avec acquittement et histoire, et non des toasts éphémères uniquement.

## 6. Replay
Choisir intervalle, charger snapshot de début + événements ordonnés, reconstruire état visuel et historique ; curseur de temps avec play/pause/vitesse 0.5–4×. Par défaut utiliser transitions animées, possibilité de saut immédiat. **Aucun side effect, aucun appel LLM ou outil ne peut être déclenché en replay.** Événements contenant des informations masquées restent masqués. `REPLAY` permanent dans header ; l'interaction « inspecter » fait lecture seule.

## 7. Coûts
`llm_usage`: input/output/cache tokens, provider/model/version, prix contractuel horodaté, coût USD ou autre devise avec conversion explicitée. Si fournisseur manque de métrique, `estimated=true`, estimation justifiée. Ne pas déduire coût rétrospectif à partir du prix actuel. Coûts des outils tiers séparés de coût LLM lorsque mesurables. Dashboard affiche coût aujourd'hui, coût par tâche/agent/équipe, alertes de budget et type de donnée mesurée.

## 8. Vérification « aucun faux positif »
Les tests comparent KPI/timeline/outils à `event_log` et tables `tool_invocations`. **Si l'agent est `using_tool` mais aucune invocation active n'est enregistrée, c'est un bug** ; ne pas masquer par une animation fictive. Un agent peut être `working` sans appel d'outil, mais l'UI ne doit pas afficher un outil « actif » sur cette seule base.
