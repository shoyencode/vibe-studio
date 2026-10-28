---
title: Mises à jour
description: Comment Vibe Studio recherche, télécharge et installe des mises à jour vérifiées.
---

# Mises à jour

**À propos** et **Projets** proposent **Rechercher une mise à jour**. Les copies packagées vérifient aussi au
démarrage, au plus une fois par jour ; une vérification automatique en échec reste visible sans interrompre le travail.

## Installer une mise à jour

Les copies installées proposent **Télécharger l’installeur vérifié**, puis **Fermer et installer** après une
confirmation native. Seules des versions stables et plus récentes sont proposées — jamais de brouillons, de
préversions ni de versions plus anciennes.

L’installeur est téléchargé en HTTPS depuis GitHub uniquement ; sa taille et son empreinte `sha256` sont comparées à
celles de la version publiée, puis vérifiées à nouveau avant son exécution. Une empreinte manquante bloque
l’installation. Vibe Studio refuse d’installer tant qu’une étape, un tour d’IA ou un service du projet est actif ;
enregistrer d’abord les brouillons non envoyés. Le profil est préservé.

Les copies portables renvoient vers la version publiée au lieu de s’installer par-dessus leur dossier.

::: info Ce que protège la somme de contrôle
Elle protège contre un téléchargement corrompu, pas contre un compte de publication compromis.
:::

## Mises à jour des kits

Les kits installés depuis le catalogue officiel reçoivent automatiquement les mises à jour correctives lorsque le
projet est inactif. Les mises à jour mineures, majeures et celles des kits modifiés localement demandent une
confirmation et conservent une sauvegarde. Voir [Catalogue officiel](../kits/kit-catalog).
