# Epic: Migrate CLI Prompts to @clack/prompts

## Overview

Replace the custom `promptUser()` implementation with `@clack/prompts` to provide a polished, modern CLI experience with better UX patterns (arrow-key selection, spinners, grouped prompts, etc.).

## Current State

### Prompting Infrastructure
- **File**: `src/cli/prompt.ts` (120 lines)
- **Library**: Raw Node.js `readline` with manual raw-mode handling for passwords
- **Pattern**: Two functions:
  - `promptUser({ prompt, hidden?, masked? })` - General text input with optional masking
  - `promptYesNo({ prompt, defaultValue? })` - Boolean yes/no confirmation

### Testing Pattern
- Tests mock `promptUser` via `vi.mock("@/cli/prompt.js")`
- Mock returns are sequenced: `.mockResolvedValueOnce("value1").mockResolvedValueOnce("value2")`
- Tests verify behavior via filesystem state (config files created, profiles selected)

---

## Complete Catalog of Existing CLI Flows

This section catalogs ALL prompted, TUI, and interactive CLI flows within the `nori-skillsets` CLI.

### Commands Overview

| Command | Has Prompts | Prompt Count | File Location |
|---------|-------------|--------------|---------------|
| `login` | Yes | 4 paths (legacy, experimental, Google localhost, Google headless) | `src/cli/commands/login/login.ts` |
| `logout` | No | 0 | `src/cli/commands/logout/logout.ts` |
| `init` | Yes | 2 | `src/cli/commands/init/init.ts` |
| `install` | Yes | Delegates to init + onboard | `src/cli/commands/registry-install/registryInstall.ts` |
| `onboard` | Yes | 5 | `src/cli/commands/onboard/onboard.ts` |
| `switch-skillset` | Yes | 2 | `src/cli/commands/switch-profile/profiles.ts` |
| `search` | No | 0 | `src/cli/commands/registry-search/registrySearch.ts` |
| `download` | No* | 0 (delegates to init) | `src/cli/commands/registry-download/registryDownload.ts` |
| `download-skill` | No* | 0 (delegates to init) | `src/cli/commands/skill-download/skillDownload.ts` |
| `external` | No | 0 | `src/cli/commands/external/external.ts` |
| `watch` | Yes | 1 | `src/cli/commands/watch/watch.ts` |
| `list-skillsets` | No | 0 | `src/cli/commands/list-skillsets/listSkillsets.ts` |
| `install-location` | No | 0 | `src/cli/commands/install-location/installLocation.ts` |

*Commands marked with asterisk may trigger `init` flow on first run, which has its own prompts.

---

### Detailed Flow Catalog

#### Flow: Login Command (`nori-skillsets login`)

**File**: `src/cli/commands/login/login.ts`
**Main Function**: `loginMain()` (line 467)

**Path 1: Legacy Interactive Mode (default)**
Function: `authenticateWithLegacyPrompts()` (lines 332-465)

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 345 | `"Email: "` | Text | Collect user email |
| 354 | `"Password: "` | Masked (`masked: true`) | Collect password |

**Path 2: Experimental UI Mode (`--experimental-ui`)**
Function: `loginFlow()` from `src/cli/prompts/flows/login.ts` (lines 80-141)

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 90-92 | `"Email"` | @clack/prompts `text()` | Collect user email (grouped) |
| 93-95 | `"Password"` | @clack/prompts `password()` | Collect password (grouped) |

**Path 3: Google SSO Localhost (`--google`)**
Function: `authenticateWithGoogleLocalhost()` (lines 176-278)
- No prompts - opens browser automatically
- Optional SSH port-forwarding instructions displayed

**Path 4: Google SSO Headless (`--google --no-localhost`)**
Function: `authenticateWithGoogleHeadless()` (lines 108-175)

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 144 | `"Paste token: "` | Masked (`masked: true`) | User pastes OAuth token |

