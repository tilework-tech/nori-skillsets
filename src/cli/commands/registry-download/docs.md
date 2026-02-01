# Noridoc: registry-download

Path: @/src/cli/commands/registry-download

### Overview

- Implements `nori-ai registry-download <package>[@version]` and `nori-skillsets download <package>[@version]` CLI commands
- Downloads profile packages from the Nori registrar, extracts them to the local profiles directory, and recursively installs skill dependencies
- Handles installation directory discovery with a preference for the home directory installation, auto-initialization when no installation exists, and namespaced (organization-scoped) packages

### How it fits into the larger codebase

- Registered with Commander.js by `registerRegistryDownloadCommand` (called from @/src/cli/nori-ai.ts) and by `registerNoriSkillsetsDownloadCommand` (called from @/src/cli/commands/noriSkillsetsCommands.ts)
- Uses `getInstallDirs()` from @/src/utils/path.ts to discover existing Nori installations by walking the directory tree
- Uses `getNoriProfilesDir()` from @/src/cli/features/claude-code/paths.ts to construct the profiles output directory from `installDir`. **The `installDir` passed here must be the parent of `.nori`, not `.nori` itself** -- `getNoriProfilesDir` appends `.nori/profiles` to it
- Uses `loadConfig()` from @/src/cli/config.ts to load Nori config (auth, profile, registries) from the resolved installation
- Calls `initMain()` from @/src/cli/commands/init/init.ts when no installation is found, to bootstrap Nori config before downloading
- Calls `registrarApi.getPackument()` and `registrarApi.downloadTarball()` from @/src/api/registrar.ts to fetch package metadata and tarballs
- Uses `parseNamespacedPackage()` and `buildOrganizationRegistryUrl()` from @/src/utils/url.ts to resolve org-scoped package names to registry URLs
- Does NOT activate the downloaded profile -- the user must separately run `switch-profile` to activate it. This differs from `registry-install` (@/src/cli/commands/registry-install/) which orchestrates init, onboard, and loaders in one step

### Core Implementation

**Installation directory resolution** (`registryDownloadMain` in `registryDownload.ts`):

```
--install-dir provided?
  YES --> Use that directory (auto-init if no installation exists there)
  NO  --> Check home directory via getInstallDirs({ currentDir: os.homedir() })
          |
          Home dir has installation? (homeInstallations.includes(homeDir))
            YES --> targetInstallDir = homeDir (e.g., ~)
            NO  --> Check cwd via getInstallDirs({ currentDir: cwd })
                    |
                    0 installations --> auto-init at cwd
                    1 installation  --> use it
                    2+ installations --> error, ask user to specify --install-dir
```

The home directory preference exists because `nori-skillsets login` stores auth credentials at `~/.nori/.nori-config.json`, so the home installation typically has registry auth configured for authenticated downloads.

**Download flow** after installation directory is resolved:
1. Resolve the package version (latest if unspecified, or semver-matched from available versions)
2. Check if profile already exists locally and compare versions (skip if same version, prompt for upgrade/downgrade)
3. Download the tarball via `registrarApi.downloadTarball()` with auth token from `getRegistryAuthToken()`
4. Extract tarball to `<installDir>/.nori/profiles/<packageName>/` (or `<installDir>/.nori/profiles/<orgId>/<packageName>/` for namespaced packages)
5. Write a `.nori-version` file tracking installed version and source registry
6. Parse `nori.json` manifest for skill dependencies, then recursively download each skill dependency via `skillDownloadMain()` from @/src/cli/commands/skill-download/

### Things to Know

- The `installDir` invariant is critical here: `targetInstallDir` is always the directory that *contains* `.nori`, not the `.nori` folder itself. For a home directory installation, this means `targetInstallDir = os.homedir()` (e.g., `/home/user`), which produces profiles at `/home/user/.nori/profiles/`. Previously this code incorrectly set `targetInstallDir = path.join(os.homedir(), ".nori")` which produced the doubled path `/home/user/.nori/.nori/profiles/`.
- `getInstallDirs()` detects home directory installations by checking for `~/.nori/.nori-config.json` (the `.nori` subdirectory config pattern), and returns `~` (the home directory) as the installation path -- not `~/.nori`. This is consistent with the `installDir` convention used throughout the codebase.
- The `registry-install` command (@/src/cli/commands/registry-install/) is NOT affected by the same `installDir` issue because it receives its `installDir` from `resolveInstallDir()`, which uses `getInstallDirs()` and `normalizeInstallDir()` -- both of which return correctly-formatted paths.

Created and maintained by Nori.
