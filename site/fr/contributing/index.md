---
title: Construire depuis les sources
description: Préparer un environnement de développement, lancer Vibe Studio depuis les sources et construire la version portable et l’installateur.
---

# Construire depuis les sources

Vibe Studio est une application Electron open source sous licence MIT. Les contributions suivent
[CONTRIBUTING.md](https://github.com/shoyencode/vibe-studio/blob/main/CONTRIBUTING.md) ; trois règles priment :

1. Aucune donnée client, aucun secret ni aucun identifiant dans les sources, les tests, les exemples ou les captures d’écran.
2. Garder l’application autonome : aucune copie de travail de kit voisine, aucun chemin propre à un développeur ni aucun profil utilisateur réel dans les tests.
3. Valider le comportement, pas des suppositions. Préserver les contrats des kits déployés et les données utilisateur existantes.

## Organisation du dépôt

| Chemin | Contenu |
| --- | --- |
| `app/` | Processus principal Electron, preload, interface de bureau et préférences locales |
| `core/` | Contrôleur de projet, pont Python, garde-fous, journal, rendu Markdown, traductions, schéma du contrat |
| `core/adapters/` | Adaptateurs des harness Copilot, Claude Code, Codex et Gemini |
| `test/` | Régressions Node et Python avec des harness factices et des kits de référence de test sous licence |
| `scripts/` | Empaquetage, installateur et vérifications Electron isolées (smoke tests) |
| `docs/` | Documentation du contrat et de la création de kits, incluse dans ce site |
| `site/` | Ce site web (VitePress) |
| `catalog-template/` | Squelette du catalogue officiel de kits, publié séparément |

## Lancer depuis les sources

Prérequis : Node.js 22.12+ et Python 3.11+ (la CI utilise Node.js 24 et Python 3.12).

```powershell
npm ci
python -m pip install -r requirements.txt
npm start
```

Utiliser un profil isolé plutôt que le profil réel :

```powershell
npm start -- --user-data-dir="C:\Temp\vibe-studio-profile"
```

## Version portable

```powershell
npm run package
```

Sous Windows x64, la commande écrit `dist\Vibe Studio-win32-x64\Vibe Studio.exe` et un ZIP. Fermer d’abord les copies
portables en cours d’exécution : l’empaquetage refuse d’écraser un exécutable en cours d’utilisation.

## Installateur Windows

Prérequis : Windows x64, Node.js 22.12+, Python avec pip, et un accès à Internet pour préparer la distribution.

```powershell
npm ci
npm run installer:tools
npm run package:installer
npm run test:installer
```

`installer:tools` télécharge et vérifie un Inno Setup portable sous `dist\installer-cache`. La construction produit
`dist\Vibe Studio-Setup-<version>-x64.exe` avec un environnement Python figé et des wheels verrouillées par empreinte ;
les archives d’outils facultatifs sont figées avec leurs sommes de contrôle dans `scripts\installer\components.json`.

## Ce site web

```powershell
npm run site:dev          # live preview on http://localhost:5173/vibe-studio/
npm run site:build        # production build, fails on dead links
npm run site:screenshots  # regenerate application screenshots with the demo kit
```

Les pages se trouvent dans `site/` en anglais et dans `site/fr/` en français ; mettre à jour les deux langues
ensemble. Les pages de référence incluent `docs/*.md` au lieu de les copier, et la page Versions est générée à partir de `CHANGELOG.md`.