**Path 5: Auto-detect SSH with prompt**
Function: `authenticateWithGoogle()` (lines 280-324)

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 303 | `"Use headless authentication flow?"` | Yes/No (`promptYesNo`) | Choose auth method |

---

#### Flow: Init Command (`nori-skillsets init`)

**File**: `src/cli/commands/init/init.ts`
**Main Function**: `initMain()` (line 122)

| Line | Prompt Message | Input Type | Condition | Purpose |
|------|----------------|------------|-----------|---------|
| 77 (in `displayProfilePersistenceWarning()`) | `"Type 'yes' to confirm you understand: "` | Text (exact match) | Interactive mode | Confirm understanding of profile persistence |
| 361 (in `existingConfigCapture.ts`) | `"Enter a name for this skillset (lowercase letters, numbers, hyphens): "` | Text (validated) | Existing config detected | Name for captured skillset |

**Validation**: Skillset name must match `/^[a-z0-9-]+$/`

---

#### Flow: Onboard Command (`nori-skillsets onboard`)

**File**: `src/cli/commands/onboard/onboard.ts`
**Main Function**: `onboardMain()` (line 365)

**Auth Prompts** (function `promptForAuth()`, lines 64-127):

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 84 | `"Email address or hit enter to skip: "` | Text (optional) | Collect email or skip auth |
| 95 | `"Enter your password: "` | Masked (`masked: true`) | Collect password |
| 105 | `"Organization ID (the prefix to your URL, e.g., 'mycompany' for https://mycompany.tilework.tech): "` | Text (validated loop) | Collect org ID |

**Profile Selection** (function `promptForProfile()`, lines 170-205):

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 199 | `"Select a profile (1-{count}): "` | Numeric selection | Choose profile from numbered list |

**Existing Config Check** (in `onboardMain()`, lines 305-335):

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 333 | `"Keep existing configuration? (y/n): "` | Yes/No (y/Y match) | Reuse existing auth |

---

#### Flow: Switch Skillset Command (`nori-skillsets switch-skillset`)

**File**: `src/cli/commands/switch-profile/profiles.ts`
**Main Function**: `switchSkillsetAction()` (line 122)

**Agent Selection** (function `resolveAgent()`, lines 56-75):

| Line | Prompt Message | Input Type | Condition | Purpose |
|------|----------------|------------|-----------|---------|
| 70 | `"Select agent to switch skillset (1-{count}): "` | Numeric selection | Multiple agents installed | Choose which agent |

**Switch Confirmation** (function `confirmSwitchProfile()`, lines 78-120):

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 130 | `"Proceed with skillset switch? (y/n): "` | Yes/No (y/Y match) | Confirm before switching |

---

#### Flow: Watch Command (`nori-skillsets watch`)

**File**: `src/cli/commands/watch/watch.ts`
**Main Function**: `watchMain()` (line 412)

**Organization Selection** (function `selectTranscriptDestination()`, lines 323-381):

| Line | Prompt Message | Input Type | Condition | Purpose |
|------|----------------|------------|-----------|---------|
| 369 | `"Enter number (1-{count}): "` | Numeric selection | Multiple orgs, interactive mode | Select transcript upload destination |

**Auto-behaviors**:
- Single org: auto-selects without prompt
- Daemon mode with multiple orgs: auto-selects first org with warning
- No private orgs: skips upload functionality

---

#### Flow: Existing Config Capture (`init` with existing `.claude/`)

**File**: `src/cli/commands/install/existingConfigCapture.ts`
**Main Function**: `promptForExistingConfigCapture()` (line 309)

| Line | Prompt Message | Input Type | Purpose |
|------|----------------|------------|---------|
| 361 | `"Enter a name for this skillset (lowercase letters, numbers, hyphens): "` | Text (validated loop) | Name for saved skillset |

