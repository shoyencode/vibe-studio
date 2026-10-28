---
title: Garde-fous
description: Les règles du kit appliquées avant que l’IA agisse, les contrôles de fin d’étape et la suspension d’un garde-fou.
---

# Garde-fous

Les garde-fous sont les règles du kit, imposées à l’IA par Vibe Studio plutôt que demandées à l’IA. Avant chaque
écriture, commande ou skill que le harness demande à exécuter, Vibe Studio contrôle les garde-fous. Une action bloquée
est refusée avant son exécution, et l’IA reçoit le motif ainsi que la marche à suivre à la place. Les lectures ne sont
jamais bloquées, et un garde-fou ne valide jamais rien : les autorisations de l’utilisateur restent en vigueur.

## Ce qu’un kit peut protéger

| Garde-fou | Effet |
| --- | --- |
| Fichiers en lecture seule | Aucun outil ni aucune commande shell n’écrit dans ces chemins. |
| Fichiers réservés aux scripts | Seuls les scripts nommés du kit écrivent dans ces chemins (par exemple les validations). |
| Aucun nouveau fichier | Les fichiers existants restent modifiables ; aucun nouveau fichier correspondant aux chemins. |
| Tâche en cours | Écrire dans ces chemins nécessite une tâche marquée en cours. |
| Une tâche à la fois | L’IA ne peut pas déclarer une deuxième tâche en cours. |
| Secrets | Aucun contenu écrit ressemblant à un token, une clé privée ou un mot de passe. |
| Commandes confirmées | Les commandes shell correspondantes sont confirmées par l’utilisateur, même sous Autopilot. |
| Skills | Les skills des autres étapes sont refusés. |
| Sous-agents en lecture seule | Les sous-agents de l’étape se limitent à la lecture. |
| Historique | Avant la réécriture d’un fichier, une copie numérotée est conservée. |
| Contrôles de fin | Lorsque l’IA termine son tour : rapport final, aucune tâche laissée en cours, fichier modifié, état du plan, revue tranchée. Un contrôle en échec renvoie l’IA au travail avec les motifs, deux fois au plus, puis alerte l’utilisateur. |

Le format complet figure dans la [référence du contrat](../kits/vibe-studio-contract#guards).

## Où les voir

- Une action bloquée apparaît en orange dans Conversation et sous l’entrée du registre de l’étape en cours.
- La case **Garde-fous** de la bande du Parcours compte les blocages.
- **Réglages › Projet et kit › Garde-fous** liste les règles, les actions bloquées et les contrôles de fin. Il est
  possible de **suspendre** un garde-fou jusqu’à la fin de l’étape lorsque l’utilisateur le décide ; chaque
  changement est conservé dans le journal.

::: warning Limites
La détection des écritures shell est faite au mieux. Les actions qu’un harness exécute sans demander (surtout des
lectures) échappent aux garde-fous, et les sessions ouvertes en dehors de Vibe Studio ne sont pas protégées. Les
garde-fous sont des garde-corps, pas un bac à sable du système d’exploitation.
:::
