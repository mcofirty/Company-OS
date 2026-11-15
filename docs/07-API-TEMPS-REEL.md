# 07 — API HTTP, WebSocket et protocole d'événements

## 1. Conventions
Préfixe `/v1`, JSON UTF-8, UUIDs, horaires ISO-8601 UTC, `orgId` dérivé de l'auth (pas librement fourni comme cible d'un autre tenant). Réponses API enveloppées dans `{data, meta}` ou `{error:{code,message,requestId}}` de façon cohérente. Valider toutes entrées avec Zod ; générer OpenAPI en CI si possible. Pagination cursor-based sur événements/activités. Risques et permissions systématiquement contrôlés côté serveur. Limiter payload aux champs destinés au client.

## 2. Endpoints essentiels (implémenter par jalon)
| Méthode | Route | Comportement | Permissions |
|---|---|---|---|
| GET | `/health/live` | liveness process | public sûr |
| GET | `/health/ready` | DB, worker dependencies readiness | exploitation |
| GET | `/v1/me` | principal, org, capacités UI | connecté |
| GET | `/v1/bootstrap` | snapshot monde+KPI+catalogue outils+lastSeq | viewer |
| GET | `/v1/departments` | liste et occupation actuelle | viewer |
| GET | `/v1/agents` | filtres/pagination | viewer |
| GET | `/v1/agents/:id` | agent + tâches et outils, règles redact | viewer scoped |
| POST | `/v1/agents` | créer draft, éventuellement approval | admin |
| POST | `/v1/agents/:id/activate` | active après vérifications | admin |
| POST | `/v1/agents/:id/pause` | stop nouvelles exécutions | operator/admin |
| POST | `/v1/agents/:id/resume` | resume autorisé | operator/admin |
| GET | `/v1/tasks` | tâches & filtres | viewer |
| POST | `/v1/tasks` | crée tâche puis déclenche workflow autorisé | operator/admin |
| GET | `/v1/tasks/:id` | détails, traces corrélées | viewer |
| POST | `/v1/tasks/:id/cancel` | annulation contrôlée | operator/admin |
| GET | `/v1/meetings` | calendrier / état | viewer |
| POST | `/v1/meetings` | propose une réunion | operator/admin |
| GET | `/v1/tools` | catalogue + santé + dernières utilisations | viewer |
| GET | `/v1/tool-invocations` | historique, filtres, offset | viewer scoped |
| GET | `/v1/tool-invocations/:id` | résultat redacted/trace | viewer scoped |
| GET | `/v1/approvals` | demandes en attente | operator/admin |
| POST | `/v1/approvals/:id/decide` | `approve/reject`, idempotent | admin ou rôle autorisé |
| GET | `/v1/events?afterSeq=123&limit=200` | récupération événementielle | viewer |
| GET | `/v1/metrics/summary?window=24h` | KPI serveur | viewer |
| POST | `/v1/demo/scenarios/:scenarioKey/run` | scénario démo déterministe | admin, DEMO seulement |
| POST | `/v1/system/pause` | kill switch org | admin |
| POST | `/v1/system/resume` | reprise org | admin |

**Actions** : toujours vérifier `Idempotency-Key` pour les mutations. Éviter GET déclenchant des effets, inclure `X-Request-Id`/trace id. Si aucune connexion authentifiée n'est disponible en développement local, l'API peut fournir un *dev principal* uniquement quand `NODE_ENV=development && APP_MODE=demo` et liée à localhost; jamais en live ou staging.

## 3. Snapshot `GET /v1/bootstrap`
```json
{
  "data": {
    "mode": "demo",
    "lastSeq": 884,
    "serverTime": "2026-11-14T12:00:00.000Z",
    "worldMap": {"id":"hq-v1","asset":"hq-map.json","version":1},
    "agents": [{"id":"agent-sales-01","name":"Nora","departmentId":"sales","status":"working","avatarId":"avatar-04","targetAnchor":"sales-desk-1","currentTaskId":"task-1"}],
    "tools": [{"id":"crm","name":"CRM","status":"healthy","activeInvocations":1}],
    "activeToolInvocations": [],
    "meetings": [],
    "approvals": [],
    "metrics": {"activeAgents":1,"runningTasks":1,"activeTools":1,"estimatedCostMinor":12,"currency":"USD"},
    "timeline": []
  },
  "meta":{"schemaVersion":1}
}
```
Données **illustratives et fictives**. En production, renvoyer seulement les champs autorisés. Le snapshot et `lastSeq` doivent être cohérents ; éviter fenêtre de course pendant la récupération (transaction/snapshot DB ou mécanisme `asOfSeq`).

## 4. Socket.IO namespace / rooms
Après authentification socket, rejoindre `org:<orgId>`, éventuellement `department:<id>`. Événement unifié `domain:event`, sous forme d'enveloppe JSON validée par `specs/events.schema.json`. Commandes `events:resume` avec `{afterSeq}` et `events:heartbeat` optionnel. ACK `{accepted, lastSeq}` ; si gap trop ancien, serveur demande `sync:required` et client recharge snapshot. Les événements sont **append-only et ordonnés par org**, `seq` monotone.

