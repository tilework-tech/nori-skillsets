# Noridoc: utils

Path: @/plugin/src/utils

### Overview

Shared utility functions for the plugin package, containing URL normalization helpers and path normalization utilities. URL normalization ensures consistent URL formatting across API calls and configuration. Path normalization handles installation directory paths by expanding tildes, resolving relative paths, and removing trailing slashes.

### How it fits into the larger codebase

This folder provides utilities used throughout the plugin package at multiple system boundaries. The normalizeUrl function is used in @/plugin/src/api/base.ts to construct API request URLs (combining organizationUrl from config with endpoint paths like /api/artifacts/create), in @/plugin/src/installer/config.ts to normalize user-provided organizationUrl values before saving to ~/nori-config.json, and is bundled into all paid skills (paid-memorize, paid-recall, paid-\*-noridoc, paid-prompt-analysis) by @/plugin/src/scripts/bundle-skills.ts since they import the API client. The identical implementation exists in @/ui/src/utils/url.ts for the web UI, maintaining consistent URL handling across all client packages. Path normalization utilities (normalizeInstallDir and validateInstallDirExists) support the configurable installation directory feature, allowing the installer to accept user-provided paths like ~/.claude, ~/custom/path, or ./relative/path and normalize them to absolute paths for consistent storage and validation.

### Core Implementation

The url.ts module exports a single normalizeUrl function that accepts { baseUrl: string, path?: string | null } and returns a normalized URL. The function strips all trailing slashes from baseUrl using replace(/\/+$/, ''), handles optional path by ensuring it starts with exactly one leading slash, and concatenates them to prevent double slashes. Comprehensive test coverage in url.test.ts validates edge cases including multiple trailing slashes, empty paths, localhost URLs, and query parameters.

The path.ts module exports two functions for installation directory handling. normalizeInstallDir accepts { path: string } and performs three transformations: (1) expands leading tilde using process.env.HOME with fallback to preserve '~' if HOME is unset, (2) resolves to absolute path using path.resolve(), and (3) removes trailing slashes while preserving root '/'. validateInstallDirExists accepts { path: string } and returns Promise<boolean>, using fs.access() and fs.stat() to verify the path exists and is a directory, returning false on any errors without logging. Both functions follow the codebase style of named parameters and comprehensive test coverage in path.test.ts validates tilde expansion, trailing slash removal, relative path resolution, and directory validation.

### Things to Know

URL normalization happens at two critical points: (1) when users provide organizationUrl during installation (installer/config.ts line 137 normalizes before saving to ~/nori-config.json to ensure consistent storage format), and (2) when making API requests (api/base.ts line 105 combines the stored organizationUrl with endpoint paths like /api/artifacts/create). This prevents URL construction bugs from user input variations like "https://example.com/" vs "https://example.com" or paths with/without leading slashes. The utility is bundled into paid skills because esbuild inlines all dependencies when creating standalone executables, so the normalizeUrl code appears in every built skill script. The implementation is duplicated across @/plugin/src/utils/url.ts and @/ui/src/utils/url.ts rather than shared because the packages have different module systems (Node.js vs browser) and build processes.

Path normalization handles HOME environment variable edge cases by falling back to preserving the literal '~' character when HOME is unset, allowing path.resolve() to treat it as a relative path rather than throwing errors. The validateInstallDirExists function fails silently without logging to avoid noise during validation checks, returning false for both non-existent paths and files (not directories). This design allows callers to implement their own error handling and messaging. The root path '/' is treated specially in normalizeInstallDir to prevent removing the trailing slash, ensuring '/' remains '/' rather than becoming an empty string.
