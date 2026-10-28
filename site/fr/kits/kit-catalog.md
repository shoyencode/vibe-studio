---
title: Catalogue officiel
description: Configurer le catalogue officiel de kits, y soumettre des kits et les installer depuis ce catalogue.
---

# Catalogue officiel de kits

L’application et le catalogue de kits sont des dépôts indépendants. Un kit ne devient officiel qu’après la revue et
la fusion de sa soumission par un mainteneur. L’atelier ne fusionne jamais ses propres pull requests.

## Configurer un catalogue

Copier `catalog-template/` dans un dépôt GitHub dédié, suivre son README et configurer les règles du dépôt pour
exiger l’approbation d’un mainteneur et une validation avant toute fusion. Publier le catalogue avant de l’activer
dans l’application. Renseigner `vibeStudio.kits.repository` dans `package.json` avec son nom public
`owner/repository`. Sans ce réglage, **Kits officiels** indique que le catalogue n’est pas configuré ; la création
locale et le partage par ZIP ou Git restent possibles. Cette modification ne crée ni ne publie automatiquement de
dépôt GitHub.

Le modèle conserve l’`index.json` publié sur une branche dédiée `catalog-index`, et non sur la branche source
protégée. Initialiser cette branche et protéger l’environnement `catalog-publish` par une approbation manuelle
obligatoire, comme décrit dans son README. Le client lit la branche publiée ; la fusion seule d’une source non
relue ne doit pas publier de kit. Le workflow ne contourne pas la protection de la branche source pour y committer
les index générés.

L’application lit `index.json` de façon anonyme. Le dépôt, l’index et les ressources des versions publiées doivent
être lisibles publiquement. Aucun identifiant GitHub personnel n’est utilisé pour parcourir ou télécharger les kits.
Les dépôts privés, les limites de débit, les index invalides et les téléchargements échoués produisent des erreurs
explicites. Les entrées en cache sont signalées comme telles.

Chaque entrée identifie le kit, la version, le protocole et la version minimale de l’application, la licence, le
mainteneur, la ressource de version publiée, la taille et l’empreinte SHA-256. L’application vérifie les octets
téléchargés avant l’extraction ou l’installation. Une somme de contrôle protège contre des octets corrompus, pas
contre un compte de publication compromis. La revue manuelle n’est pas un bac à sable : les scripts des kits
installés s’exécutent avec les permissions de l’utilisateur sur le projet.

## Soumettre pour revue

Ouvrir le kit dans l’atelier, vérifier que l’en-tête le signale prêt, puis choisir **Partager…** dans le menu ⋯ et
**Proposer au catalogue officiel**. L’interface et une confirmation native expliquent les opérations distantes. La
soumission nécessite la GitHub CLI fournie ou installée et sa propre connexion GitHub, indépendante du harness IA
choisi.

L’application utilise une copie de travail temporaire isolée pour créer une fourche (fork) du catalogue, créer une
branche, committer le kit, pousser et ouvrir une pull request. Elle ne committe ni ne pousse dans le dépôt source de
l’auteur. Le lien renvoyé ouvre la demande de revue. Les mainteneurs vérifient la licence, les secrets, le contenu
exécutable, les instructions, les garde-fous, la compatibilité du contrat et le comportement réel avant de fusionner.
Le modèle de catalogue automatise l’empaquetage après la revue, pas l’approbation elle-même.

## Installer et mettre à jour

L’installation copie les skills du kit vers `.agents/skills`, les agents vers `.github/agents` et les règles vers
`.github/instructions`. Elle enregistre la source, la version et les empreintes des fichiers installés dans
`.agents/vibe-studio-kit.json`. Un seul kit est pris en charge par projet. Les fichiers non gérés en conflit ne sont
pas remplacés silencieusement. Le même installateur gère les tests de l’atelier, les imports et les paquets officiels.

Seules les installations gérées par le catalogue font l’objet de vérifications automatiques des mises à jour, à
l’ouverture du projet et au plus une fois par jour. Une version corrective compatible plus récente est installée
automatiquement quand aucun tour IA du projet, aucune étape en pause, aucune session de rédaction ni aucun service du
projet n’est actif. Les mises à jour correctives différées sont retentées quand l’application est inactive. Les
versions mineures et majeures exigent une confirmation explicite. Des fichiers du kit modifiés localement bloquent le
remplacement automatique ; leur remplacement exige lui aussi une confirmation explicite.

Avant de remplacer des fichiers gérés, Vibe Studio en conserve une sauvegarde sous
`%APPDATA%\Vibe Studio\kit-backups`. Les mises à jour ne remplacent que les ressources suivies du kit. Elles ne
réécrivent ni la configuration du projet, ni les documents sources, ni les livrables, ni les validations, ni les
préférences de l’utilisateur. Un journal local des mises à jour enregistre la version et indique si la mise à jour
était automatique. Le kit précédent reste disponible dans la sauvegarde.

Un protocole ou une version minimale de l’application incompatible n’est pas proposé. Mettre d’abord à jour
l’application. Les installations par ZIP, locales ou Git ne sont pas redirigées silencieusement vers le catalogue
officiel.
