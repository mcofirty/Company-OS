# Références vérifiées pour l'implémentation

Consultées le **14 novembre 2026**. Ce sont des **sources de vérification de capacités et contraintes**, non une garantie que les versions de packages ou les URLs resteront identiques. Claude Code doit réévaluer les APIs/versionings avant installation.

1. **Claude Fable 5.2 — documentation officielle** : https://platform.claude.com/docs/en/models/fable-5-2/overview — modèle existant, ID `claude-fable-5-2`, 1M contexte, date sortie 9 nov. 2026, conditions de rétention particulières ; utilisé pour le *développement*, modèle runtime configurable.
2. **Claude Code — mémoire CLAUDE.md** : https://code.claude.com/docs/en/memory — fichier `CLAUDE.md` à la racine, conventions projet et mémoire; conserver court et référencer docs détaillées.
3. **Claude Code — settings et permissions** : https://code.claude.com/docs/en/settings — scopes de settings ; privilégier contrôles réels plutôt que simples instructions textuelles.
4. **Temporal TypeScript SDK** : https://docs.temporal.io/develop/typescript — durable workflows, activities, workers, cancellation, retries, etc.
5. **Phaser 4 TilemapLayer** : https://docs.phaser.io/api-documentation/class/tilemaps-tilemaplayer — support tilemaps isométriques, tile layers, culling ; vérifier version.
6. **Socket.IO v4 — garanties de livraison** : https://socket.io/docs/v4/delivery-guarantees/ — messages ordonnés mais livraison serveur→client au plus une fois par défaut ; d'où notre `event_log` + reprise `seq`.
7. **OpenAI Agents SDK TypeScript (option alternative runtime)** : https://openai.github.io/openai-agents-js/ — tool calling, delegation, guardrails et traces ; pas indispensable si notre runtime maison simple suffit.

## Choix à valider après démarrage Claude Code
- Versions Node LTS, pnpm, Next.js, Phaser, Prisma, Temporal, Fastify compatibles, puis **pin dans lockfile**.
- Disponibilité des sprites/tiles libres ; utiliser assets originaux si aucune licence claire.
- Compatibilité runtime Anthropic API avec règles de rétention et contrôle des données de l'entreprise. En particulier, le modèle qui **code** n'impose pas le modèle qui opère les agents.
- Exigences de sécurité et d'auth de l'hébergement retenu (aucun service cloud n'est présumé déjà connecté).
