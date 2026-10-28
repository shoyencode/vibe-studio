---
title: Créer un kit
description: Créer un kit dans l’atelier, ou écrire à la main son paquet, son contrat et ses skills.
---

# Créer un kit pour Vibe Studio

Un kit est un paquet APM de skills, d’agents et de règles pour un type de mission (POC d’avant-vente, audit, migration…), accompagné d’un contrat qui permet à Vibe Studio de le piloter. Le kit de démonstration (`test/fixtures/demo`) est le plus petit exemple complet : le copier, puis suivre ces étapes. Un kit n’inclut pas l’application et ne nécessite pas de copie de travail voisine.

## Atelier de kits dans l’application

Le bouton du projet permet de revenir à l’accueil sans fermer le projet. La barre latérale propose **Projets**,
**Atelier de kits** et **Kits officiels** ; **Fermer le projet** déconnecte les conversations inactives sans modifier
les fichiers du projet.

### Créer un kit à partir d’une mission

Dans **Atelier de kits**, donner un nom au kit et décrire sa mission comme à un collègue : objectif, déroulé
souhaité, personnes impliquées, documents validés par l’utilisateur. Les exemples (démonstration de faisabilité,
audit, migration) remplissent une mission de départ. Les options permettent de joindre des documents de référence
pour le premier brouillon (ils ne sont pas copiés dans le kit), de choisir la langue de rédaction et le dossier du
kit (par défaut `Documents\Vibe Studio\Kits\<name>`). Les identifiants, les noms de skills, les dossiers et l’étape
de configuration du projet sont générés : aucun choix technique n’est requis. **Créer sans l’IA** crée le même kit
de départ sans brouillon.

**Préparer le brouillon** envoie la mission au harness IA sélectionné dans les Réglages, avec le modèle affiché
sous le formulaire. L’IA ne fait que lire le kit : elle ne peut ni écrire de fichiers ni exécuter de commandes. Elle
publie une courte liste de tâches et soumet des propositions structurées : présentation du kit, étapes avec leurs
documents, leur répétition et leurs validations, instructions des étapes, règles de sécurité. Chaque proposition est
vérifiée par rapport au kit avant d’être mise en file d’attente. Les questions de l’IA apparaissent sur l’écran de
préparation ; la mise en pause et la reprise conservent la même session.

### Relire les propositions

Rien n’entre dans le kit avant la relecture. Les propositions sont présentées une par une avec une comparaison
avant/après et le kit qui prend forme à côté. **Accepter**, **Modifier** puis accepter, **Refuser**, ou **Demander une
autre proposition**. Les propositions acceptées sont enregistrées immédiatement et laissent le kit valide ; les
propositions refusées ne sont pas appliquées. **Terminer plus tard** conserve les propositions en attente ; un bandeau
dans le kit permet d’y revenir. Le récapitulatif compte les propositions acceptées et refusées, liste les textes
restant à traduire et indique le résultat de la vérification du kit.

### Affiner le kit

La vue du kit comporte un plan (présentation et langues, puis le parcours) et une page simple par étape : titre,
ce que fait l’étape, résultat attendu, documents utilisés et produits, répétition pour chaque élément répété,
validation par l’utilisateur et instructions pour l’IA. Les modifications sont enregistrées dès qu’un champ est
quitté. **Demander à l’IA d’améliorer cette étape** ouvre une nouvelle série de relecture pour cette étape. Quand la
vérification du kit signale des problèmes, **Corriger avec l’IA** propose les corrections les plus réduites.

### Langues

Les textes sont rédigés une seule fois dans la langue de rédaction. Les autres langues du kit sont traduites par
l’IA, puis relues côte à côte, texte par texte : valider, modifier ou passer. Une traduction passe à « À mettre à
jour » quand son texte source change. Les instructions pour l’IA restent dans la langue de rédaction ; l’IA du projet
répond dans la langue du projet. Le sélecteur de langue de l’en-tête affiche le kit tel que le verront les
utilisateurs d’une autre langue.

### Mode expert

**Expert** ajoute les réglages techniques : identifiants des étapes, skills, agents, portée, fichiers requis et
produits, règles des étapes et contrôles de fin, configuration du projet, livrables, modules, règles de sécurité et
politiques de modèles, ainsi que le `vibe-studio.json` brut avec une vérification en direct. Rien d’invalide n’est
enregistré. Les métadonnées de rédaction sont conservées dans `.apm/vibe-studio-authoring.json` : elles accompagnent
les exports ZIP mais ne sont jamais installées dans les projets.

### Tester et partager

