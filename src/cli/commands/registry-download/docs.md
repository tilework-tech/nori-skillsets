# Noridoc: registry-download

Path: @/src/cli/commands/registry-download

### Overview

- Implements `nori-skillsets download <package>[@version]` CLI command
- Downloads profile packages from the Nori registrar, extracts them to `~/.nori/profiles/`, and recursively installs skill dependencies
- Handles installation existence checking with auto-initialization when no installation exists, and namespaced (organization-scoped) packages

### How it fits into the larger codebase

- Registered with Commander.js by `registerNoriSkillsetsDownloadCommand` (called from @/src/cli/commands/noriSkillsetsCommands.ts)
- Uses `resolveInstallDir()` from @/src/utils/path.ts to resolve the installation directory via the priority chain: CLI `--install-dir` > `config.installDir` > home directory
- Uses `getNoriProfilesDir()` from @/src/cli/features/claude-code/paths.ts to get the centralized profiles directory (`~/.nori/profiles/`). This is a zero-arg function that always resolves to the home directory
- Uses `loadConfig()` from @/src/cli/config.ts to load Nori config (auth, skillset, registries) from the centralized `~/.nori-config.json`
- Calls `initMain()` from @/src/cli/commands/init/init.ts when no installation is found, to bootstrap Nori config before downloading
- Calls `registrarApi.getPackument()` and `registrarApi.downloadTarball()` from @/src/api/registrar.ts to fetch package metadata and tarballs
- Uses `parseNamespacedPackage()` and `buildOrganizationRegistryUrl()` from @/src/utils/url.ts to resolve org-scoped package names to registry URLs
- Does NOT activate the downloaded skillset -- the user must separately run `switch-skillset` to activate it. This differs from `registry-install` (@/src/cli/commands/registry-install/) which orchestrates init, skillset resolution, and loaders in one step

### Core Implementation

**Installation directory resolution** (`registryDownloadMain` in `registryDownload.ts`):

The command resolves the installation directory using `resolveInstallDir()` with the standard priority chain:

```
resolveInstallDir({ cliInstallDir, config })
    |
    CLI --install-dir flag? --> normalize and use it
    config.installDir set? --> normalize and use it
    fallback             --> home directory
```

After resolving the install directory, the command auto-initializes if needed by calling `initMain()`. Auth is loaded from the centralized config via `loadConfig()` (zero-arg). The skillsets directory is always `getNoriSkillsetsDir()` (zero-arg, returns `~/.nori/profiles/`).

**Registry search precedence** (in `onSearch` callback within `registryDownloadMain`):

The command determines which registry to search and whether to use authentication based on this precedence order:

1. **Explicit --registry flag**: Uses the specified registry URL. If the URL is not the public registry, checks if the user has unified auth AND the URL matches one of their organization registries. If auth is required but unavailable, errors with "You must be logged in".

2. **Public packages** (`orgId === "public"`): Always searches the public registry (`REGISTRAR_URL`) WITHOUT authentication, regardless of whether the user has unified auth credentials. Public packages are always accessible without auth tokens.

3. **Authenticated private packages** (`hasUnifiedAuth` is true): For namespaced packages (e.g., `myorg/my-skillset`), if the user has unified auth, checks if `orgId` is in their `organizations` array. If not, errors with "You do not have access to organization". If access is granted, calls `getRegistryAuthToken()` and searches the organization's registry with the auth token.

4. **Unauthenticated private packages** (fallback): If the package is namespaced but the user has no unified auth, errors with "To download from organization, log in with: nori-skillsets login".

**Critical system invariant**: Public packages (`orgId === "public"`) MUST be checked before the `hasUnifiedAuth` branch. This ensures authenticated users can still download public packages without triggering organization access checks. Previously, this ordering was reversed, causing authenticated users to be blocked from downloading public packages because "public" was not in their organizations array.

**Download flow** after installation check:

1. Resolve the package version (latest if unspecified, or semver-matched from available versions)
2. Check if skillset already exists locally and compare versions (skip if same version, prompt for upgrade/downgrade)
3. Download the tarball via `registrarApi.downloadTarball()` with auth token from `getRegistryAuthToken()` (or `undefined` for public packages)
4. Extract tarball to `~/.nori/profiles/<packageName>/` (or `~/.nori/profiles/<orgId>/<packageName>/` for namespaced packages)
5. Write a `.nori-version` file tracking installed version and source registry
6. Parse `nori.json` manifest for skill dependencies, then recursively download each skill dependency via `skillDownloadMain()` from @/src/cli/commands/skill-download/

### Things to Know

- The `installDir` parameter to `registryDownloadMain` is passed as `cliInstallDir` to `resolveInstallDir()` and to `initMain()`. Config and profiles are always read from/written to the centralized home directory locations.
- **Public packages are always unauthenticated**: The `orgId === "public"` check must occur BEFORE the `hasUnifiedAuth` check in the registry search logic. This prevents authenticated users from being blocked from downloading public packages. Tests verify this behavior in `registryDownload.test.ts`: "should download public package without auth when signed into private registry".

Created and maintained by Nori.
