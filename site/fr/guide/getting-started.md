---
title: Premiers pas
description: Installer un kit dans un dossier de projet, l’ouvrir dans Vibe Studio et lancer la première étape.
---

# Premiers pas

Cette page mène d’un dossier vide à la première étape terminée.

## 1. Installer un kit dans un dossier de projet

Les kits sont distribués sous forme de paquets [APM](https://github.com/microsoft/apm). Dans un terminal (par exemple
**Vibe Studio tools** depuis le menu Démarrer), créer ou choisir le dossier du projet, puis installer le kit :

```powershell
cd C:\Missions\my-project
apm install <kit package>
```

Utiliser la cible correspondant au harness : Copilot par défaut, `--target claude`, `--target codex` ou
`--target copilot,gemini`. Voir [Harness](./harnesses).

::: tip Pas encore de kit ?
Les kits officiels s’installent depuis **Kits officiels** dans l’application lorsqu’un catalogue est configuré, et
l’[atelier de kits](../kits/tutorial) en crée un à partir d’une description de mission et le teste directement dans
un projet.
:::

## 2. Ouvrir le projet

Lancer Vibe Studio. Sur la page **Projets**, choisir **Ouvrir un dossier…** et sélectionner le dossier du projet. Les
projets récents restent listés. Le bouton du projet en bas de la barre latérale revient à cette page sans fermer le
projet ; **Fermer le projet** déconnecte les conversations inactives sans modifier aucun fichier.

La barre latérale affiche alors les espaces du projet : **Parcours**, **Conversation**, **Livrables**, **À propos**,
ainsi que les espaces déclarés par le kit (unités ou scénarios, sources, application, coûts).

## 3. Configurer le projet

La première étape de la plupart des kits configure le projet : Vibe Studio ouvre le formulaire de configuration (nom
du projet, langue, dossier de travail…) avant de lancer l’IA. Le fichier qu’il écrit, souvent `project.yml`, reste
dans le projet.

## 4. Lancer une étape

1. Dans **Parcours**, la ligne mise en évidence est l’étape à traiter maintenant. Choisir **Préparer**.
2. La boîte de dialogue de lancement présente ce que fait l’étape, son agent, le modèle, la fenêtre de contexte et,
   lorsqu’il est pris en charge, l’effort de raisonnement. Choisir parmi les modèles déclarés par le kit.
3. Ajouter des pièces jointes si nécessaire (captures d’écran, documents) : elles sont copiées dans le projet et
   transmises à l’IA.
4. Confirmer. Vibe Studio ouvre une nouvelle session du harness et l’affiche dans **Conversation**.

## 5. Suivre et valider

- Répondre aux **questions** et aux **demandes d’autorisation** de l’IA dans Conversation (autoriser une fois,
  autoriser pour l’étape, ou refuser avec un motif). Un signal sonore et une notification Windows signalent que l’IA
  attend.
- À la fin de l’étape, ouvrir ses livrables. Lorsque le kit le demande, les **valider** : l’étape devient validée et
  le parcours met en évidence la suivante.

Suite : découvrir le [Parcours](./journey) en détail.
