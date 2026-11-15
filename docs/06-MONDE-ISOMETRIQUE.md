# 06 — World engine : bureau isométrique, pathfinding, avatars et projection

## 1. Direction artistique (contrat de rendu)
Vue de trois-quarts isométrique « 2:1 », pixel-art net (pixelated rendering), petite architecture ouverte dans la veine d'un simulateur de bureau / Habbo-like. Pas de monde 3D. Dalle flottante au-dessus d'un fond lavande/rose pâle avec ombres discrètes. Départements modulaires délimités par sols et cloisons colorées, plantes, mobilier détaillé, fenêtres, enseigne « QUARTIER GÉNÉRAL ». Noms de zone avec badges arrondis (`Finance · 2/3 au poste`). Chaque avatar porte un label prénom court et statut sur hover/sélection ; éviter de faire flotter des dizaines de bulles en même temps.

**Assets :** créer pixels originaux (tiles/desk/chair/plant/door/panel/avatar) et conserver source éditable si générés par scripts. Éviter la reprise de sprites du TikTok ou Habbo. Démo initiale peut utiliser un petit tileset original généré procéduralement **mais doit rester visuellement soigné** (palette harmonisée, ombrage, lisibilité, ombres). Les noms d'entreprises ou logos tiers nécessitent prudence de licence ; utiliser des glyphes neutres au départ.

## 2. Coordonnées et carte
Tiled JSON (orientation `isometric`) ou map interne compatible. Référence initiale : grille 36×26, tuiles **64×32 pixels** (ratio 2:1). Grille navigable distincte des tiles décoratifs : `walkable`, `blocked`, `desk`, `chair`, `meeting_seat`, `entry_spawn`, `exit`, `door`, `waypoint`. Convertir `(gx,gy)` vers `(screenX,screenY)` :

```ts
const sx = originX + (gx - gy) * tileWidth / 2;
const sy = originY + (gx + gy) * tileHeight / 2;
```

La conversion écran→tile inverse doit tenir compte du zoom, de la caméra et du ratio. **Ordre de profondeur :** tri par y/pied des sprites et couche d'occlusion pour éviter qu'un avatar passe devant une cloison arrière de façon impossible. Phaser gère les tilemaps isométriques, mais vérifier support exact des versions retenues.

## 3. Assets minimum
- Sol/collisions : 8 variantes de dalle, 6 couleurs de départements, seuils, allées, bord de dalle.
- Bâtiment : 3 types de cloison, fenêtres, portes, colonnes, affichage zone.
- Mobilier : 3 bureaux, 3 chaises, 2 tables de réunion, écrans, serveurs, plante, canapé, café, tableau.
- Avatar : au moins 8 variations de vêtements/coiffures/couleurs non stéréotypées ; 4 directions × `idle/walk/work/meeting` ; spritesheets avec taille et anchors cohérents.
- UI : badges d'état, icônes outils (originales), halo de sélection, tooltip, liens animés et effets de spawn.

**Exigence :** chaque avatar est sélectionnable par hitbox **découplée du rendu** ; l'interface passe par une couche React pour l'inspecteur, pas via des dialogs dessinés dans le Canvas.

## 4. Architecture de rendu
```text
React Cockpit
  ├── Topbar / KPIs
  ├── WorldViewport <PhaserGame />
  │     ├── WorldScene (tilemap, furniture, labels)
  │     ├── AvatarManager (sprites pooled)
  │     ├── MovementSystem (path + tween)
  │     ├── MeetingRenderer (seating + bubbles)
  │     ├── ToolEdgeOverlay (on demand)
  │     ├── CameraController (pan/zoom/focus)
  │     └── InteractionAdapter (click -> React selection store)
  ├── Inspector / ToolWall
  └── Timeline
```
Import dynamique sur client (`ssr:false`) pour Phaser. Nettoyer listeners et scene au `unmount`. Utiliser un store UI léger ; ne pas dupliquer la vérité métier en plusieurs stores concurrents.

