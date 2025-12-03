# Registry Upload Command Implementation Plan

**Goal:** Add `/nori-registry-upload <profile-name>` slash command to upload profiles to the Nori registrar, with support for multiple registry authentications.

**Architecture:**
- Add `registryAuths` array to Config type to store credentials for multiple registries
- Create new intercepted slash command following the existing pattern (`nori-download-profile`, `nori-search-profiles`)
- Add registrar API function for authenticated profile uploads using Firebase auth
- Create skeleton slash command markdown file

**Tech Stack:** TypeScript, Firebase Auth, Node.js fetch API, tar/gzip

---

## Testing Plan

I will add unit tests for:
1. **Config loading/saving with registryAuths** - Test that `loadConfig` correctly parses the new `registryAuths` array and `saveConfig` correctly persists it
2. **Registry auth lookup** - Test finding the correct auth for a given registry URL
3. **Intercepted slash command** - Test the command matcher, argument parsing, error handling, and successful upload flow
4. **Registrar API upload function** - Test the authenticated upload API call with proper headers and multipart form data

The tests will mock:
- File system operations (for config loading)
- `fetch` (for API calls)
- Firebase auth (for token generation)

NOTE: I will write *all* tests before I add any implementation behavior.

---

## Step 1: Update Config Type

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/registry-upload-command/src/installer/config.ts`

### 1.1 Add RegistryAuth Type

Add new type definition after the existing `Config` type (around line 29):

```typescript
export type RegistryAuth = {
  username: string;
  password: string;
  registryUrl: string;
};
```

### 1.2 Update Config Type

Add `registryAuths` field to Config type:

```typescript
export type Config = {
  auth?: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null;
  profile?: {
    baseProfile: string;
  } | null;
  sendSessionTranscript?: "enabled" | "disabled" | null;
  autoupdate?: "enabled" | "disabled" | null;
  installDir: string;
  registryAuths?: Array<RegistryAuth> | null;  // NEW
};
```

### 1.3 Update loadConfig Function

In `loadConfig` (around line 140), add parsing for `registryAuths`:

```typescript
// Check if registryAuths exists and is valid array
if (Array.isArray(config.registryAuths)) {
  const validAuths = config.registryAuths.filter(
    (auth: any) =>
      auth &&
      typeof auth === "object" &&
      typeof auth.username === "string" &&
      typeof auth.password === "string" &&
      typeof auth.registryUrl === "string"
  );
  if (validAuths.length > 0) {
    result.registryAuths = validAuths;
  }
}
```

### 1.4 Update saveConfig Function

In `saveConfig` (add new parameter and handling):

```typescript
// Add registryAuths if provided
if (registryAuths != null && registryAuths.length > 0) {
  config.registryAuths = registryAuths;
}
```

### 1.5 Update configSchema

Add registryAuths to JSON schema validation:

```typescript
registryAuths: {
  type: "array",
  items: {
    type: "object",
    properties: {
      username: { type: "string" },
      password: { type: "string" },
      registryUrl: { type: "string" },
    },
    required: ["username", "password", "registryUrl"],
  },
},
```

---

## Step 2: Add Helper Function for Registry Auth Lookup

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/registry-upload-command/src/installer/config.ts`

Add function to find auth for a specific registry URL:

```typescript
export const getRegistryAuth = (args: {
  config: Config;
  registryUrl: string;
}): RegistryAuth | null => {
  const { config, registryUrl } = args;
  if (config.registryAuths == null) {
    return null;
  }
  return config.registryAuths.find(
    (auth) => normalizeUrl({ baseUrl: auth.registryUrl }) === normalizeUrl({ baseUrl: registryUrl })
  ) ?? null;
};
```

---

## Step 3: Add Registrar API Upload Function

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/registry-upload-command/src/api/registrar.ts`

### 3.1 Add Types

```typescript
export type UploadProfileRequest = {
  packageName: string;
  version: string;
  archiveData: ArrayBuffer;
  description?: string | null;
};