**Display before prompt** (lines 330-350):
```
Found existing Claude Code configuration:

  • CLAUDE.md found
  • X skill(s) found
  • X subagent(s) found
  • X slash command(s) found

This configuration will be saved locally as a skillset in ~/.nori/profiles/.
(Press Ctrl+C to abort if you do not want to save it.)
```

---

### Non-Interactive Commands (No Prompts)

#### `nori-skillsets logout`
**File**: `src/cli/commands/logout/logout.ts`
- Purely non-interactive
- Output: Info/success messages only
- Messages: `"Not currently logged in."` or `"Logged out successfully."`

#### `nori-skillsets search`
**File**: `src/cli/commands/registry-search/registrySearch.ts`
- Query-driven (argument-based)
- Output: Formatted search results or error messages
- No user input during execution

#### `nori-skillsets download` / `nori-skillsets download-skill`
**Files**: `src/cli/commands/registry-download/registryDownload.ts`, `src/cli/commands/skill-download/skillDownload.ts`
- Non-interactive download operations
- May trigger `init` flow on first run (which has prompts)
- `--list-versions` flag shows available versions without prompting

#### `nori-skillsets external`
**File**: `src/cli/commands/external/external.ts`
- Entirely flag-driven (no prompts)
- Errors with helpful messages when ambiguous (e.g., multiple skills found)
- Requires `--skill` or `--all` flag when multiple skills discovered

#### `nori-skillsets list-skillsets`
**File**: `src/cli/commands/list-skillsets/listSkillsets.ts`
- Read-only display command
- Output: One profile name per line (raw text)

#### `nori-skillsets install-location`
**File**: `src/cli/commands/install-location/installLocation.ts`
- Read-only display command
- Two output modes: interactive (formatted) and non-interactive (plain paths)

---

### promptUser Usage Summary

**Total calls across codebase**: 13

| Command | File | Calls | Input Types |
|---------|------|-------|-------------|
| login | `login.ts` | 4 | Text, Masked, Yes/No |
| onboard | `onboard.ts` | 5 | Text, Masked, Numeric, Yes/No |
| init | `init.ts` | 1 | Text (exact "yes") |
| existingConfigCapture | `existingConfigCapture.ts` | 1 | Text (validated) |
| switch-profile | `profiles.ts` | 2 | Numeric, Yes/No |
| watch | `watch.ts` | 1 | Numeric |

**Input Type Distribution**:
- Normal text: 8 calls
- Masked (`masked: true`): 3 calls (passwords, tokens)
- Hidden (`hidden: true`): 0 calls (deprecated in favor of masked)
- Numeric selection: 4 calls (profile, agent, org selection)
- Yes/No patterns: 4 calls

---

## Stepper Flows to Introduce

### Flow 1: Installation Wizard (`nori-skillsets install`)

**Steps**: init → onboard → switch-profile

```
┌─────────────────────────────────────────────────────┐
│  Welcome to Nori Skillsets                          │
└─────────────────────────────────────────────────────┘

◇ Step 1: Initialize
│ Creating .nori-config.json...
│ Creating .nori/profiles/...
└ Done

◆ Step 2: Configure (optional)
│
│ ○ Email: user@example.com
│ ○ Password: ********
│ ○ Organization ID: mycompany
│
└ Authenticated successfully

◆ Step 3: Select Profile
│
│ ● senior-swe (Installed profile)
│ ○ product-manager (Installed profile)
│ ○ amol (Installed profile)
│
└ Selected: senior-swe

◇ Installing profile...
│ Loading skills...
│ Configuring hooks...
└ Done

└ Installation complete!
```

**@clack components**:
- `intro()` - Welcome banner
- `spinner()` - Progress indicators
- `group()` - Bundle auth prompts (email, password, org ID)
- `select()` - Profile selection with arrow keys
- `outro()` - Completion message

### Flow 2: Authentication Flow (`nori-skillsets login`)

**Current location**: `src/cli/commands/login/login.ts:255-261`

```
◆ Login to Nori Skillsets
│
│ ○ Email: user@example.com
│ ○ Password: ********
│
├ Authenticating...
└ Logged in as user@example.com
```