## 5. Pathfinding
A* sur navigation grid, obstacles et portes, coûts adaptables, pas diagonal à travers objets bloquants. Fallback vers waypoint accessible si poste occupé. Système d'occupation de siège. Pour 100 avatars, limiter calculs : ne recalculer que quand target change ; animation locale ~30/60 fps, **aucun** appel LLM pour déplacer le personnage. Ne pas mettre une position animée dans la DB à chaque frame ; sauvegarder intentions (destination/anchor) et snapshots occasionnels.

## 6. Machine d'animation
**Visual state != business state**. Mapping :
| Événement métier | Destination / animation | Message UI |
|---|---|---|
| `agent.created` | accueil; spawn animation | Nouvel agent |
| `agent.activated` | desk du département | Arrive au bureau |
| `task.started` | desk / poste de travail | Mission en cours |
| `agent.run.started` | seated/work, statut réel | Analyse / réflexion |
| `tool.invocation.started` | seated/work + icône outil | CRM · lecture |
| `meeting.started` | meeting_room seat | Réunion en cours |
| `approval.requested` | reste au lieu courant + badge | Approbation requise |
| `task.completed` | revient à idle ou café (si idle réel) | Tâche terminée |
| `agent.paused` | pause mouvement ; marque paused | Suspendu |
| `agent.deactivated` | exit animation puis hide | Agent désactivé |

Un statut `idle` peut déclencher de petites animations locales discrètes (`stretch`, `look`) **mais afficher explicitement que c'est cosmétique** ; ne pas inventer de « réunions » métier. Un événement très bref peut engendrer une animation raccourcie ; elle est marquée comme visualisation de l'activité passée si déjà achevée.

## 7. Meetings et co-présence
Salle avec 4-8 sièges assignés. Au début `meeting.started`, réserver places ; si salle pleine, choisir autre salle ou mode « réunion virtuelle » avec vignettes, pas de superposition. Co-présence = représentation des participants déclarés, pas preuve d'un échange verbal synchrone. Tooltip : sujet, temps, participants, lien compte-rendu. Bulles courtes (« propose un plan », « contrôle une donnée ») dérivées de résumés d'événements et validées comme non sensibles.

## 8. Overlay des outils
À la sélection agent ou `Show activity edges`, dessiner flux de l'avatar vers le **dock d'outils** sur bord de carte ou petits relais situés dans chaque zone. Les liens sont animés uniquement pendant une `tool.invocation.started` persistée, puis s'éteignent après succès/erreur. À plus de 5 liens, regrouper et afficher compteur. Les outils actifs restent toujours visibles dans le panneau UI React même si overlay coupé. Le mode `System View` offre un mini-graphe professionnel en complément, mais ne remplace jamais la carte.

## 9. Performances et tests visuels
Cibles de qualité **à mesurer sur machine cible** : 30 fps minimum avec 50 avatars, objectif 60 fps avec 12, mise à jour UI des événements visible sous 2s en condition locale normale, initial UI chargée sans freeze long. Ce sont des **objectifs de test**, pas des performances démontrées. Réduire fréquence des labels, culling des objets hors champ, atlas sprites, recycler composants. Respecter `prefers-reduced-motion`. Tester screenshot 1440×900 et 1920×1080, lisibilité tool wall et timeline avec 0/5/20 actions.

## 10. Interactions particulières
- Clic avatar : inspector ouvert, halo, focus optionnel.
- Clic bureau : action contextuelle « afficher l'agent/room », pas fausse tâche.
- Clic outil actif : inspecteur invocation avec trace/correlation.
- Clic meeting : participants et synthèse.
- Drag map = pan, wheel = zoom ; éviter d'intercepter scroll panneau.
- Nouveau agent : effet d'arrivée à l'accueil avec notification, uniquement sur événement `agent.created` inédit, pas à chaque reconnexion.
- Timeline replay : positions calculées comme état dérivé à l'instant T, **aucune écriture backend**.