**Attention :** par défaut Socket.IO donne ordre des messages reçus, mais **pas** livraison garantie après déconnexion. Sans persistance/replay il perd des événements. Notre source de rattrapage est `event_log`, avec `lastSeq` stocké localement pendant la session (pas un identifiant secret). Exiger idempotence du reducer et tests de reconnexion.

## 5. Event types V1
| Type | Payload minimal | Animation/lecture |
|---|---|---|
| `agent.created` | agentId, departmentId, avatarId | spawn à l'entrée |
| `agent.activated` | agentId, assignedAnchor | marche au bureau |
| `agent.paused` / `agent.resumed` | agentId, reason | badge état |
| `agent.deactivated` | agentId | exit puis masque |
| `task.created` | taskId, agentId, title | compteur/timeline |
| `task.started` | taskId, agentId, targetAnchor | agent à son desk |
| `task.completed` | taskId, resultRef | status + KPI |
| `task.failed` / `task.blocked` | taskId, reasonCode | alerte / inspection |
| `agent.run.started` | runId, agentId, taskId, providerClass | état analyse |
| `agent.run.completed` | runId, status, tokenUsageRef | coût/historique |
| `tool.invocation.requested` | invocationId, toolId, agentId, taskId, action | outil potentiel |
| `tool.invocation.started` | invocationId, toolId, agentId, taskId, action | ligne outil active + flux |
| `tool.invocation.succeeded` | invocationId, durationMs, safeSummary | résolution |
| `tool.invocation.failed` | invocationId, errorCode, durationMs | alerte + détail |
| `tool.invocation.rejected` | invocationId, reasonCode | refus sécurité |
| `meeting.started` | meetingId, roomId, participantAgentIds, topic | déplacement et réunion |
| `meeting.completed` | meetingId, summaryRef, taskIdsCreated | dissipation |
| `approval.requested` | approvalId, agentId, toolId, safePreview | KPI, badge |
| `approval.decided` | approvalId, decision, reviewerId | reprise / annulation |
| `budget.threshold_reached` | scope, percent, value | notification |
| `system.paused` / `system.resumed` | scope, actor | statut global |
| `world.layout.updated` | mapId, layoutVersion | reset scène/snapshot |

**Proscrire** des événements trompeurs `agent.thinking_text` ou `live_chat_message` contenant chaînes de pensée internes. Si échanges réels entre agents : `agent.message.recorded` avec message métier *sanitisé* et source, à utiliser avec retenue.

## 6. Enveloppe JSON
```json
{
  "schemaVersion": 1,
  "eventId": "ac00d810-6e6d-4e75-86ca-dc9d090e5fba",
  "orgId": "b7001052-fc32-4ac1-897a-2143bc7622bd",
  "seq": 885,
  "type": "tool.invocation.started",
  "aggregateType": "tool_invocation",
  "aggregateId": "12b1b432-a2a5-42a2-9149-f1c725a39bfd",
  "aggregateVersion": 2,
  "correlationId": "1f425ee6-6231-4dd8-a085-27a7e4b7b852",
  "causationId": "7fbf6d56-3492-4b9b-9e8b-11bbc8fda0ed",
  "actor": {"kind":"agent","id":"agent-sales-01"},
  "provenance": "demo",
  "occurredAt": "2026-11-14T12:00:00.000Z",
  "classification": "internal",
  "payload": {"invocationId":"i1","toolId":"crm","agentId":"agent-sales-01","taskId":"task-1","action":"lookup_lead"}
}
```

## 7. Contrats UI non négociables
- Un tool invocation `started` crée/actualise une ligne mur des outils ; `succeeded/failed/rejected` la ferme et crée trace récente.
- Clic ligne tool trace utilise **même** `invocationId` et `correlationId` que le backend ; pas d'identifiants inventés côté client.
- `task.started` pilote mouvement vers desk ; meeting.started pilote mouvement vers réunion ; tous deux indépendants du rendu.
- Récupérer l'état métier à partir du snapshot si client reconnecte après plusieurs minutes ; ne pas rejouer chaque animation passée en LIVE. Pour replay explicitement demandé, utiliser mode historique.
- **Pas de spam** : coalescing visuel et virtualisation liste si centaines d'événements.

## 8. Erreurs et observabilité API
Error codes stables : `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `POLICY_DENIED`, `APPROVAL_REQUIRED`, `BUDGET_EXCEEDED`, `RATE_LIMITED`, `CONFLICT`, `TOOL_UNAVAILABLE`, `WORKFLOW_FAILED`, `EVENT_GAP`, `INTERNAL_ERROR`. Les messages visibles ne contiennent jamais des secrets. API trace `requestId`, `traceId`, `correlationId`.
