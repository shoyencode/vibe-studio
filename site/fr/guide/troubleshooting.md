---
title: Dépannage
description: Réponses aux problèmes courants de connexion, de kits, d’étapes, de notifications et de mises à jour.
---

# Dépannage

## Le harness indique qu’il n’est pas connecté

Ouvrir **Réglages › Harness**, choisir **Se connecter…**, terminer la connexion dans le terminal, puis **Vérifier la
connexion**. Une connexion à une autre application de bureau, ou un token valide dans un seul terminal, ne garantit
pas que Vibe Studio dispose d’identifiants persistants.

## Le projet s’ouvre mais n’affiche aucun parcours

Le dossier nécessite un kit installé avec APM et un contrat à jour (`vibe-studio.json`, protocole 2). Mettre à jour les
anciens kits avec APM avant de les ouvrir. Les autres noms de fichier ou versions de protocole sont refusés sans
modifier aucun fichier du projet.

## Une étape ne peut pas être lancée

- *Prérequis à compléter* : les fichiers requis par l’étape n’existent pas encore ; lancer les étapes précédentes.
- L’étape est validée : utiliser **Rouvrir l’étape…** s’il faut vraiment la modifier.
- Le suivi des coûts a échoué : le kit n’a pas pu enregistrer son marqueur de coût, donc aucun prompt n’a été envoyé.
  Mettre à jour le kit.

## L’IA est bloquée par un garde-fou

C’est voulu : l’IA reçoit le motif. Si la règle doit être levée, suspendre le garde-fou jusqu’à la fin de l’étape dans
**Réglages › Projet et kit › Garde-fous**.

## La mise en pause ne se termine pas

La mise en pause attend la confirmation du harness. Après 30 secondes, une erreur invite à réessayer la mise en pause
ou à arrêter l’étape.

## Aucune notification Windows

Vérifier **Réglages › Alertes** et les paramètres de notification de Windows. La version portable a besoin de son
raccourci du menu Démarrer, créé automatiquement au premier lancement.

## SmartScreen signale l’installeur

L’installeur n’est pas signé. Vérifier qu’il provient des
[versions officielles](https://github.com/shoyencode/vibe-studio/releases).

## La recherche de mise à jour a échoué

Les échecs réseau, les limites de débit de l’API GitHub et les dépôts inaccessibles sont signalés explicitement.
Réessayer plus tard depuis **À propos**.

## Problème persistant ?

Ouvrir une [issue sur GitHub](https://github.com/shoyencode/vibe-studio/issues) avec la version (affichée sous
**Actualiser**) et les étapes pour reproduire le problème. Ne pas joindre de documents client ni de journaux contenant
des chemins privés.
