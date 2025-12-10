# Paid Skills Bundler

**IMPORTANT**: This script bundles paid skill scripts into standalone executables.

## Why Bundling is Necessary

Paid skill scripts are TypeScript files that use:

- Path aliases (`@/api/index.js`, `@/cli/config.js`)
- External dependencies (`minimist`)
- Internal modules from the plugin package

After TypeScript compilation, `tsc-alias` converts `@` imports to relative paths like `../../../../../api/index.js`. When these scripts are installed to `~/.claude/skills/`, those relative paths no longer resolve correctly.

## Solution: esbuild Bundling

This script uses esbuild to create standalone bundles that:

- Inline all dependencies (minimist, API client, config utilities)
- Resolve all imports at build time
- Produce single-file executables that work from any location
- Preserve the shebang (`#!/usr/bin/env node`) for direct execution

## Build Process Integration

1. TypeScript compiles `src/` to `build/` (with `@` aliases)
2. `tsc-alias` converts `@` imports to relative paths
3. **THIS SCRIPT** bundles each `paid-*/script.js` into standalone version
4. Installation copies bundled scripts to `~/.claude/skills/`

## Output Structure

- **Input**: `build/src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-recall/script.js`
- **Output**: `build/src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-recall/script.js` (replaced with bundle)

The bundled version **REPLACES** the tsc output, so the installer workflow remains unchanged.

## Maintenance Notes

- **Add new paid skills**: They'll be auto-detected and bundled
- **Update dependencies**: Rebuild will include updated versions
- **Debug bundling issues**: Run `npm run build` and check this script's output
- **Bundle size**: Each script is approximately 50-100KB (includes all dependencies)

## Integration Points

- `package.json:build` - Build pipeline integration
- `src/cli/features/claude-code/profiles/skills/loader.ts` - Installation process
- `src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-recall/script.ts` - Example paid skill with bundling comments
