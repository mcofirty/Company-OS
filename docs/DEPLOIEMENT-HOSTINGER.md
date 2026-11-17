# Mettre Living HQ en ligne sur un VPS Hostinger

Résultat : le cockpit et vos agents tournent 24 h/24 sur **votre** serveur, en HTTPS, avec la clé
Claude stockée uniquement sur ce serveur. Durée : environ 30 à 45 minutes la première fois.

> Kit testé : pile complète (Caddy HTTPS, API, worker, Temporal, PostgreSQL, cockpit), connexion
> par jeton dans le navigateur, temps réel, bascule LIVE, sauvegarde et restauration. Non testé
> ici : la commande Hostinger elle-même et l'obtention d'un vrai certificat Let's Encrypt (qui
> exige un serveur joignable depuis Internet).

## 1. Commander le serveur

1. Sur hostinger.fr : **Hébergement → Hébergement VPS** (« Docker et accès root complet »).
   Ne prenez pas « Hébergement Web », « Cloud », « VPS géré par l'IA » ni « Applications ».
2. Formule : **KVM 2** (2 vCPU, 8 Go). KVM 1 fonctionne mais les mises à jour sont lentes.
3. Vérifiez le **prix au renouvellement** affiché au récapitulatif (les remises dépendent de la
   durée d'engagement).
4. Pendant la configuration :
   - Emplacement : **France** (ou le pays européen le plus proche) ;
   - Système : **Ubuntu 24.04** « simple » (sans panneau de contrôle ni application) ;
   - Mot de passe **root** : long et unique, gardez-le dans un gestionnaire de mots de passe.
     (Si vous savez faire, ajoutez plutôt une clé SSH.)
5. Attendez que le VPS soit « En cours d'exécution ». Notez son **adresse IP**.

**Pare-feu Hostinger** : dans hPanel → VPS → *Sécurité / Pare-feu*, s'il est activé, autorisez
les ports **22, 80 et 443** (TCP, et 443 UDP). Le script configure aussi le pare-feu du serveur.

## 2. Ouvrir un terminal sur le serveur

hPanel → votre VPS → bouton **« Terminal du navigateur »** (ou *Browser terminal*). Vous êtes
connecté en root. (Alternative : `ssh root@VOTRE_IP` depuis votre ordinateur.)

## 3. Récupérer le projet

Copiez-collez ces trois lignes, une à une :

```bash
apt-get update && apt-get install -y git
```

```bash
git clone -b claude/charming-fermat-8jkw0y https://github.com/mcofirty/Company-OS.git /opt/company-os
```

```bash
bash /opt/company-os/infra/deploy/install.sh
```

**Si GitHub demande un identifiant** (dépôt privé) :
- *Username* : votre nom d'utilisateur GitHub ;
- *Password* : **pas** votre mot de passe, mais un jeton. Sur github.com → *Settings → Developer
  settings → Personal access tokens → Fine-grained tokens → Generate new token* : accès au seul
  dépôt `Company-OS`, permission **Contents : Read-only**, expiration courte. Collez-le (rien ne
  s'affiche, c'est normal). Il n'est pas enregistré sur le serveur.

> Quand le travail sera fusionné dans la branche principale, remplacez
> `-b claude/charming-fermat-8jkw0y` par `-b main`.

## 4. Répondre aux questions du script

| Question | Que répondre |
|---|---|
| Adresse du cockpit / de l'API | **Entrée** pour accepter les adresses gratuites proposées (`hq.…sslip.io`, `api.…sslip.io`). Si vous avez un nom de domaine, indiquez par ex. `hq.mondomaine.fr` et `api.mondomaine.fr` après avoir créé chez votre registraire deux enregistrements **A** vers l'IP du VPS. |
| Nom de votre entreprise | Le nom de votre organisation LIVE. |
| Budget mensuel | Plafond dur des dépenses Claude de l'organisation (ex. `5`). |
| Clé Anthropic | Collez votre clé `sk-ant-…` (elle ne s'affiche pas). Utilisez une **clé dédiée avec une limite de dépense** dans la console Anthropic. Vous pouvez laisser vide et l'ajouter plus tard. |

Le script installe Docker et le pare-feu, génère les mots de passe, construit et démarre tout
(10 à 20 minutes la première fois), crée l'organisation de démonstration et votre organisation
LIVE, et programme une sauvegarde quotidienne.

À la fin, il propose de **créer votre connexion** (répondez `o`) : voir §5.

## 5. Votre connexion : mot de passe + code du téléphone

Seule une personne qui connaît votre mot de passe **et** qui a votre téléphone peut ouvrir le
cockpit. Installez d'abord une application d'authentification sur le téléphone (Google
Authenticator, Microsoft Authenticator, 1Password, Bitwarden…).

1. Le script demande un mot de passe (10 caractères minimum, deux fois ; rien ne s'affiche).
2. Il affiche un **QR code** : dans l'application du téléphone, « + » → « Scanner un QR code ».
   (Impossible de scanner ? « Saisir une clé de configuration » avec la clé affichée dessous.)
3. Tapez le code à 6 chiffres que l'application affiche : le script vérifie que tout est bon.

Ensuite, pour vous connecter :
1. Ouvrez l'adresse du cockpit (`https://hq.…`). Si la page ne répond pas tout de suite, attendez
   une à deux minutes (obtention du certificat HTTPS).
2. Saisissez le mot de passe, puis le code du téléphone : la connexion part toute seule au 6ᵉ
   chiffre. « Rester connecté sur cet appareil » vous évite de recommencer pendant 30 jours
   (décochez-le sur un ordinateur partagé : la session dure alors 12 h dans cet onglet).
3. En haut, sélecteur d'organisation → **LIVE · votre entreprise** → **« + Agent »**, puis
   **« Confier une mission »**. Bouton **⏻** (en haut à droite) : se déconnecter.

**Protections** : après 5 essais ratés, attente imposée (1 min, puis doublée à chaque échec) ;
un code ne sert qu'une fois ; le message d'erreur ne dit pas si c'est le mot de passe ou le code
qui est faux.

**Téléphone perdu, mot de passe oublié, ou doute** : depuis le terminal du serveur, relancez
```bash
bash /opt/company-os/infra/deploy/set-login.sh
```
Nouveau mot de passe, nouveau QR code, et **tous les appareils sont déconnectés**.

*Sans connexion créée* (réponse `n`), le cockpit demande le jeton d'accès affiché par le script
(⚙ → URL de l'API + jeton). Ce jeton se copie et se partage : préférez la connexion ci-dessus,
qui le supprime.

## 6. Au quotidien

Toutes les commandes se lancent depuis le terminal du VPS.

**Mettre à jour** (sauvegarde automatique avant) :
```bash
bash /opt/company-os/infra/deploy/update.sh
```

**Ajouter ou changer la clé Claude** : éditez la ligne `ANTHROPIC_API_KEY=` puis mettez à jour.
```bash
nano /opt/company-os/.env.production
```
(Ou plus simple, avec vérification du collage : `bash /opt/company-os/infra/deploy/set-key.sh`.) Les missions bloquées
faute de clé se relancent depuis le cockpit (« ↻ Relancer »).

**État des services** :
```bash
cd /opt/company-os && docker compose -f infra/docker-compose.prod.yml -f infra/docker-compose.vps.yml --env-file .env.production ps
```

**Journaux** (remplacer `worker` par `api`, `caddy`, `web`…) :
```bash
cd /opt/company-os && docker compose -f infra/docker-compose.prod.yml -f infra/docker-compose.vps.yml --env-file .env.production logs --tail 100 worker
```

**Sauvegardes** : chaque nuit à 03:30 dans `/opt/company-os/backups` (14 jours). Pour une copie
hors du serveur, téléchargez-les régulièrement (ou activez les sauvegardes Hostinger du VPS).

### Brancher vos outils (connecteurs)
Dans le cockpit : bouton **⇄ Connecteurs** → nom, adresse MCP (HTTPS) de l'outil, jeton d'accès →
« Connecter et découvrir les outils ». Choisissez pour chaque outil : *Lecture directe*, *Validation à
chaque appel* (défaut) ou *Désactivé*. Puis, sur la fiche d'un agent : **Modifier les outils**.
La clé qui chiffre les jetons (`CONNECTOR_SECRET_KEY`) est créée automatiquement dans
`/opt/company-os/.env.production` par `update.sh` : **ne la changez jamais** et gardez une copie de ce
fichier hors du serveur (sans elle, les jetons enregistrés sont illisibles).

## 7. Restaurer après un incident

⚠️ Remplace la base actuelle par la sauvegarde choisie. Faites d'abord une sauvegarde de l'état
actuel (`bash infra/deploy/backup.sh`). Procédure testée (état identique après restauration).

```bash
cd /opt/company-os
C="docker compose -f infra/docker-compose.prod.yml -f infra/docker-compose.vps.yml --env-file .env.production"
ls -lt backups/          # choisir le fichier
$C stop api worker
$C exec -T postgres dropdb -U companyos companyos
$C exec -T postgres createdb -U companyos companyos
$C exec -T postgres pg_restore -U companyos -d companyos --no-owner < backups/LE_FICHIER.dump
$C up -d --wait
```

## 8. Sécurité, en bref

- Seuls les ports 22, 80 et 443 sont ouverts ; base de données et Temporal ne sont pas exposés.
- `.env.production` (jeton, mot de passe de base, clé Claude) n'est lisible que par root et n'est
  jamais envoyé sur GitHub. La clé Claude n'est transmise qu'au worker.
- Mises à jour de sécurité Ubuntu automatiques (`unattended-upgrades`).
- Si le jeton ou la clé fuit : changez-les dans `.env.production`, lancez `update.sh`, et
  révoquez l'ancienne clé dans la console Anthropic.
- Pour plusieurs utilisateurs avec comptes individuels : OIDC, voir `docs/RUNBOOKS.md` §2.