export type UploadProfileResponse = {
  name: string;
  version: string;
  description?: string | null;
  tarballSha: string;
  createdAt: string;
};
```

### 3.2 Add Upload Function

The registrar currently doesn't accept Bearer tokens directly in the existing API client. We need to create an authenticated upload function that:
1. Gets Firebase auth token from stored credentials
2. Makes multipart form upload to `PUT /api/packages/:packageName/profile`

```typescript
uploadProfile: async (
  args: UploadProfileRequest & { authToken: string }
): Promise<UploadProfileResponse> => {
  const { packageName, version, archiveData, description, authToken } = args;

  const formData = new FormData();
  formData.append("archive", new Blob([archiveData]), `${packageName}.tgz`);
  formData.append("version", version);
  if (description != null) {
    formData.append("description", description);
  }

  const url = `${REGISTRAR_URL}/api/packages/${packageName}/profile`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({
      error: `HTTP ${response.status}`,
    }))) as { error?: string };
    throw new Error(errorData.error ?? `HTTP ${response.status}`);
  }

  return (await response.json()) as UploadProfileResponse;
};
```

---

## Step 4: Create Registry Auth Manager

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/registry-upload-command/src/api/registryAuth.ts` (NEW FILE)

This module handles Firebase authentication for registry operations:

```typescript
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, type Auth } from "firebase/auth";

import type { RegistryAuth } from "@/installer/config.js";

// Registry-specific Firebase config (same project as main app)
const firebaseConfig = {
  apiKey: "AIzaSyC54HqlGrkyANVFKGDQi3LobO5moDOuafk",
  authDomain: "tilework-e18c5.firebaseapp.com",
  projectId: "tilework-e18c5",
  // ... rest of config
};

// Cache for auth tokens per registry
const tokenCache = new Map<string, { token: string; expiry: number }>();

export const getRegistryAuthToken = async (args: {
  registryAuth: RegistryAuth;
}): Promise<string> => {
  const { registryAuth } = args;
  const cacheKey = registryAuth.registryUrl;

  // Check cache
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  // Initialize Firebase and sign in
  // Note: Using same Firebase project - credentials work across registries
  const app = initializeApp(firebaseConfig, `registry-${cacheKey}`);
  const auth = getAuth(app);

  const userCredential = await signInWithEmailAndPassword(
    auth,
    registryAuth.username,
    registryAuth.password
  );

  const token = await userCredential.user.getIdToken();

  // Cache with 55 minute expiry
  tokenCache.set(cacheKey, {
    token,
    expiry: Date.now() + 55 * 60 * 1000,
  });

  return token;
};
```

---

## Step 5: Create Intercepted Slash Command

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/registry-upload-command/src/installer/features/hooks/config/intercepted-slashcommands/nori-registry-upload.ts` (NEW FILE)

### 5.1 Parse Function

```typescript
const parseUploadArgs = (
  prompt: string
): { profileName: string; version?: string | null } | null => {
  // Match: /nori-registry-upload <profile-name> [version]
  const match = prompt
    .trim()
    .match(/^\/nori-registry-upload\s+([a-z0-9-]+)(?:\s+(\d+\.\d+\.\d+.*))?$/i);

  if (!match) {
    return null;
  }

  return {
    profileName: match[1],
    version: match[2] ?? null,
  };
};
```

### 5.2 Create Tarball Function

```typescript
const createProfileTarball = async (args: {
  profileDir: string;
}): Promise<Buffer> => {
  // Use tar library to create tarball of profile directory
  // Similar to how nori-download-profile extracts tarballs
};
```

### 5.3 Main Run Function

```typescript
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Parse arguments
  const uploadArgs = parseUploadArgs(prompt);
  if (uploadArgs == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Upload a profile to the Nori registry.\n\nUsage: /nori-registry-upload <profile-name> [version]\n\nExamples:\n  /nori-registry-upload my-profile\n  /nori-registry-upload my-profile 1.0.0\n\nRequires registry authentication in .nori-config.json`,
      }),
    };
  }

  const { profileName, version } = uploadArgs;
  const uploadVersion = version ?? "1.0.0"; // Default to 1.0.0

  // Find installation directory
  const allInstallations = getInstallDirs({ currentDir: cwd });
  if (allInstallations.length === 0) {
    return {
      decision: "block",
      reason: formatError({
        message: "No Nori installation found.\n\nRun 'npx nori-ai install' to install Nori Profiles.",
      }),
    };
  }

  const installDir = allInstallations[0];

  // Load config and check for registry auth
  const config = await loadConfig({ installDir });
  if (config == null) {
    return {
      decision: "block",
      reason: formatError({
        message: "Could not load Nori configuration.",
      }),
    };
  }

  const registryAuth = getRegistryAuth({
    config,
    registryUrl: REGISTRAR_URL,
  });

  if (registryAuth == null) {
    return {
      decision: "block",
      reason: formatError({
        message: `No registry authentication configured for ${REGISTRAR_URL}.\n\nAdd registry credentials to .nori-config.json:\n{\n  "registryAuths": [{\n    "username": "your-email@example.com",\n    "password": "your-password",\n    "registryUrl": "${REGISTRAR_URL}"\n  }]\n}`,
      }),
    };
  }

  // Check profile exists
  const profileDir = path.join(installDir, ".claude", "profiles", profileName);
  try {
    await fs.access(profileDir);
  } catch {
    return {
      decision: "block",
      reason: formatError({
        message: `Profile "${profileName}" not found at:\n${profileDir}`,
      }),
    };
  }

  // Get auth token
  let authToken: string;
  try {
    authToken = await getRegistryAuthToken({ registryAuth });
  } catch (err) {
    return {
      decision: "block",
      reason: formatError({
        message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }

  // Create tarball and upload
  try {
    const tarballData = await createProfileTarball({ profileDir });
    const result = await registrarApi.uploadProfile({
      packageName: profileName,
      version: uploadVersion,
      archiveData: tarballData,
      authToken,
    });

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Successfully uploaded "${profileName}@${result.version}" to the Nori registry.\n\nOthers can install it with:\n/nori-download-profile ${profileName}`,
      }),
    };
  } catch (err) {
    return {
      decision: "block",
      reason: formatError({
        message: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }
};
```

### 5.4 Export Command

```typescript
export const noriRegistryUpload: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-registry-upload\\s*$", // Bare command - shows help
    "^\\/nori-registry-upload\\s+[a-z0-9-]+(?:\\s+\\d+\\.\\d+\\.\\d+.*)?\\s*$", // With args
  ],
  run,
};
```

---

## Step 6: Register Command

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/registry-upload-command/src/installer/features/hooks/config/intercepted-slashcommands/registry.ts`

