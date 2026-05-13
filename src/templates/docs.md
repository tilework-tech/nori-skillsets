# Noridoc: templates

Path: @/src/templates

### Overview

- Build-time skillset generation from base templates. Takes template variables (agent identity, credential integration ID, etc.) and produces a complete skillset directory ready for review, commit, and upload to the registry.
- Distinct from the runtime template substitution in `@/src/cli/features/template.ts`, which replaces path placeholders (`{{skills_dir}}`, etc.) at install time. This module operates at development time to scaffold new skillset source directories.

### How it fits into the larger codebase

- Called by the CLI wrapper script `@/scripts/generate-from-template.ts`, which parses command-line arguments and optionally uploads the result via `sks upload`.
- Reads base template files from `@/templates/base-acp-agent/`, which contain `{{placeholder}}` markers in both file contents and filenames (e.g., `skills/integrations/{{agentId}}.md`).
- Output directories (e.g., `@/goose/`) are checked-in skillset sources that get uploaded to the nori-skillsets registry at noriskillsets.dev. They are independent of the `@/src/` compilation pipeline.
- Part of the ACP Agent Registry Support plan -- as Nori adds support for new AI coding agents, this module eliminates manual boilerplate when creating their skillsets.

### Core Implementation

- **`generate.ts`** exports `generateFromTemplate({ vars, outputDir })`. The `TemplateVars` type requires five fields: `agentId`, `agentName`, `skillsetId`, `cliBinary`, `authIntegrationId`.
- Generation walks the base template directory recursively, substituting `{{key}}` placeholders in both file contents and filenames, then writes the result to `outputDir`.
- Validation: all five template variables must be non-empty, and the output directory must not already exist. Both conditions throw synchronous errors.
- The `TEMPLATE_DIR` constant resolves to `@/templates/base-acp-agent/` relative to the compiled module location using `import.meta.url`.

### Things to Know

- The `{{placeholder}}` syntax is intentionally the same double-brace format used by `@/src/cli/features/template.ts`, but the variable names are disjoint (`agentId`/`agentName`/etc. vs. `skills_dir`/`profiles_dir`/etc.) and the two modules never interact.
- The `TEMPLATE_DIR` path resolution depends on the compiled output's relative position to the `@/templates/` directory. If the build output structure changes, this path will break.
- Generated skillsets (like `@/goose/`) are typically hand-edited after generation to add agent-specific details (e.g., Goose requires `--goose-provider` and `--goose-model` flags in its credential handoff). The template provides the skeleton; the developer fills in specifics.

Created and maintained by Nori.
