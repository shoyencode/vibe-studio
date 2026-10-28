---
title: "Tutoriel : un premier kit"
description: Créer un kit d’audit d’accessibilité à partir d’une description de mission, relire les propositions de l’IA, le traduire et le tester dans un projet.
---

# Tutoriel : un premier kit

Ce tutoriel construit un kit pour un **audit d’accessibilité d’un site web**, sans écrire de JSON. La mission
est décrite, l’IA rédige le brouillon du kit, et la décision de ce qui y entre reste humaine.

Prérequis : Vibe Studio avec un [harness connecté](../guide/harnesses). Une quinzaine de propositions sont à relire.

## 1. Décrire la mission

Ouvrir **Atelier de kits** dans la barre latérale.

<Shot name="workshop-start" alt="L’écran Créer un kit avec le nom du kit, la mission et le bouton Préparer le brouillon" />

1. Choisir l’exemple **Audit** : il remplit une mission à adapter. Ou rédiger la sienne, comme pour briefer un collègue :

   > Réaliser un audit d’accessibilité d’un site public. Cadrer le périmètre avec le client, analyser chaque page de
   > l’échantillon, puis rédiger un rapport avec les corrections prioritaires. Le client valide la note de cadrage et le rapport final.

2. Donner un nom au kit, par exemple *Audit d’accessibilité*.
3. Il est possible d’ouvrir **Options** pour joindre des documents de référence (un exemple de rapport, une liste
   de contrôle), choisir la langue de rédaction ou le dossier du kit. Par défaut, le kit est placé dans `Documents\Vibe Studio\Kits`.
4. Choisir **Préparer le brouillon**.

Les identifiants, les dossiers et l’étape de configuration du projet sont générés automatiquement.

## 2. Suivre la préparation

L’IA lit la mission et publie son plan sous forme d’une courte liste de tâches. Elle ne fait que **lire** le kit :
elle ne peut ni écrire de fichiers ni exécuter de commandes. Si elle a besoin d’une réponse, sa question apparaît sur cet écran.

<Shot name="workshop-preparing" alt="L’écran de préparation avec la liste de tâches de l’IA" />

Rien n’est enregistré dans le kit avant la relecture. Il est possible de mettre en pause, ou de revenir au kit et de reprendre plus tard.

## 3. Relire les propositions

Les propositions arrivent une par une : la présentation du kit, chaque étape avec ses documents, sa répétition et
ses validations, les instructions pour l’IA, les règles de sécurité. À droite, le kit prend forme.

<Shot name="workshop-review" alt="Une proposition avec les colonnes avant et après et les boutons Accepter, Modifier et Refuser" />

Pour chaque proposition :

- l’**Accepter** telle quelle ;
- la **Modifier** — changer le titre, les documents ou les instructions — puis accepter cette version ;
- la **Refuser** ;
- ou **Demander une autre proposition**.

Les propositions acceptées sont enregistrées immédiatement et laissent toujours le kit valide. **Terminer plus tard**
garde le reste pour une autre fois ; un bandeau dans le kit permet d’y revenir.

::: tip Une étape qui se répète
Quand une étape se répète « pour chaque page », le kit reçoit un **élément répété** (ici, *page*). Dans un projet,
chaque page reçoit son propre dossier et l’étape s’exécute une fois par page.
:::

## 4. Vérifier le récapitulatif

<Shot name="workshop-summary" alt="Le récapitulatif de la relecture avec le nombre de propositions acceptées et refusées, la traduction et la vérification" />

Le récapitulatif compte les propositions acceptées et refusées, liste les textes restant à traduire et indique le
résultat de la vérification du kit. *Prêt à tester* signifie que le contrat et ses fichiers sont valides.

## 5. Traduire

Les textes du kit sont rédigés une seule fois, dans la langue de rédaction. Choisir **Préparer la traduction** :
l’IA traduit chaque texte, et la validation se fait côte à côte.

<Shot name="workshop-translation" alt="Texte source et traduction de l’IA côte à côte avec Valider la traduction" />

Modifier la traduction si nécessaire, puis **Valider la traduction**, ou **Passer** un texte. Quand un texte source
est modifié par la suite, ses traductions sont marquées *À mettre à jour*. Les instructions pour l’IA restent dans la
langue de rédaction : dans un projet, l’IA répond dans la langue du projet.

## 6. Affiner une étape

Ouvrir le kit. Le plan liste la présentation et le parcours ; chaque étape dispose d’une page simple.

<Shot name="workshop-kit" alt="La vue du kit avec le plan et la page d’une étape" />

Modifier le titre, ce que fait l’étape, le résultat attendu, les documents qu’elle utilise et produit, sa répétition
éventuelle et la validation de ses documents par l’utilisateur. Les champs sont enregistrés dès qu’ils sont quittés.
**Demander à l’IA d’améliorer cette étape** ouvre une nouvelle série de relecture pour cette seule étape.

Le sélecteur **Langue** de l’en-tête affiche le kit tel que le verront les utilisateurs d’une autre langue.
**Expert** affiche les réglages techniques et le contrat brut, pour les développeurs.

## 7. Le tester dans un projet

Choisir **Tester dans un projet** et sélectionner un dossier de test vide. Vibe Studio installe une copie validée du
kit et ouvre le projet : le parcours est là, prêt pour sa première étape.

## 8. Le partager

Dans le menu **⋯**, **Partager…** exporte un fichier ZIP, ou propose le kit au
[catalogue officiel](./kit-catalog) pour une revue manuelle.

Ensuite : tout ce que permet l’atelier, et l’écriture d’un kit à la main, dans [Créer un kit](./creating-a-kit).
