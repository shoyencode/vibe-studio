---
title: Harness
description: Copilot CLI, Claude Code, Codex CLI et Gemini CLI — connexion, déploiement du kit et différences.
---

# Harness

Vibe Studio pilote un seul harness à la fois, choisi dans **Réglages › Harness**. Chaque harness nécessite le kit
déployé pour lui par APM et une connexion sur l’ordinateur.

## Connexion

Sous Windows, chaque harness dispose d’un bouton **Se connecter…** qui ouvre sa commande de connexion officielle dans
un terminal PowerShell visible, avec les chemins d’outils de Vibe Studio. Terminer l’authentification dans ce
terminal, puis choisir **Vérifier la connexion**. Les identifiants ne transitent jamais par l’interface ; les outils
manquants sont signalés au lieu d’annoncer une connexion.

## Comparaison

| Harness | Déployer le kit | Connexion | Particularités |
| --- | --- | --- | --- |
| **GitHub Copilot CLI** | `apm install` | `gh auth login --hostname github.com --web` | Harness de référence : toutes les fonctions de Vibe Studio, runtime intégré. |
| **Claude Code** | `apm install --target claude` | `claude auth login` ou `ANTHROPIC_API_KEY` | Les agents s’exécutent comme fil principal ; les lectures dans le projet sont approuvées par Claude Code. Nécessite Git Bash. |
| **Codex CLI** | `apm install --target codex` | `codex login` | Pas d’agent nommé : le prompt de l’agent devient des instructions développeur ; les commandes en lecture seule s’exécutent sans demande. |
| **Gemini CLI** | `apm install --target copilot,gemini` | `gemini`, puis `/auth`, ou `GEMINI_API_KEY` | Pas de sélection d’agent ; les écritures de fichiers passent par Vibe Studio ; le projet est marqué comme fiable. |

## Ce qui reste identique

Pour chaque harness, les garde-fous sont contrôlés avant chaque écriture, commande et skill ; `vibe_studio_report` et,
lorsqu’il manque, `ask_user` sont proposés comme outils Vibe Studio ; les modèles du kit sont remplacés par le modèle
le plus proche du harness, affiché dans la boîte de dialogue de lancement.

## Modèles, contexte et effort

La boîte de dialogue de lancement propose les modèles déclarés par le kit, une fenêtre de contexte et, lorsque le
harness le permet, un effort de raisonnement (Copilot, Claude, Codex ; pas Gemini). Les choix proviennent du catalogue
du harness connecté, jamais d’une table devinée. Lorsque la tarification fournit un budget de prompt, il est indiqué
comme maximum de **tokens en entrée**. **Actualiser** le catalogue permet de vérifier une disponibilité récemment
modifiée. Copilot conserve son dernier catalogue obtenu avec succès si la découverte échoue, et le signale.

::: info Limites
La fenêtre de contexte longue est une option de Copilot, et l’espace Coûts ne mesure que les sessions Copilot.
:::