**@clack components**:
- `text()` - Email input
- `password()` - Password input (masked)
- `spinner()` - Auth progress
- `note()` - Display organization access info

### Flow 3: Profile Switch (`nori-skillsets switch-skillset`)

**Current location**: `src/cli/commands/switch-profile/profiles.ts:56-77, 119-123`

```
◆ Switch Skillset
│
│ Multiple agents installed:
│ ● claude-code (Claude Code)
│ ○ cursor-agent (Cursor)
│
├ Selected: claude-code
│
│ Current: senior-swe → New: product-manager
│
◆ Proceed with switch? (Y/n)
│
└ Switched to: product-manager
```

**@clack components**:
- `select()` - Agent selection (when multiple installed)
- `confirm()` - Switch confirmation
- `spinner()` - Reinstall progress

### Flow 4: Existing Config Capture (`init` with existing `.claude/`)

**Current location**: `src/cli/commands/install/existingConfigCapture.ts:360-374`

```
◆ Existing Configuration Detected
│
│ Found:
│   • CLAUDE.md
│   • 3 skills
│   • 2 subagents
│
◆ Save as local skillset?
│
│ ○ Skillset name: my-workflow
│   (lowercase letters, numbers, hyphens)
│
└ Saved to ~/.nori/profiles/my-workflow/
```

**@clack components**:
- `note()` - Display detected config
- `text()` - Skillset name with validation callback

### Flow 5: Onboarding Auth + Profile Selection

**Current location**: `src/cli/commands/onboard/onboard.ts:64-218`

This is the most complex flow, combining auth and profile selection:

```
◆ Nori Web Configuration (optional)
│
│ If you have access to Nori Web, enter your credentials.
│ Learn more at usenori.ai
│
│ ○ Email (or press Enter to skip): user@example.com
│ ○ Password: ********
│ ○ Organization ID: mycompany
│
└ Authenticated

◆ Select Profile
│
│ Nori profiles contain a complete configuration for
│ customizing your coding agent.
│
│ ● senior-swe
│ ○ product-manager
│ ○ amol
│
└ Loading "senior-swe" profile...
```

**@clack components**:
- `group()` - Optional auth flow (email can be empty to skip)
- `select()` - Profile selection
- `spinner()` - Profile loading

### Flow 6: Watch Daemon Setup (`nori-skillsets watch`)

**Current location**: `src/cli/commands/watch/watch.ts:323-381`

This flow handles transcript upload destination selection when multiple organizations are available:

```
◆ Watch Daemon Setup
│
│ Select organization for transcript uploads:
│
│ ● myorg (Organization 1)
│ ○ another-org (Organization 2)
│ ○ third-org (Organization 3)
│
└ Selected: myorg

◇ Starting watch daemon...
│ Installing transcript hook...
│ Monitoring Claude Code sessions...
└ Watch daemon started (PID: 12345)
```

**@clack components**:
- `select()` - Organization selection with arrow keys
- `spinner()` - Daemon startup progress
- `outro()` - Completion message with PID and log location

**Auto-behaviors to preserve**:
- Single org: auto-select without prompt
- Daemon mode: auto-select first org with warning message
- No private orgs: skip upload functionality silently

### Flow 7: Google SSO with Headless Detection (`nori-skillsets login --google`)

**Current location**: `src/cli/commands/login/login.ts:280-324`

When SSH/headless environment is detected with Google SSO:

```
◆ Google Authentication
│
│ Detected SSH/headless environment.
│ You can use a simplified headless flow that works without port forwarding.
│
◆ Use headless authentication flow? (Y/n)
│
├ [If yes] Opening headless auth...
│   1. Open the URL in any browser
│   2. Complete the Google sign-in
│   3. Copy the token from the page
│
│ ○ Paste token: ****************************
│
└ Signed in successfully
│
├ [If no] Opening localhost auth...
│   To authenticate from this remote session:
│   1. Run: ssh -L 8989:localhost:8989 <user>@<server>
│   2. Open the URL in your local browser
│
└ Waiting for authentication...
```

