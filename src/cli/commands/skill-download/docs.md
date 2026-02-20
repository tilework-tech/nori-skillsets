# Noridoc: skill-download

Path: @/src/cli/commands/skill-download

### Overview

- Implements `nori-skillsets download-skill <skill>[@version]` CLI command
- Downloads individual skill packages from the Nori registrar and installs them to the active skillset's skills directory
- Handles namespaced (organization-scoped) skills and version resolution

### How it fits into the larger codebase

- Registered with Commander.js by `registerSkillDownloadCommand` (called from @/src/cli/commands/noriSkillsetsCommands.ts)
- Called recursively by `registryDownloadMain` from @/src/cli/commands/registry-download/ to install skill dependencies listed in a skillset's `nori.json` manifest
- Uses `loadConfig()` from @/src/cli/config.ts to load auth credentials and resolve the active skillset
- Uses `resolveInstallDir()` from @/src/utils/path.ts to determine the installation directory
- Calls `registrarApi.getSkillPackument()` and `registrarApi.downloadSkillTarball()` from @/src/api/registrar.ts to fetch skill metadata and tarballs
- Uses `parseNamespacedPackage()` and `buildOrganizationRegistryUrl()` from @/src/utils/url.ts to resolve org-scoped skill names to registry URLs
- Installs skills to `<activeSkillset>/skills/<skillName>/` (or `<activeSkillset>/skills/<orgId>/<skillName>/` for namespaced skills)

### Core Implementation

**Installation directory resolution**:

The command requires an active skillset. It uses `resolveInstallDir()` to find the installation directory, then determines the active skillset from config. Skills are installed to `<installDir>/profiles/<activeSkillset>/skills/`.

**Registry search precedence** (in `onSearch` callback within `skillDownloadMain`):

The command determines which registry to search and whether to use authentication based on this precedence order:

1. **Explicit --registry flag**: Uses the specified registry URL. For non-public registries, requires authentication via `getRegistryAuth()`. If auth is unavailable, errors with "You must be logged in".

2. **Public skills** (`orgId === "public"`): Always searches the public registry (`REGISTRAR_URL`) WITHOUT authentication, regardless of whether the user has unified auth credentials. Public skills are always accessible without auth tokens.

3. **Authenticated private skills** (`hasUnifiedAuth` is true): For namespaced skills (e.g., `myorg/my-skill`), if the user has unified auth, checks if `orgId` is in their `organizations` array. If not, errors with "You do not have access to organization". If access is granted, calls `getRegistryAuthToken()` and searches the organization's registry with the auth token.

4. **Unauthenticated private skills** (fallback): If the skill is namespaced but the user has no unified auth, errors with "To download from organization, log in with: nori-skillsets login".

**Critical system invariant**: Public skills (`orgId === "public"`) MUST be checked before the `hasUnifiedAuth` branch. This ensures authenticated users can still download public skills without triggering organization access checks. Previously, this ordering was reversed, causing authenticated users to be blocked from downloading public skills because "public" was not in their organizations array.

**Download flow**:

1. Parse skill spec and extract `orgId`, `skillName`, and optional `version`
2. Validate that namespace and --registry flag are not both specified (conflict)
3. Resolve active skillset from config
4. Check if skill already exists locally and compare versions
5. Search registries for the skill using the precedence rules above
6. Resolve target version (latest if unspecified, or semver-matched)
7. Download tarball via `registrarApi.downloadSkillTarball()` with auth token (or `undefined` for public skills)
8. Extract tarball to `<activeSkillset>/skills/<skillName>/` (or `<activeSkillset>/skills/<orgId>/<skillName>/`)
9. Write `.nori-version` file tracking installed version and source registry

### Things to Know

- **Requires active skillset**: Unlike `registry-download` which downloads skillsets, `skill-download` installs skills INTO the active skillset. If no active skillset is configured, the command errors.
- **No activation step**: Skills are immediately available after installation (no separate activation command needed).
- **Public skills are always unauthenticated**: The `orgId === "public"` check must occur BEFORE the `hasUnifiedAuth` check in the registry search logic. This prevents authenticated users from being blocked from downloading public skills. Tests verify this behavior in `skillDownload.test.ts`: "should download public skill without auth when signed into private registry".
- **Namespace/registry conflict**: Cannot specify both a namespace (e.g., `myorg/my-skill`) and the `--registry` flag. The namespace implies the organization's registry URL.

Created and maintained by Nori.
