# Noridoc: scripts

Path: @/src/scripts

### Overview

Build-time scripts for post-compilation processing. Currently contains the esbuild bundler that packages hook scripts into standalone, self-contained JavaScript files that can run without the full node_modules tree.

### How it fits into the larger codebase

This module runs during `npm run build` (via `@/scripts/build.sh`), after TypeScript compilation. It processes the compiled hook scripts at `build/src/cli/features/claude-code/hooks/config/*.js` into standalone bundles. The bundled hooks are distributed with the npm package and executed by Claude Code as lifecycle hooks.

### Core Implementation

**`bundle-skills.ts`** uses esbuild to bundle each hook script file individually. It injects a `createRequire` shim (to support CommonJS libraries like Winston's logform in ESM context) and a compile-time `__PACKAGE_VERSION__` constant. Each bundled output replaces its input file in-place and is made executable (chmod 755). Test files are excluded from bundling.

### Things to Know

The `createRequire` banner injection is necessary because some transitive dependencies (like `@colors/colors` via logform) use dynamic `require()` calls that fail when bundled into ESM format. Without this shim, the hooks would crash at runtime with "Dynamic require of 'util' is not supported".

Created and maintained by Nori.