**@clack components**:
- `confirm()` - Headless flow confirmation
- `text()` with `mask` - Token paste input
- `note()` - Instructions display
- `spinner()` - Auth waiting indicator

---

## Code Structure After Refactoring

### New Module: `src/cli/prompts/`

```
src/cli/prompts/
├── index.ts           # Re-exports all prompts
├── auth.ts            # promptForAuth() using group()
├── profile.ts         # promptForProfile() using select()
├── confirm.ts         # confirmAction() using confirm()
├── text.ts            # promptText() with validation wrapper
└── utils.ts           # Shared utilities (cancel handling, etc.)
```

### File: `src/cli/prompts/index.ts`

```typescript
export { promptForAuth, type AuthCredentials } from "./auth.js";
export { promptForProfile, type ProfileSelection } from "./profile.js";
export { confirmAction } from "./confirm.js";
export { promptText, promptProfileName } from "./text.js";
export { handleCancel, isCancel } from "./utils.js";
```

### File: `src/cli/prompts/auth.ts`

```typescript
import { group, text, password, isCancel, cancel } from "@clack/prompts";
import { handleCancel } from "./utils.js";

export type AuthCredentials = {
  username: string;
  password: string;
  organizationUrl: string;
} | null;

export const promptForAuth = async (): Promise<AuthCredentials> => {
  const result = await group(
    {
      username: () =>
        text({
          message: "Email address (or press Enter to skip)",
          placeholder: "user@example.com",
        }),
      password: ({ results }) => {
        if (!results.username) return Promise.resolve(null);
        return password({
          message: "Password",
          mask: "*",
        });
      },
      organizationUrl: ({ results }) => {
        if (!results.username) return Promise.resolve(null);
        return text({
          message: "Organization ID",
          placeholder: "mycompany",
          validate: (value) => {
            if (!value) return "Organization ID is required";
            if (!/^[a-z0-9-]+$/.test(value)) {
              return "Use lowercase letters, numbers, and hyphens only";
            }
          },
        });
      },
    },
    {
      onCancel: () => handleCancel(),
    }
  );

  if (!result.username) return null;

  return {
    username: result.username,
    password: result.password!,
    organizationUrl: buildWatchtowerUrl({ orgId: result.organizationUrl! }),
  };
};
```

### File: `src/cli/prompts/profile.ts`

```typescript
import { select, isCancel } from "@clack/prompts";
import { handleCancel } from "./utils.js";

export type ProfileSelection = { baseProfile: string };

export const promptForProfile = async (args: {
  profiles: Array<{ name: string; description: string }>;
}): Promise<ProfileSelection> => {
  const { profiles } = args;

  const selected = await select({
    message: "Select a profile",
    options: profiles.map((p) => ({
      value: p.name,
      label: p.name,
      hint: p.description,
    })),
  });

  if (isCancel(selected)) handleCancel();

  return { baseProfile: selected as string };
};
```

### File: `src/cli/prompts/utils.ts`

```typescript
import { cancel, isCancel as clackIsCancel } from "@clack/prompts";

export const isCancel = clackIsCancel;

export const handleCancel = (): never => {
  cancel("Operation cancelled.");
  process.exit(0);
};
```

### Migration of Existing Commands

Each command file (`init.ts`, `onboard.ts`, `login.ts`, `profiles.ts`, `existingConfigCapture.ts`) will:

1. Replace `import { promptUser } from "@/cli/prompt.js"` with imports from `@/cli/prompts/`
2. Replace manual loops and numbered menus with `select()`
3. Replace y/n string checks with `confirm()`
4. Add `intro()` / `outro()` framing where appropriate
5. Add `spinner()` for async operations

### Deprecation of `src/cli/prompt.ts`

