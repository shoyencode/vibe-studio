---
title: Unités, tâches et coûts
description: Les unités de travail répétées, le suivi des tâches, l’espace application et la consommation mesurée.
---

# Unités, tâches et coûts

Ces espaces n’apparaissent que lorsque le kit les déclare dans son contrat.

## Unités et tâches

Une **unité** est un travail répété — un scénario d’une démonstration de faisabilité, une page d’un audit, un lot
d’une migration. Certaines étapes s’exécutent une fois par unité. L’espace des unités les liste avec leur suivi de
tâches :

- Les tâches proviennent de la liste de tâches du kit (`T01`, `T02`… et les corrections `R01`…), avec les marqueurs
  *à faire*, *en cours*, *terminée* et *bloquée*. Vibe Studio met à jour le marqueur lorsque l’IA déclare une tâche.
- Les tours de revue listent les constats et les corrections ; il est possible d’ajouter ses propres corrections issues
  de retours lorsque le kit le permet.
- Les noms de scénario incluent toujours leur numéro, y compris dans l’historique.

## Application

Les kits qui construisent une application déclarent ses services. Vibe Studio les démarre dans l’ordre et ouvre
l’application depuis son espace. Les services tournent indépendamment des étapes IA : mettre une étape en pause ne
les met pas en pause.

## Coûts

Les kits dotés d’un suivi des coûts affichent **Coûts** : un relevé par étape et par unité, chargé à l’ouverture du
projet et actualisé lors de l’utilisation et de la fin des sessions (au plus toutes les cinq secondes). C’est la
mesure de référence ; les crédits de la conversation ne s’y ajoutent jamais. Une consommation non reconnue indique
*Non relevée*, jamais zéro.

Avant le premier prompt d’une étape Copilot, Vibe Studio enregistre l’étape, l’unité, la session et le lancement
exacts pour que les coûts puissent être attribués. Si le kit ne peut pas créer ce marqueur, le lancement échoue et
aucun prompt n’est envoyé. L’espace Coûts ne mesure que les sessions Copilot.
