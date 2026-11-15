# Déposer le pack dans un repo GitHub vide

## Méthode 1 — Depuis un ordinateur avec Git (recommandée)
1. Créer un repo GitHub vide ou utiliser celui déjà créé.
2. Cloner le repo : `git clone <URL_DU_REPO>` et entrer dans le dossier.
3. Extraire le contenu de l'archive **dans ce dossier, pas dans un sous-dossier**. Vérifier que `CLAUDE.md` est à la racine et que `docs/` et `specs/` existent.
4. Lancer `git add . && git commit -m "docs: initial architecture and Claude instructions" && git push`.
5. Ouvrir Claude Code depuis ce dossier, ou ouvrir le repo synchronisé dans l'environnement Claude Code connecté à GitHub.
6. Sélectionner Fable 5.2 si disponible, puis coller le prompt de `PROMPT-A-LANCER-DANS-CLAUDE.md`.

## Méthode 2 — Par l'interface GitHub
L'interface web de GitHub permet d'ajouter plusieurs fichiers, mais les fichiers cachés et dossiers doivent être vérifiés. Ne pas téléverser le `.zip` **comme simple fichier** en pensant que Claude Code pourra automatiquement l'extraire : il faut réellement mettre les contenus Markdown à la racine du repo. Un repo qui contient uniquement un ZIP n'est pas équivalent au repo initialisé.

## Méthode 3 — Un seul document
Si un seul fichier peut être transmis, donner `SPECIFICATION-INTEGRALE.md` à Claude Code et demander : **« recrée tous les fichiers indiqués, en particulier `CLAUDE.md`, puis commence M0 et M1 »**. Le pack multi-fichiers reste préférable car Claude Code peut relire chaque document à la demande.

## Ce que Claude Fable 5.2 devrait produire
L'archive initiale **ne contient pas le produit codé**. Claude Code devra générer le code, installer les dépendances, lancer les services, exécuter les tests, réparer les erreurs et documenter les résultats. Pour le suivi, `docs/PROGRESS.md` doit être mis à jour après chaque milestone.

## Attention à la confidentialité
Ne jamais ajouter dans GitHub de vraies clés API, tokens OAuth, exports clients, CV, comptabilité ou identifiants. Garder les secrets en gestionnaire d'environnement, jamais dans le prompt ni dans `.env.example`.
