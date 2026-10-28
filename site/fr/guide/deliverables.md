---
title: Livrables et validations
description: Lire les livrables, les valider, rouvrir une étape et ouvrir les sources client.
---

# Livrables et validations

## Livrables

**Livrables** regroupe par section les fichiers déclarés par le kit. Les livrables Markdown s’ouvrent sur toute la
largeur du contenu ; **Ouvrir le fichier** ouvre le document dans son application de bureau par défaut. Les formats
exécutables et les chemins situés hors du projet sont refusés.

## Valider

Lorsqu’une étape doit être validée, le kit le demande dans Conversation, puis enregistre la validation avec son propre
script de validation. La validation est datée et apparaît dans le registre : *Validé le 22/10*. Un rapport de l’IA
n’est jamais une validation, et Autopilot ne valide jamais à la place de l’utilisateur.

Une étape est validée lorsque chaque fichier de sa liste `approves` a une validation en vigueur. Pour modifier un
document validé, utiliser **Rouvrir l’étape…** dans le Parcours : les révocations sont ajoutées à la suite, les
validations et les documents précédents sont conservés.

## Sources client

Les kits dotés d’un module de sources affichent **Sources client** : déposer les documents du client dans le dossier
déclaré ; l’étape d’import les convertit pour que l’IA puisse les lire. Chaque document propose **Lire** (la
conversion), **Ouvrir le fichier** et **Ouvrir l’original**.

## Corrections manuelles

Les tâches de correction (R) issues des revues ou des retours peuvent être traitées sans l’IA si nécessaire :
**Modifier**, **Valider manuellement** ou **Supprimer**. La validation manuelle marque seulement la tâche comme
terminée ; elle ne valide jamais un livrable. Les identifiants supprimés sont réservés et ne sont pas réutilisés. Ces
actions sont bloquées tant qu’une étape sur l’unité ou un tour d’IA libre est actif.
