---
title: Conversation
description: Suivre l’IA, répondre aux questions et aux demandes d’autorisation, utiliser Autopilot, mettre en pause et reprendre, joindre des fichiers.
---

# Conversation

Conversation affiche la session active : les messages et les outils de l’IA, ses questions et ses demandes
d’autorisation, et une zone de message. Lorsque l’IA attend, une notification et une marque sur **Conversation** le
signalent, quel que soit l’espace affiché.

## Questions et autorisations

- Les **questions** listent les choix de l’IA ; y répondre d’un clic, ou par un texte libre lorsque c’est permis.
- Les **autorisations** sont demandées avant une écriture ou une commande : **Autoriser** (une fois), **Autoriser
  pour cette étape**, ou **Refuser** avec un motif.
- Les confirmations des garde-fous (voir [Garde-fous](./guards)) sont toujours demandées, quels que soient les
  interrupteurs ci-dessous.

## Discussion libre

**Nouvelle discussion** ouvre une session dans le projet en dehors du parcours : choisir l’agent et le modèle.
Les garde-fous permanents s’appliquent ; il n’y a ni étape ni rapport.

## Autopilot et Approve All

- **Autopilot** s’applique à toutes les sessions tant qu’il est activé : les outils sont autorisés et les questions
  traitées sans intervention de l’utilisateur, sauf les confirmations imposées par les garde-fous. L’IA a pour
  consigne de ne jamais enregistrer une validation à la place de l’utilisateur.
- **Approve All** (lorsqu’Autopilot est désactivé) autorise les outils automatiquement et laisse les questions à
  l’utilisateur.

Les deux conservent les refus des garde-fous et les confirmations requises.

## Mettre en pause, reprendre, arrêter

**Mettre en pause** interrompt le tour en cours de l’IA, annule les demandes sans réponse sans les accepter et
conserve la même session, le même contexte, les mêmes fichiers, le brouillon et les métriques. **Reprendre** apparaît
une fois la pause confirmée par le harness, et demande à l’IA de continuer à partir des fichiers actuels sans répéter
les actions terminées.

Les actions déjà effectuées ne sont pas annulées, et les services indépendants du projet ne sont pas mis en pause. Si
le harness ne confirme pas dans les 30 secondes, une erreur explicite invite à réessayer ou à arrêter l’étape. La
reprise dans la même session fonctionne tant que Vibe Studio reste ouvert ; après un redémarrage, la session est
marquée comme interrompue.

## Pièces jointes

Choisir des fichiers, les déposer sur la zone de message, ou coller une image. Jusqu’à 10 fichiers de 25 Mo chacun ;
ils sont copiés à côté du scénario ou sous `<root>/attachments/` et envoyés au harness. Les brouillons sont conservés
lors des changements de vue.

## Métriques

Un rail à côté des messages (au-dessus d’eux sur les fenêtres étroites) affiche le modèle, la fenêtre de contexte, la
capacité et l’occupation lorsqu’elles sont communiquées, les tokens cumulés en entrée et en sortie, l’utilisation du
cache et les crédits IA, sous-agents compris. La consommation n’est pas la taille actuelle du contexte. Une valeur
manquante indique *Non communiqué*, jamais une estimation.

## Anciennes conversations

La dernière session reste visible ; les plus anciennes se trouvent dans une section **Anciennes conversations**
repliable. Ce choix est mémorisé.