Add import and register:

```typescript
import { noriRegistryUpload } from "./nori-registry-upload.js";

export const interceptedSlashCommands: Array<InterceptedSlashCommand> = [
  noriDownloadProfile,
  noriInstallLocation,
  noriRegistryUpload,  // NEW
  noriSearchProfiles,
  noriSwitchProfile,
  noriToggleAutoupdate,
  noriToggleSessionTranscripts,
];
```

---

## Step 7: Create Slash Command Markdown

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/registry-upload-command/src/installer/features/profiles/config/_mixins/_base/slashcommands/nori-registry-upload.md` (NEW FILE)

```markdown
---
description: Upload a profile to the Nori registry
allowed-tools: Bash(nori-ai:*)
---

Upload a local profile to the Nori package registry.

Usage: /nori-registry-upload <profile-name> [version]

Examples:
- /nori-registry-upload my-profile
- /nori-registry-upload my-profile 1.0.0

This command packages the specified profile and uploads it to the Nori registry.

Requires registry authentication configured in .nori-config.json.
```

---

## Edge Cases

1. **Profile doesn't exist** - Return error with path where profile was expected
2. **No registry auth configured** - Return error with instructions for adding auth
3. **Auth token expired/invalid** - Let Firebase throw, catch and display auth error
4. **Network failure** - Let fetch throw, catch and display network error
5. **Version conflict (already exists)** - Registrar returns 409, display appropriate error
6. **Invalid profile structure** - Registrar returns 400, display validation error
7. **User not authorized for package** - Registrar returns 403, display permission error
8. **Multiple Nori installations** - Use closest installation (same as download command)

---

## Questions

1. **Version defaulting**: Should we default to "1.0.0" for first upload, or require version? Current plan defaults to "1.0.0".

2. **Profile validation**: Should we validate the profile structure locally before upload (check for CLAUDE.md, etc.), or let the server validate?

3. **Tarball format**: The server accepts both `.tgz` (gzipped) and plain `.tar`. Should we gzip for smaller upload size?

---

## Testing Details

Tests will verify:
- Config type correctly parses/saves `registryAuths` array
- `getRegistryAuth` finds correct auth by URL (with normalization)
- Slash command shows help when called without args
- Slash command returns error when profile not found
- Slash command returns error when no registry auth configured
- Slash command successfully uploads profile (mocked API)
- API upload function sends correct multipart form data with auth header

Tests focus on BEHAVIOR (command parsing, auth lookup, error messages) rather than implementation details.

---

## Implementation Details

- Follow existing intercepted slash command pattern from `nori-download-profile.ts`
- Use named parameters pattern: `const fn = (args: { foo: string }) => {}`
- Use `@/` imports throughout
- Use `== null` for null checks
- Reuse existing utilities: `getInstallDirs`, `loadConfig`, `formatSuccess`, `formatError`
- Use same Firebase config as existing auth (both systems use same Firebase project)
- Use `tar` library already in dependencies for creating tarballs

---
