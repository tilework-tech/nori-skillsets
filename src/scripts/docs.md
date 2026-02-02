# Noridoc: scripts

Path: @/src/scripts

### Overview

- Build-time and publish-time scripts for packaging the `nori-skillsets` npm package, plus their associated tests
- Handles paid skill bundling (esbuild), the interactive prepublish workflow (release notes via headless Claude), and validation of the `nori-skillsets` packaging pipeline

### How it fits into the larger codebase

- `bundle-skills.ts` is invoked during `npm run build` to bundle paid skill scripts (found in profile directories at @/src/cli/features/) into standalone executables using esbuild, so they work when installed to `~/.claude/skills/` where relative paths would otherwise break
- `package-skillsets.test.ts` validates the separate `nori-skillsets` packaging pipeline defined by @/scripts/package_skillsets.sh and the template files at @/packages/nori-skillsets/
- `prepublish.test.ts` validates the interactive prepublish script at @/scripts/prepublish.sh that runs on `npm publish` for the main `nori-skillsets` package

### Core Implementation

- `bundle-skills.ts` globs for `paid-*/script.js` files in compiled profile directories and uses esbuild to inline all dependencies into single-file ESM bundles. It injects `createRequire` via banner to handle CommonJS libraries (like Winston's transitive dependency chain) that use dynamic `require()` calls
- `package-skillsets.test.ts` tests both the template file structure and the actual script execution. It runs @/scripts/package_skillsets.sh with `SKILLSETS_VERSION=1.0.0-test` and verifies the staging directory, generated `package.json`, and npm tarball. It also validates bidirectional dependency consistency using `collectThirdPartyImports`, which walks the compiled JS import tree from `build/src/cli/nori-skillsets.js` to find all third-party bare specifier imports
- `prepublish.test.ts` validates the structure and behavior of @/scripts/prepublish.sh via content inspection (checking for read prompts, Claude headless invocation, git operations, and exit codes)

### Things to Know

- The `collectThirdPartyImports` helper in `package-skillsets.test.ts` performs static analysis on compiled JS files (not TypeScript source). It follows relative/absolute imports recursively and extracts bare specifier package names (handling scoped `@org/pkg` packages). It only flags packages that are both imported AND present in the main @/package.json -- transitive dependencies that are not directly imported are intentionally ignored
- The `package-skillsets.test.ts` execution tests (`package_skillsets.sh execution` describe block) require a prior build (`npm run build`) since they run the actual shell script against the `build/` directory

Created and maintained by Nori.
