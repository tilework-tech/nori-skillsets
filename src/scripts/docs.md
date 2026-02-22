# Noridoc: scripts

Path: @/src/scripts

### Overview

Build-time scripts for post-compilation processing. Contains the esbuild bundler that packages hook scripts into standalone, self-contained JavaScript files that can run without the full node_modules tree. Also contains tests for npm lifecycle hooks.

### How it fits into the larger codebase

This module runs during `npm run build` (via `@/scripts/build.sh`), after TypeScript compilation. It processes the compiled hook scripts at `build/src/cli/features/claude-code/hooks/config/*.js` into standalone bundles. The bundled hooks are distributed with the npm package and executed by Claude Code as lifecycle hooks.

The `prepublish.test.ts` file tests the `prepublishOnly` npm hook safeguard defined in `@/scripts/prepublish.sh` and referenced in `@/package.json`.

### Core Implementation

**`bundle-skills.ts`** uses esbuild to bundle each hook script file individually. It injects a `createRequire` shim (to support CommonJS libraries like Winston's logform in ESM context) and a compile-time `__PACKAGE_VERSION__` constant. Each bundled output replaces its input file in-place and is made executable (chmod 755). Test files are excluded from bundling.

**`prepublish.test.ts`** verifies that the `prepublishOnly` npm hook correctly blocks direct `npm publish` attempts and displays a helpful error message directing users to use `@/scripts/create_skillsets_release.py` instead.

### Things to Know

The `createRequire` banner injection is necessary because some transitive dependencies (like `@colors/colors` via logform) use dynamic `require()` calls that fail when bundled into ESM format. Without this shim, the hooks would crash at runtime with "Dynamic require of 'util' is not supported".

The prepublish safeguard test uses `execSync` to run the `prepublishOnly` command and expects it to fail with non-zero exit status and output referencing the proper release script.

Created and maintained by Nori.
