---
title: Parcours
description: Le registre des étapes, les indicateurs en direct, les validations et la réouverture d’une étape.
---

# Parcours

Le Parcours est l’accueil d’un projet ouvert. Il superpose trois bandeaux :

1. Un **en-tête** avec un résumé d’une ligne des étapes affichées.
2. La **bande d’indicateurs en direct** : session, questions et demandes d’autorisation de l’IA, garde-fous,
   consommation. Chaque case ouvre l’espace correspondant (Conversation, Réglages › Garde-fous, Coûts).
3. Le **registre** : une entrée datée par étape et l’historique des lancements, qui défilent ensemble.

## Entrées du registre

Chaque entrée affiche sa date et son heure, le titre de l’étape, les fichiers produits et un badge d’état :
*Validé le…*, *Attend une réponse*, *En cours*, *À venir*, *Prérequis à compléter*. L’entrée à traiter maintenant
est mise en évidence en bleu avec son action principale : **Préparer** l’étape suivante, ou ouvrir la conversation
active.

Les dates proviennent de la dernière validation en vigueur, sinon du dernier lancement ou du dernier fichier produit.
Une date inconnue affiche « — », jamais une date inventée.

## Étapes par unité

Lorsqu’un kit répète des étapes par unité (scénario, thème, lot), le registre les affiche pour l’unité sélectionnée.
Les sélecteurs d’unité indiquent le numéro et, s’il existe, le premier titre du livrable de l’unité. Un kit peut
déclarer ses scénarios à l’avance : ils apparaissent tous avant que leurs dossiers existent, et le choix se fait par
leur titre métier.

## Validations

Une étape est **validée** lorsque chaque fichier de sa liste `approves` a une validation en vigueur. Son bouton de
lancement est alors désactivé, y compris dans l’API du cœur, pour qu’une étape validée ne puisse pas être relancée par
erreur.

Pour modifier une étape validée, choisir **Rouvrir l’étape…**. Vibe Studio demande une confirmation et ajoute une
révocation au fichier de validation ; les documents et les validations précédentes sont conservés. Rouvrir un document
partagé peut aussi invalider une autre étape qui en dépend.

## Validation automatique

Une étape de construction qui ne déclare aucun point de validation humaine se termine automatiquement lorsque son
rapport final, ses preuves, ses tâches terminées et ses contrôles de fin sont tous présents au moment où l’IA devient
inactive. Elle affiche *Validée automatiquement* avec un lien vers sa conversation. Les constructions interrompues, en
échec ou incomplètes ne sont jamais validées.