After migration is complete, delete `src/cli/prompt.ts`. All tests that mock it will instead mock the new `@/cli/prompts/` module functions.

---

## Automated Testing Strategy

### Approach: Mock @clack/prompts at Module Level

Tests will mock `@clack/prompts` rather than our wrapper functions. This tests our integration logic while avoiding actual TTY interactions.

### Test File Structure

```
src/cli/prompts/
├── auth.test.ts
├── profile.test.ts
├── confirm.test.ts
└── text.test.ts

src/cli/commands/onboard/
├── onboard.test.ts      # Integration tests for full flow
```

### Expected Behaviors Under Test

#### 1. Auth Flow (`auth.test.ts`)

| Test Case | Input Sequence | Expected Outcome |
|-----------|----------------|------------------|
| Skip auth | `group()` returns `{ username: "" }` | Returns `null` |
| Complete auth | `group()` returns `{ username: "user@example.com", password: "pass", organizationUrl: "myorg" }` | Returns `AuthCredentials` with built URL |
| Cancel during auth | `group()` throws cancel | Calls `process.exit(0)` |
| Invalid org ID | Validation rejects `"My Company"` | Validation error message returned |
| Valid org ID | Validation accepts `"my-company"` | No error |

#### 2. Profile Selection (`profile.test.ts`)

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| Select first profile | `select()` returns `"senior-swe"` | Returns `{ baseProfile: "senior-swe" }` |
| Select from multiple | `select()` returns `"product-manager"` | Returns correct selection |
| Cancel selection | `select()` returns cancel symbol | Calls `process.exit(0)` |
| Empty profiles list | `profiles: []` | Throws error before prompting |

#### 3. Confirmation (`confirm.test.ts`)

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| User confirms | `confirm()` returns `true` | Returns `true` |
| User declines | `confirm()` returns `false` | Returns `false` |
| User cancels | `confirm()` returns cancel symbol | Calls `process.exit(0)` |

#### 4. Text Input with Validation (`text.test.ts`)

| Test Case | Input | Expected Outcome |
|-----------|-------|------------------|
| Valid profile name | `"my-profile"` | Returns `"my-profile"` |
| Name with spaces | `"my profile"` | Validation error |
| Name with uppercase | `"My-Profile"` | Validation error |
| Empty name | `""` | Validation error |
| Cancel input | Cancel symbol | Calls `process.exit(0)` |

### Integration Test Pattern

```typescript
// src/cli/commands/onboard/onboard.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as clack from "@clack/prompts";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  group: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
}));

describe("onboard command with @clack/prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should complete full onboard flow with auth and profile selection", async () => {
    // Arrange: Mock the sequence of prompts
    vi.mocked(clack.group).mockResolvedValueOnce({
      username: "test@example.com",
      password: "password123",
      organizationUrl: "myorg",
    });
    vi.mocked(clack.select).mockResolvedValueOnce("senior-swe");

    // Act: Run onboard
    await onboardMain({ installDir: tempDir, agent: "claude-code" });

    // Assert: Verify prompts were called
    expect(clack.group).toHaveBeenCalledTimes(1);
    expect(clack.select).toHaveBeenCalledTimes(1);

    // Assert: Verify config was saved correctly
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    expect(config.auth.username).toBe("test@example.com");
    expect(config.agents["claude-code"].profile.baseProfile).toBe("senior-swe");
  });

  it("should skip auth when user provides empty email", async () => {
    // Arrange: Mock empty email (skip auth)
    vi.mocked(clack.group).mockResolvedValueOnce({
      username: "",
    });
    vi.mocked(clack.select).mockResolvedValueOnce("senior-swe");

    // Act
    await onboardMain({ installDir: tempDir, agent: "claude-code" });

    // Assert: Config should have no auth
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    expect(config.auth).toBeUndefined();
  });

  it("should exit gracefully on cancel", async () => {
    // Arrange: Mock cancel during group
    vi.mocked(clack.group).mockRejectedValueOnce(new Error("cancelled"));
    vi.mocked(clack.isCancel).mockReturnValue(true);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    // Act & Assert
    await expect(
      onboardMain({ installDir: tempDir, agent: "claude-code" })
    ).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
```

