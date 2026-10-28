---
title: Updates
description: How Vibe Studio checks, downloads and installs verified updates.
---

# Updates

**About** and **Projects** offer **Check for updates**. Packaged copies also check at startup and at most once
a day; a failed automatic check stays visible without interrupting your work.

## Installing an update

Installed copies offer **Download verified installer**, then **Close and install** after a native
confirmation. Only stable, newer versions are proposed — never drafts, prereleases or older versions.

The installer is downloaded over HTTPS from GitHub only, its size and `sha256` digest are checked against the
release, and checked again before it runs. A missing digest blocks installation. Vibe Studio refuses to install
while a step, an AI turn or a project service is active; save unsent drafts first. Your profile is preserved.

Portable copies link to the release instead of installing over their folder.

::: info What the checksum protects
It protects against a corrupted download, not against a compromised publishing account.
:::

## Kit updates

Kits installed from the official catalog receive patch updates automatically when the project is idle.
Minor, major and locally modified updates ask for confirmation and keep a backup. See
[Official catalog](../kits/kit-catalog).
