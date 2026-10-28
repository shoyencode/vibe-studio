---
title: Tests et versions
description: Vérifications automatisées, intégration continue, conventions de commit et de journal des modifications, et processus de publication des versions.
---

# Tests et versions

## Vérifications

Exécuter les plus petites vérifications couvrant une modification. Avant une version ou une modification touchant plusieurs surfaces, exécuter :

```powershell
npm test               # Node regressions
npm run test:bridge    # Python bridge regressions
npm run test:smoke     # desktop smoke with a fake harness
npm run test:workshop  # kit workshop smoke
npm run package
npm run test:portable  # real portable executable
```

Les quatre adaptateurs de harness sont couverts avec des clients factices : aucune vérification n’envoie de requête
à une IA ni ne consomme de crédits. Les smoke tests utilisent des profils temporaires, jamais le profil réel ni le menu
Démarrer. Définir `VIBE_STUDIO_SMOKE_ARTIFACTS` sur `dist\test-artifacts` pour conserver les captures d’écran, et les
examiner avant de les partager : elles peuvent contenir des chemins locaux.

Après l’empaquetage, définir `VIBE_STUDIO_SMOKE_APP` sur le chemin absolu `dist\Vibe Studio-win32-x64\resources\app`
et relancer les smoke tests pour éprouver les modules empaquetés.

## Intégration continue

[GitHub Actions](https://github.com/shoyencode/vibe-studio/actions) s’exécute sur les pull requests, les push sur
`main`, les tags de version et le déclenchement manuel :

1. Régressions Node et Python sous Ubuntu et Windows, ainsi que la construction du site web.
2. Sous Windows : smoke tests du bureau et de l’atelier, construction de l’installateur et de la version portable,
   smoke tests de l’application empaquetée, exécutable portable réel et préservation des données lors de
   l’installation, de la réinstallation et de la désinstallation.
3. Sur un tag `vX.Y.Z` : une release GitHub avec l’installateur et le ZIP portable vérifiés, puis ce site,
   construit à partir du commit tagué et publié sur GitHub Pages.

Le site décrit ainsi toujours la version téléchargeable. Pour publier une correction de documentation entre
deux versions, lancer manuellement le workflow **pages** depuis l’onglet Actions.

## Commits et journal des modifications

- Les messages de commit sont en anglais : `<type>(<scope>): <summary>`, avec les types `feat`, `fix`, `docs`,
  `refactor`, `test`, `ci`, `chore`, `release`.
- Chaque modification visible reçoit un élément sous `## Unreleased` dans `CHANGELOG.md`, dans la même modification.
- Les modifications incompatibles vont sous *Changed (breaking)* avec une section de migration.

## Versions

Les versions suivent le Semantic Versioning (avant 1.0.0, une fonctionnalité augmente la version mineure).

1. Renommer `## Unreleased` en `## X.Y.Z` et mettre à jour `package.json` et `package-lock.json` ensemble.
2. Exécuter toutes les vérifications, y compris l’empaquetage Windows et le smoke test de l’exécutable portable réel.
3. Committer `release: vibe-studio X.Y.Z`, puis créer le tag annoté `vX.Y.Z` avec le message `Vibe Studio X.Y.Z`.
4. Pousser le tag publie automatiquement la version une fois la CI réussie. Un tag publié n’est jamais déplacé.

Les mises à jour de l’application détectent les versions publiées dont les ressources sont nommées
`Vibe-Studio-Setup-X.Y.Z-x64.exe` avec une empreinte `sha256` ; voir [Mises à jour](../guide/updates).