### Non-Interactive Mode Tests

Non-interactive mode should bypass all @clack prompts:

```typescript
it("should not call any prompts in non-interactive mode", async () => {
  await onboardMain({
    installDir: tempDir,
    nonInteractive: true,
    profile: "senior-swe",
    agent: "claude-code",
  });

  // No prompts should be called
  expect(clack.group).not.toHaveBeenCalled();
  expect(clack.select).not.toHaveBeenCalled();
  expect(clack.confirm).not.toHaveBeenCalled();
});
```

### Validation Function Tests

Validation functions should be extracted and tested in isolation:

```typescript
// src/cli/prompts/validators.ts
export const validateProfileName = (value: string): string | undefined => {
  if (!value || value.trim() === "") {
    return "Profile name is required";
  }
  if (!/^[a-z0-9-]+$/.test(value)) {
    return "Use lowercase letters, numbers, and hyphens only";
  }
  return undefined; // Valid
};

// src/cli/prompts/validators.test.ts
describe("validateProfileName", () => {
  it("returns error for empty string", () => {
    expect(validateProfileName("")).toBe("Profile name is required");
  });

  it("returns error for uppercase letters", () => {
    expect(validateProfileName("MyProfile")).toBe(
      "Use lowercase letters, numbers, and hyphens only"
    );
  });

  it("returns error for spaces", () => {
    expect(validateProfileName("my profile")).toBe(
      "Use lowercase letters, numbers, and hyphens only"
    );
  });

  it("returns undefined for valid name", () => {
    expect(validateProfileName("my-profile-123")).toBeUndefined();
  });
});
```

---

## Migration Checklist

### Phase 1: Setup
- [x] Add `@clack/prompts` dependency
- [x] Create `src/cli/prompts/` directory structure
- [x] Implement `utils.ts` with cancel handling

### Phase 2: Core Prompts
- [x] Implement `text.ts` with validation wrapper
- [x] Implement `confirm.ts`
- [x] Implement `profile.ts` with select
- [x] Implement `auth.ts` with group
- [ ] Add tests for each prompt module

### Phase 3: Command Migration (in order of complexity)

| Priority | Command | File | Prompts | Status |
|----------|---------|------|---------|--------|
| 1 | `login` | `login.ts` | 2 (email, password) | ✅ `loginFlow()` implemented |
| 2 | `init` | `init.ts` | 1 (exact "yes" confirmation) | ⬜ Pending |
| 3 | `existingConfigCapture` | `existingConfigCapture.ts` | 1 (validated text) | ⬜ Pending |
| 4 | `switch-skillset` | `profiles.ts` | 2 (select + confirm) | ⬜ Pending |
| 5 | `onboard` | `onboard.ts` | 5 (auth group + profile select + confirm) | ⬜ Pending |
| 6 | `watch` | `watch.ts` | 1 (org selection) | ⬜ Pending |

### Phase 4: Cleanup
- [ ] Delete `src/cli/prompt.ts`
- [ ] Update all test mocks to use @clack/prompts
- [ ] Add spinners to async operations
- [ ] Add intro/outro framing to commands

### Phase 5: Polish
- [ ] Ensure consistent styling across all flows
- [ ] Test on both macOS and Linux terminals
- [ ] Verify non-interactive mode still works
- [ ] Update any documentation referencing old prompts

---

## Dependencies

```json
{
  "dependencies": {
    "@clack/prompts": "^0.7.0"
  }
}
```

## References

- [@clack/prompts documentation](https://github.com/natemoo-re/clack)
- [Current prompt implementation](src/cli/prompt.ts)
- [Existing test patterns](src/cli/commands/onboard/onboard.test.ts)
