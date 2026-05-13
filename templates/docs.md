# Noridoc: templates

Path: @/templates

### Overview

- Base template directories used by `@/src/templates/generate.ts` to scaffold new skillset source directories.
- Currently contains a single template, `base-acp-agent/`, designed for ACP-compatible AI coding agents that integrate with Nori Sessions.

### How it fits into the larger codebase

- Consumed exclusively by `@/src/templates/generate.ts` at development time. The generation function resolves `TEMPLATE_DIR` to `@/templates/base-acp-agent/` using `import.meta.url` relative path resolution.
- The CLI wrapper at `@/scripts/generate-from-template.ts` invokes generation and optionally runs `sks upload` on the output.
- Generated output directories (e.g., `@/goose/`) are checked into the repo as skillset sources. They are uploaded to the noriskillsets.dev registry and distributed to end users.
- Template files use `{{placeholder}}` syntax in both content and filenames. The placeholder names (`agentId`, `agentName`, `skillsetId`, `cliBinary`, `authIntegrationId`) match the `TemplateVars` type in `@/src/templates/generate.ts`.

### Core Implementation

- **`base-acp-agent/`** contains the complete file tree for a minimal ACP agent skillset:

  | File | Purpose |
  |------|---------|
  | `nori.json` | Skillset manifest with `{{skillsetId}}` as name and `{{agentName}}` in description |
  | `AGENTS.md` | Agent instructions establishing identity, session rules, and integration pointer |
  | `skills/integrations/{{agentId}}.md` | Credential setup skill with broker handoff commands |

- Filename substitution is recursive -- `skills/integrations/{{agentId}}.md` becomes `skills/integrations/goose.md` when `agentId=goose`.

### Things to Know

- The `AGENTS.md` template has a hardcoded reference to `.goosehints` in its session rules section. This is an artifact from the first generated agent (Goose) and may need parameterization if future agents have different hint file conventions.
- The integration skill template uses a generic single-value API key handoff (`--type api-key --api-key`). Agents requiring additional credential fields (like Goose's `--goose-provider` and `--goose-model`) must have their generated skill file manually extended after generation.
- Adding a new template means creating a new subdirectory here and pointing `TEMPLATE_DIR` in `@/src/templates/generate.ts` at it, or parameterizing the template selection.

Created and maintained by Nori.
