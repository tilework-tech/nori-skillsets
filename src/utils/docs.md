# Noridoc: utils

Path: @/plugin/src/utils

### Overview

Shared utility functions for the plugin package, containing URL normalization helpers for consistent URL formatting and path utilities for installation directory management and ancestor installation detection.

### How it fits into the larger codebase

This folder provides utilities used throughout the plugin package at multiple system boundaries. The normalizeUrl function is used in @/plugin/src/api/base.ts to construct API request URLs (combining organizationUrl from config with endpoint paths like /api/artifacts/create), in @/plugin/src/installer/config.ts to normalize user-provided organizationUrl values before saving to ~/nori-config.json, and is bundled into all paid skills (paid-memorize, paid-recall, paid-\*-noridoc, paid-prompt-analysis) by @/plugin/src/scripts/bundle-skills.ts since they import the API client. The identical implementation exists in @/ui/src/utils/url.ts for the web UI, maintaining consistent URL handling across all client packages.

The path.ts module provides installation directory utilities used by both the installer (@/plugin/src/installer/install.ts) and the nested-install-warning hook (@/plugin/src/installer/features/hooks/config/nested-install-warning.ts). The normalizeInstallDir function converts user-provided paths (tilde-prefixed, relative, or absolute) to absolute paths ending with `.claude`. The findAncestorInstallations function is used during installation and session start to detect conflicting Nori installations in parent directories, which would cause Claude Code to load duplicate or conflicting CLAUDE.md configurations due to its recursive parent directory loading behavior.

### Core Implementation

The url.ts module exports a single normalizeUrl function that accepts { baseUrl: string, path?: string | null } and returns a normalized URL. The function strips all trailing slashes from baseUrl using replace(/\/+$/, ''), handles optional path by ensuring it starts with exactly one leading slash, and concatenates them to prevent double slashes. Comprehensive test coverage in url.test.ts validates edge cases including multiple trailing slashes, empty paths, localhost URLs, and query parameters. The function follows the codebase style of named parameters and optional null types.

The path.ts module exports two functions: normalizeInstallDir and findAncestorInstallations. The normalizeInstallDir function accepts { installDir?: string | null } and returns an absolute path ending with `.claude`, handling tilde expansion (`~/` becomes home directory), relative path resolution, and path normalization. If no installDir is provided, it defaults to `{cwd}/.claude`. The findAncestorInstallations function accepts { installDir: string } and returns an array of paths to ancestor directories with Nori installations, ordered from closest to furthest. It uses the internal hasNoriInstallation helper to check each directory for installation markers: `.nori-config.json`, `nori-config.json` (legacy), or `.claude/CLAUDE.md` containing "NORI-AI MANAGED BLOCK".

### Things to Know

URL normalization happens at two critical points: (1) when users provide organizationUrl during installation (installer/config.ts line 137 normalizes before saving to ~/nori-config.json to ensure consistent storage format), and (2) when making API requests (api/base.ts line 105 combines the stored organizationUrl with endpoint paths like /api/artifacts/create). This prevents URL construction bugs from user input variations like "https://example.com/" vs "https://example.com" or paths with/without leading slashes. The utility is bundled into paid skills because esbuild inlines all dependencies when creating standalone executables, so the normalizeUrl code appears in every built skill script. The implementation is duplicated across @/plugin/src/utils/url.ts and @/ui/src/utils/url.ts rather than shared because the packages have different module systems (Node.js vs browser) and build processes.

The findAncestorInstallations function addresses a specific Claude Code behavior: Claude Code recursively loads CLAUDE.md files from all parent directories. If a user has Nori installed at `~` and also at `~/projects/myapp`, Claude Code will load both CLAUDE.md files, resulting in duplicate or conflicting configurations. The function walks up from the installation directory (starting from the grandparent to skip the current install location), checking each directory for Nori installation markers. The check order (`.nori-config.json` first, then `nori-config.json` legacy, then CLAUDE.md content) prioritizes explicit config files over content-based detection. The function stops at the filesystem root (when `path.dirname()` returns the same path) to prevent infinite loops.
