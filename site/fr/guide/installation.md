---
title: Installation
description: Installer Vibe Studio sous Windows avec l’installeur ou la version portable, puis se connecter à un harness.
---

# Installation

## Prérequis

- Windows 10 22H2 ou Windows 11, x64.
- Un compte GitHub Copilot, Claude, OpenAI ou Gemini pour le harness prévu.
- Avec l’installeur, ni droits administrateur, ni Python système, ni Node.js ne sont nécessaires.

## Installeur Windows (recommandé)

1. Télécharger `Vibe-Studio-Setup-X.Y.Z-x64.exe` depuis la [dernière version](https://github.com/shoyencode/vibe-studio/releases/latest).
2. L’exécuter. Il s’installe pour l’utilisateur courant dans `%LOCALAPPDATA%\Programs\Vibe Studio`, sans droits administrateur.
3. Choisir les composants :
   - L’**application** comprend toujours Electron, le runtime Copilot, un Python privé avec `pyyaml` et
     `jsonschema`, et GitHub CLI pour la connexion personnelle.
   - **Git** (avec Git Bash) et **Microsoft APM** sont cochés par défaut.
   - **Claude Code**, **Codex** et **Gemini** sont facultatifs et décochés.
   - **Application seule, hors ligne** installe le socle sans aucun téléchargement.
4. Vérifier les choix et suivre les phases de préparation. Les outils facultatifs nécessitent Internet ; les outils
   compatibles déjà présents dans le PATH sont réutilisés, les outils manquants sont téléchargés, vérifiés et
   installés en privé.

L’installeur suit l’apparence claire ou sombre du système et est disponible en français et en anglais. Il ne modifie
jamais le PATH Windows, les outils existants, les projets ni les comptes personnels. Le résultat est enregistré dans
`setup\installation-result.txt` sous l’application installée.

::: tip Ajouter un outil plus tard
Relancer l’installeur et cocher l’outil. Décocher un outil déjà installé ne le supprime pas.
:::

::: warning SmartScreen
L’installeur n’est pas signé avec un certificat de signature de code : Windows peut afficher un avertissement SmartScreen.
:::

## Version portable

Télécharger `Vibe-Studio-X.Y.Z-win32-x64.zip` depuis la même version, le décompresser n’importe où dans l’espace
utilisateur, puis lancer `Vibe Studio.exe`. La version portable inclut Electron et le runtime Copilot, mais ni Python
ni les autres CLI : installer Python 3.11+ avec `pyyaml` et `jsonschema`.

La version portable ajoute un raccourci *Vibe Studio* au menu Démarrer pour que Windows puisse afficher ses
notifications. Fermer toutes les copies en cours d’exécution avant de remplacer le dossier.

## Se connecter à un harness

Ouvrir **Vibe Studio tools** depuis le menu Démarrer : un terminal s’ouvre avec les outils privés de Vibe Studio.
Se connecter ensuite au harness utilisé :

| Harness | Commande |
| --- | --- |
| GitHub Copilot CLI | `gh auth login` (une connexion Copilot existante fonctionne aussi) |
| Claude Code | `claude auth login` |
| Codex CLI | `codex login` |
| Gemini CLI | `gemini`, puis `/auth` |

Il est aussi possible de se connecter depuis l’application : **Réglages › Harness › Se connecter…** ouvre la commande
officielle dans un terminal visible, puis **Vérifier la connexion** actualise le compte. Les identifiants ne
transitent jamais par l’interface. Voir [Harness](./harnesses).

## Désinstallation

Désinstaller depuis **Paramètres › Applications** de Windows. Le programme de désinstallation supprime ses propres
fichiers et raccourcis. Il conserve les outils externes réutilisés, les projets, les identifiants et le profil dans
`%APPDATA%\Vibe Studio`.

Suite : [ouvrir un premier projet](./getting-started).
