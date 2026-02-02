# Noridoc: nori-skillsets package templates

Path: @/packages/nori-skillsets

### Overview

- Template files and configuration for building the `nori-skillsets` npm package, which is the primary published npm package
- Contains the curated runtime dependency list and the package.json template used by the packaging script at @/scripts/package_skillsets.sh

### How it fits into the larger codebase

- The `nori-skillsets` CLI is defined at @/src/cli/nori-skillsets.ts and compiled alongside the rest of the monorepo, but it is published as a separate npm package (`nori-skillsets`) via its own build/release pipeline
- The packaging script (@/scripts/package_skillsets.sh) reads `package.template.json` and `dependencies.json` from this directory to assemble a standalone package in `dist/nori-skillsets-staging/`
- Releases are created by @/scripts/create_skillsets_release.py which pushes git tags that trigger the `skillsets-release` CI workflow
- Tests for the packaging pipeline live at @/src/scripts/package-skillsets.test.ts

### Core Implementation

- `package.template.json` defines the published package metadata with a `{{VERSION}}` placeholder that the packaging script substitutes at build time. The `bin` field points to `./build/src/cli/nori-skillsets.js`
- `dependencies.json` is the curated list of runtime dependencies. The packaging script reads this list, looks up each package's version from the main @/package.json, and writes them into the generated `package.json` for the staged package. Only packages listed here end up as runtime dependencies in the published `nori-skillsets` tarball

```
@/package.json (version source)  +  dependencies.json (curated list)
          │                                    │
          └──────────┬─────────────────────────┘
                     ▼
        scripts/package_skillsets.sh
                     │
                     ▼
        dist/nori-skillsets-staging/package.json
                     │
                     ▼
              npm pack → .tgz
```

### Things to Know

- Because the `nori-skillsets` CLI uses static (eager) imports, every transitively imported third-party module must be resolvable at module load time -- even if the command that uses it is never invoked. This means any new dependency added to the CLI import chain must also be added to `dependencies.json`, or users will see `ERR_MODULE_NOT_FOUND` on `npm install -g`
- The test at @/src/scripts/package-skillsets.test.ts enforces bidirectional consistency: (1) every package in `dependencies.json` must exist in the main @/package.json, and (2) every third-party package statically imported by the compiled `nori-skillsets.js` entry point that is also declared in @/package.json must appear in `dependencies.json`. The second check uses `collectThirdPartyImports` which walks the import tree from the compiled JS entry point
- Transitive dependencies (packages pulled in by listed dependencies but not directly imported) are intentionally not flagged by the import-checking test

Created and maintained by Nori.
