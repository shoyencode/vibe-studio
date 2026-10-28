---
title: Réglages et alertes
description: Apparence, alertes et sons, choix du harness et réglages du projet.
---

# Réglages et alertes

La roue dentée en bas de la barre latérale ouvre **Réglages**, même sans projet ouvert.

## Réglages personnels

- **Apparence** : thème clair, sombre ou suivant le système.
- **Alertes** : sons et notifications Windows. Une courte note sonore signale une question ou une demande
  d’autorisation, la fin d’une étape ou une erreur. Lorsque la fenêtre n’est pas au premier plan, un clic sur la
  notification Windows ouvre la conversation.
- **Harness** : le moteur d’IA, sa connexion et son catalogue de modèles. Voir [Harness](./harnesses). Le harness ne
  peut changer que lorsqu’aucune étape ni aucune conversation n’est en cours.

Les préférences personnelles se trouvent dans `%APPDATA%\Vibe Studio\preferences.json`, jamais dans le projet.

### Thèmes sonores

Choisir et écouter un thème dans **Alertes**. Chaque thème comporte un son de question, un son de succès et un son
d’erreur :

- Arcade 8-bit, Station orbitale, Télégraphe et Noir analogique — de courts motifs originaux.
- Piano acoustique enregistré et Guitare acoustique enregistrée — de vraies notes enregistrées (CC BY 3.0, voir
  `THIRD-PARTY-NOTICES.txt`), incluses pour un usage hors ligne.

## Projet et kit

Lorsqu’un kit est ouvert, **Projet et kit** contient la configuration du projet, les garde-fous et les informations
du kit. Les versions du kit et de Vibe Studio sont affichées sous **Actualiser** dans la barre latérale.

## Activité dans la barre des tâches

Pendant qu’une opération, une étape IA ou une discussion libre travaille, l’icône de la barre des tâches Windows
affiche la progression indéterminée native, même lorsque la fenêtre est réduite. Les questions en attente de réponse
et les étapes en pause ne comptent pas comme un travail en cours.
