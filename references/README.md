# Référence visuelle — usage de conception uniquement

La capture d'écran d'origine (vidéo tierce, droits de redistribution non vérifiés, présence d'une personne
identifiable) a été **retirée du dépôt** le 2026-11-15. Elle ne doit pas y être réintroduite :
`references/*.jpg|jpeg|png|webp` est ignoré par git. Si elle est fournie localement, elle reste privée.

## Description de l'intention visuelle (à reproduire en original, jamais à copier)

- Quartier général vu en isométrique 2:1, pixel art net, posé comme une **dalle flottante** sur un fond
  **lavande/rose pâle** avec quelques nuages pixel ; bord de dalle visible (terre + liseré d'herbe).
- Grand bâtiment ouvert : **murs arrière clairs** avec fenêtres à croisillons, et une **enseigne peinte**
  « QUARTIER GÉNÉRAL » le long d'un mur.
- **Départements délimités par des cloisons basses colorées** (teal, vert, violet, rose, or…), chacun avec
  un sol teinté, des bureaux blancs avec écrans, des chaises, des tableaux blancs et des **plantes en pot**.
- **Badges arrondis** par service : pastille/icône colorée, nom du département, sous-titre « X/Y au poste ».
- Personnages petits mais lisibles, tenues variées ; une **bulle blanche arrondie** peut afficher le prénom
  et une courte action en cours au-dessus d'un avatar.
- Ambiance chaleureuse, ludique et propre, contrastes nets ; quelques arbres/haies en bordure extérieure.

Tous les visuels du projet sont générés procéduralement (`apps/web/src/world/textures.ts`, `HqScene.ts`) :
aucun pixel, personnage, décor, logo ou texte de la référence n'est réutilisé.