**Tester dans un projet** installe une copie validée dans un projet choisi, puis l’ouvre. **Partager…** (dans le menu
⋯) exporte un ZIP ou propose le kit au catalogue officiel. Il est possible d’ouvrir un dossier de kit existant,
d’importer un ZIP ou un dépôt Git depuis l’écran de départ ; les kits récents y restent listés. Les imports Git
nécessitent Git ; l’authentification aux dépôts reste gérée par l’environnement Git existant. Les commits et les push
Git vers des dépôts internes restent en dehors de Vibe Studio. La publication officielle et le comportement des mises
à jour sont décrits dans [Catalogue officiel](kit-catalog.md).

Les hooks qui maintiennent l’IA en lecture seule sont des garde-fous, pas un bac à sable du système d’exploitation.
Relire les instructions générées avant d’utiliser ou de partager un kit ; ne pas y placer d’identifiants ni de
données client.

## 1. Paquet

1. `apm.yml` à la racine du kit : `name` (l’identifiant du kit), `version`, `description`, `license`, dépendances.
2. Les skills sous `.apm/skills/<skill>/SKILL.md`, les agents sous `.apm/agents/<agent>.agent.md`, les règles sous `.apm/instructions/`. Utiliser le format d’en-tête (front matter) APM.
3. Une skill d’entrée configure le projet. Elle contient `assets/vibe-studio.json`, le schéma et le modèle du fichier de configuration.
4. Déclarer un modèle disponible dans l’en-tête de l’agent. Le kit gère ses choix de modèles de façon indépendante ; Vibe Studio n’exige ni catalogue de modèles particulier ni script de génération.

## 2. Contrat

Écrire `assets/vibe-studio.json` (voir la [référence du contrat](./vibe-studio-contract)) :

1. `kit`, puis `config` : fichier de configuration, schéma, modèle, pointeurs vers la langue, le titre et les chemins, espaces réservés.
2. `units` si une étape se répète par unité de travail (scénario, thème, lot).
3. `steps` dans l’ordre du parcours. La première a généralement `configures: true`.
4. Les groupes `deliverables` pour la vue Livrables.
5. Uniquement les `modules` réellement utilisés par le kit. Suivre les formats documentés dans le contrat (listes de tâches, séries de relecture), ou omettre le module.

Le valider avec `core/schema/vibe-studio.schema.json`. `npm run test:bridge` valide les deux contrats de référence fournis et leurs ressources livrées ; ajouter le kit de la même façon. Le nom de fichier pris en charge est `vibe-studio.json` avec la version de protocole 2.

Pour les modèles d’IA sélectionnables, générer `modelPolicies` à partir de la propre source de routage des modèles du
kit, en conservant les valeurs par défaut scalaires des agents. Prévoir deux ou trois candidats par profil et, si
nécessaire, des choix de relecture d’une famille opposée. Pour les scénarios déclarés avant que leurs dossiers
n’existent, livrer un `units.catalog.script` en lecture seule qui renvoie des identifiants stables et des titres
métier issus de la spécification. Les sections facultatives du contrat décrivent ces deux interfaces JSON. Migrer
ces sources dans le dépôt du kit ; ne pas créer de migration des projets client ni exiger d’une étape IA qu’elle
réécrive les spécifications existantes. Mettre à jour les schémas stricts des consommateurs avant de déployer ces
champs facultatifs.

## 3. Skills qui coopèrent avec Vibe Studio

1. Quand le contexte de lancement fournit un identifiant d’exécution (run id), appeler l’outil compatible `vibe_studio_report` après le chargement de la skill, avant chaque question, à chaque changement de statut d’une tâche, et à la fin avec les chemins écrits.
2. Poser les questions avec `ask_user`, une question par appel. Ne jamais considérer un rapport comme une validation.
3. À un point de contrôle, une fois la validation de l’utilisateur obtenue, l’enregistrer avec le script de validation (`record --file … --language …`).
4. S’arrêter à la fin de l’étape et nommer la suivante.

## 4. L’essayer

1. Installer le kit dans un dossier de test avec APM (`apm install` avec le kit comme dépendance par chemin), ou copier `.apm/skills` vers `.agents/skills` et `.apm/agents` vers `.github/agents`.
2. Ouvrir le dossier dans Vibe Studio : le parcours, les unités et les livrables proviennent du contrat.
3. Dans le dépôt de l’application, exécuter ses tests du moteur et du pont avec les kits de référence de test, d’abord avec un harness factice, puis sur une étape réelle. Exporter ou installer une version figée du kit pour ces kits de test ; ne rendre aucun des deux dépôts dépendant d’une copie de travail voisine.
