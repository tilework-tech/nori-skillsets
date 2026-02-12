# Noridoc: registry-download

Path: @/src/cli/commands/registry-download

### Overview

- Implements `nori-skillsets download <package>[@version]` CLI command
- Downloads profile packages from the Nori registrar, extracts them to `~/.nori/profiles/`, and recursively installs skill dependencies
- Handles installation existence checking with auto-initialization when no installation exists, and namespaced (organization-scoped) packages

### How it fits into the larger codebase

- Registered with Commander.js by `registerNoriSkillsetsDownloadCommand` (called from @/src/cli/commands/noriSkillsetsCommands.ts)
- Uses `getInstallDirs()` from @/src/utils/path.ts to discover existing Nori installations by walking the directory tree
- Uses `getNoriProfilesDir()` from @/src/cli/features/claude-code/paths.ts to get the centralized profiles directory (`~/.nori/profiles/`). This is a zero-arg function that always resolves to the home directory
- Uses `loadConfig()` from @/src/cli/config.ts to load Nori config (auth, profile, registries) from the centralized `~/.nori-config.json`
- Calls `initMain()` from @/src/cli/commands/init/init.ts when no installation is found, to bootstrap Nori config before downloading
- Calls `registrarApi.getPackument()` and `registrarApi.downloadTarball()` from @/src/api/registrar.ts to fetch package metadata and tarballs
- Uses `parseNamespacedPackage()` and `buildOrganizationRegistryUrl()` from @/src/utils/url.ts to resolve org-scoped package names to registry URLs
- Does NOT activate the downloaded profile -- the user must separately run `switch-profile` to activate it. This differs from `registry-install` (@/src/cli/commands/registry-install/) which orchestrates init, profile resolution, and loaders in one step

### Core Implementation

**Installation existence checking** (`registryDownloadMain` in `registryDownload.ts`):

The command verifies that a Nori installation exists before proceeding. Since config and profiles are centralized at `~/.nori-config.json` and `~/.nori/profiles/`, the installation check ensures the home directory has been initialized:

```
--install-dir provided?
  YES --> Check that installation exists at that directory via getInstallDirs()
          Not found? --> auto-init at that directory
  NO  --> Check home directory via getInstallDirs({ currentDir: os.homedir() })
          |
          Home dir has installation?
            YES --> proceed (config is centralized)
            NO  --> Check cwd via getInstallDirs({ currentDir: cwd })
                    |
                    0 installations --> auto-init at home directory
                    1 installation  --> proceed (config is centralized)
                    2+ installations --> error, ask user to specify --install-dir
```

After the installation check, auth is always loaded from the single centralized config via `loadConfig()` (zero-arg). The profiles directory is always `getNoriProfilesDir()` (zero-arg, returns `~/.nori/profiles/`).

**Namespaced package auth:** For namespaced packages (e.g., `myorg/my-skillset`), if the centralized config has no unified auth credentials, the command errors with a message directing the user to log in. There is no fallback -- all auth lives in `~/.nori-config.json`.

**Download flow** after installation check:
1. Resolve the package version (latest if unspecified, or semver-matched from available versions)
2. Check if profile already exists locally and compare versions (skip if same version, prompt for upgrade/downgrade)
3. Download the tarball via `registrarApi.downloadTarball()` with auth token from `getRegistryAuthToken()`
4. Extract tarball to `~/.nori/profiles/<packageName>/` (or `~/.nori/profiles/<orgId>/<packageName>/` for namespaced packages)
5. Write a `.nori-version` file tracking installed version and source registry
6. Parse `nori.json` manifest for skill dependencies, then recursively download each skill dependency via `skillDownloadMain()` from @/src/cli/commands/skill-download/

### Things to Know

- The `installDir` parameter to `registryDownloadMain` still exists but is only used for the installation existence check and for `initMain()`. Config and profiles are always read from/written to the centralized home directory locations.
- `getInstallDirs()` detects installations by checking for `.nori-config.json` at a given directory. It returns the directory containing the config file, not the `.nori` folder.

Created and maintained by Nori.
