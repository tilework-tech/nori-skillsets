# Noridoc: core

Path: @/src/core

### Overview

- Cli-free policy and orchestration modules extracted from the registry commands, part of the "policy out of prompts/flows" refactor: the goal is that decision logic is testable without prompting, Commander parsing, or process control.
- Contains the skillset upload policy/pipeline/sync trio (`uploadPolicy.ts`, `uploadPipeline.ts`, `uploadSync.ts`) and the shared org-scoped registry auth resolution (`registryAuthResolution.ts`).
- Every module here has direct unit tests alongside it; no module prompts, parses argv, or calls `process.exit`.

### How it fits into the larger codebase

- Sits between the command layer and the clients/primitives: `@/src/cli/commands/` calls into core, and core calls out to `@/src/api/` (registrar client, auth token resolution, credential helpers in @/src/api/authCredentials.ts), `@/src/packaging/` (archives, provenance), `@/src/norijson/` (manifest CRUD), and `@/src/utils/`.
- **Invariant: core never imports from `@/cli/`.** The credential types and pure predicates it needs were moved from `@/src/cli/config.ts` to @/src/api/authCredentials.ts specifically to preserve this direction.

```
src/cli (commands, prompts/flows)   <- prompting, argv, error strings, exit codes
        |
        v
src/core (policy + orchestration)   <- this folder
        |
        v
src/api / src/packaging / src/norijson / src/utils
```

- The upload trio is driven by `@/src/cli/commands/registry-upload/registryUpload.ts` (see @/src/cli/commands/registry-upload/docs.md); `registryAuthResolution.ts` is shared by the org-scoped arms of the upload and download commands (`registry-upload`, `skill-upload`, `registry-download`, `skill-download`, `subagent-download`).

### Core Implementation

- **`uploadPolicy.ts`** -- pure policy for skillset uploads: the `UploadResult` union, which conflict-resolution actions are offered and which is the default, version suggestion/bumping, auto-resolution of unchanged conflicts, and validation of the `--resolve` CLI strategy value.
- **`uploadPipeline.ts`** -- the packaging half of an upload (`performSkillsetUpload`): candidate `nori.json` creation for inline/extract decisions, flat-subagent partitioning (persisting inline choices, restructuring extracted flat files into directories), tarball creation via @/src/packaging/archive.ts, inline-list merging, the `registrarApi.uploadSkillset` call, and mapping collision errors into `UploadResult`.
- **`uploadSync.ts`** -- post-upload local state sync (`syncLocalStateAfterUpload`): writes the uploaded version and registry URL back to `nori.json` and `.nori-version`, updates extracted/linked skill and subagent versions, and overwrites local `SKILL.md`/`SUBAGENT.md` for packages the user linked against changed remote content. Non-fatal problems come back as warnings for the command to print.
- **`registryAuthResolution.ts`** -- `resolveOrgRegistryAuth({ auth, orgId })`, the one piece shared by the registry-auth ladders of the upload and download commands: derive the org registry URL (via `buildOrganizationRegistryUrl` from @/src/utils/url.ts), check membership against the unified auth's organization list, and build the `RegistryAuth` (via `toRegistryAuth` from @/src/api/authCredentials.ts). It returns a discriminated union `OrgRegistryAuthResult`: `ok: true` with `registryUrl`, `registryAuth`, and a `getToken()` that delegates to `getRegistryAuthToken` from @/src/api/registryAuth.ts; or `ok: false` with reason `"no-unified-auth"` (no organization list available) or `"not-a-member"` (carrying the user's organizations for error messaging). The derived `registryUrl` is included in every variant so callers can use it even on failure (e.g., for env-token matching).

### Things to Know

- Command-specific auth **policy stays in the commands** on purpose: unified-auth availability checks (`hasRegistryAuthCredentials`), `NORI_API_TOKEN` env-token matching (which can bypass the membership check for uploads), anonymous public downloads, per-registry auth precedence, and all error strings/log output. These genuinely differ between uploads and downloads, so `resolveOrgRegistryAuth` only answers "given this auth's organization list, may this orgId be used, and with which URL and credentials?".
- `uploadPipeline.ts` mutates the user's source tree: it writes candidate `nori.json` files after inline/extract decisions and restructures flat subagent `.md` files into directories before tarball creation. This is why re-uploads need the "existing inline" detection phase described in @/src/cli/commands/registry-upload/docs.md.
- `uploadSync.ts` overwrites only `SKILL.md` / `SUBAGENT.md` for linked packages because conflict detection and the diff UI operate at that file's granularity -- sibling files are not part of the user's "discard local changes" choice.
- The upload commands bind their context (candidate lists, auth, registry URL) onto these functions in small local wrappers, so the silent path and the interactive flow's callbacks drive the same core code.

Created and maintained by Nori.
