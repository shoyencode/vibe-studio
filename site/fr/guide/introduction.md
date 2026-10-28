---
title: Qu’est-ce que Vibe Studio ?
description: Les notions de Vibe Studio — kits, contrats, harness, étapes et validations.
---

# Qu’est-ce que Vibe Studio ?

Vibe Studio est une application de bureau Windows qui pilote des **kits IA** étape par étape. Un kit rassemble les
skills, les agents et les règles d’un type de mission — une démonstration de faisabilité, un audit, une migration.
Vibe Studio lit le contrat du kit, lance chaque étape de la mission dans une nouvelle session IA et laisse le contrôle
à l’utilisateur : répondre aux questions de l’IA, accorder ou refuser ses autorisations, et valider chaque livrable
avant que le parcours avance.

Il s’appuie sur l’outil d’IA déjà utilisé — GitHub Copilot CLI, Claude Code, Codex CLI ou Gemini CLI —, que
Vibe Studio appelle un **harness**.

## Les éléments

| Terme | Signification |
| --- | --- |
| **Projet** | Un dossier de l’ordinateur dans lequel un kit est installé. Les documents et les livrables s’y trouvent. |
| **Kit** | Un paquet [APM](https://github.com/microsoft/apm) de skills, d’agents et de règles, accompagné d’un contrat. Un kit par type de mission. |
| **Contrat** | `vibe-studio.json`, fourni par le kit. Il décrit le parcours : les étapes, les fichiers dont elles ont besoin et qu’elles produisent, les validations, les garde-fous. Voir la [référence du contrat](../kits/vibe-studio-contract). |
| **Harness** | Le moteur d’IA qui exécute une étape : Copilot CLI, Claude Code, Codex CLI ou Gemini CLI. Il se choisit dans Réglages. |
| **Étape** | Un stade du parcours (par exemple *Rédiger la spécification*). Chaque lancement ouvre une nouvelle session IA. |
| **Unité** | Un travail répété, comme un scénario ou une page à auditer. Certaines étapes s’exécutent une fois par unité. |
| **Garde-fou** | Une règle du kit qui bloque une action de l’IA avant qu’elle ait lieu (aucun secret écrit, fichiers protégés, commandes confirmées). |
| **Validation** | L’accord explicite de l’utilisateur sur un livrable. Une étape est terminée lorsque chaque fichier qu’elle doit faire valider a une validation en vigueur. |

## Ce que Vibe Studio ajoute à un kit

- **Un parcours lisible.** Chaque étape figure dans un registre daté, avec ses fichiers produits et un badge d’état.
  La ligne à traiter maintenant est mise en évidence, avec son action.
- **Des sessions supervisées.** Les questions et les demandes d’autorisation de l’IA apparaissent dans Conversation ;
  un signal sonore et une notification Windows rappellent l’utilisateur lorsque la fenêtre n’est pas au premier plan.
  Mise en pause, reprise ou arrêt à tout moment.
- **Des garde-fous appliqués pour chaque harness.** Les écritures, les commandes et les skills sont contrôlés avant
  leur exécution.
- **Des livrables validés par l’utilisateur.** Les livrables Markdown s’ouvrent en pleine largeur ; les validations
  sont datées et peuvent être rouvertes.
- **Une consommation mesurée.** Les tokens, les crédits IA et l’occupation du contexte s’affichent lorsque le harness
  les communique — jamais estimés.
- **Un atelier de kits.** Décrire une mission et laisser l’IA rédiger un kit complet, à relire proposition par
  proposition. Voir le [tutoriel](../kits/tutorial).

## Ce qu’il ne fait pas

- Il ne se connecte pas à la place de l’utilisateur, n’achète pas d’abonnement et ne déploie pas de kit
  automatiquement.
- Il n’envoie jamais de prompt dans le seul but de créer un journal et n’invente jamais de métrique : une valeur
  manquante indique *Non communiqué*.
- Il ne renomme ni ne réécrit les fichiers du client. Les garde-fous sont des garde-corps internes au harness, pas
  un bac à sable du système d’exploitation.

Suite : [installer Vibe Studio](./installation).
