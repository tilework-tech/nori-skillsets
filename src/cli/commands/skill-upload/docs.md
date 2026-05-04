# Noridoc: skill-upload

Path: @/src/cli/commands/skill-upload

### Overview

The skill-upload command uploads a single skill from `~/.nori/profiles/<skillset>/skills/<skill>` to the Nori registry. Unlike `registry-upload` which packs and publishes an entire skillset, this command targets one skill at a time — useful for publishing or bumping a standalone skill that lives inside a skillset.

### How it fits into the larger codebase

Registered as `upload-skill` via `@/src/cli/commands/noriSkillsetsCommands.ts`. It uses the `registrarApi.uploadSkill` endpoint from `@/api/registrar.js` (`PUT /api/skills/:skillName/skill`) for the upload itself, and `registrarApi.getSkillPackument` + `registrarApi.downloadSkillTarball` for collision detection against the remote. Authentication mirrors the skill-download flow — `getRegistryAuth` + `getRegistryAuthToken` per target registry URL with fallbacks to unified `config.auth` and matching `NORI_API_TOKEN` values.

### Core Implementation

`skillUploadMain` resolves the source skill directory, reads the skill's local `nori.json` for metadata defaults, and guards against uploading `type: "inlined-skill"` skills (those are bundled with their parent skillset and cannot be published independently). It drives `skillUploadFlow` with two callbacks:

- `onCheckExisting` fetches the packument for the skill name. On 404 it reports `exists: false`. On success it downloads the latest-version tarball, extracts the `SKILL.md` entry via a streaming tar parser, and compares byte-exact against the local `SKILL.md`. The flow uses this to decide whether to short-circuit as "already up to date", auto-publish (no remote), or prompt for conflict resolution.
- `onUpload` creates a gzipped tarball of the skill directory (excluding `.nori-version`), then calls `registrarApi.uploadSkill`. The description defaults to the skill's local `nori.json.description` when `--description` is not passed explicitly.

After a successful upload, `writeSkillVersion` updates the local `nori.json.version` so subsequent `skillUploadMain` calls will detect the bumped version cleanly.

`resolveRegistryAndAuth` derives the target registry from `--registry`, the namespace prefix, or the public apex. Saved API tokens and env-var API tokens share the same scoping rule: the org embedded in the token must match the org derived from the target registry URL. This lets CI publish public skills with `NORI_API_TOKEN=nori_public_<hex> sks upload-skill <skill> --skillset <skillset> --silent --non-interactive` without a saved login config, while still preventing public tokens from being sent to private org registries.

### Conflict Resolution

The single-skill endpoint does not return server-side `SkillCollisionError` payloads the way `uploadSkillset` does, so conflict handling is implemented client-side in `skillUploadFlow`. When the remote skill exists and local content differs, the user is prompted with three choices: **Bump version** (opens a text prompt with `semver.inc(latest, "patch")` as the default), **View diff** (renders a colored unified diff of remote vs. local `SKILL.md` via `formatDiffForNote`), or **Cancel**. View-diff re-prompts the same choice until the user picks bump or cancel.

### Things to Know

The `--skillset` flag overrides the active skillset as the source location. The `--registry` flag is mutually exclusive with a namespace prefix (`org/skill-name`). Non-interactive mode with a content-differs collision fails unless `--version` is also passed, to avoid accidental overwrite of another publisher's content. `createSkillTarball` filters tarball entries through `shouldExcludeFromUpload` from `@/src/utils/uploadFileFilter.ts` -- the shared predicate used by `registryUpload.createProfileTarball` -- so editor swap files, OS junk, and `.nori-version` never enter the upload and never contaminate the server's content hash.

Created and maintained by Nori.
