---
title: Données et confidentialité
description: Où Vibe Studio conserve ses données, et ce qu’il ne fait jamais avec celles de l’utilisateur.
---

# Données et confidentialité

| Donnée | Emplacement |
| --- | --- |
| Préférences, projets récents, journaux des étapes | `%APPDATA%\Vibe Studio` |
| Configuration du projet, livrables, validations, pièces jointes | le dossier du projet |
| Application installée et outils privés | `%LOCALAPPDATA%\Programs\Vibe Studio` |
| Identifiants des harness | le stockage propre du harness — jamais Vibe Studio |

- Vibe Studio n’inspecte ni n’importe jamais le profil ou le journal d’une autre application.
- Les fichiers collés en zone de transit sont supprimés à la fermeture normale de l’application ; les copies dans le
  projet restent.
- Les métriques de la discussion libre restent en mémoire pour la fenêtre ; les métriques des étapes sont conservées
  dans le journal local.
- Les vérifications de mise à jour lisent l’API publique de GitHub de manière anonyme ; aucun token n’est demandé ni
  réutilisé.
- L’atelier de kits envoie les documents de référence à l’IA pour le premier brouillon uniquement ; ils ne sont pas
  copiés dans le kit.

## Profil isolé

Pour essayer Vibe Studio sans toucher au profil existant, le lancer avec un dossier de données explicite :

```powershell
"Vibe Studio.exe" --user-data-dir="C:\Temp\vibe-studio-profile"
```

Sauvegarder `%APPDATA%\Vibe Studio` avant une mise à niveau.

::: warning Données client
Les kits sont faits pour être partagés. Ne pas mettre d’identifiants ni de données client dans un kit, et relire les
instructions générées avant de le partager.
:::
