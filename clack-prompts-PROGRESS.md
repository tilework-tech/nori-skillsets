# @clack/prompts Migration Progress

## Completed: Setup & Foundation (2026-02-03)

### Files Created

- `src/cli/prompts/index.ts` - Re-exports all prompt utilities
- `src/cli/prompts/utils.ts` - Cancel handling (handleCancel, isCancel wrapper)
- `src/cli/prompts/validators.ts` - Validation functions for profile names, org IDs, required fields
- `src/cli/prompts/utils.test.ts` - 6 tests for cancel handling
- `src/cli/prompts/validators.test.ts` - 26 tests for validation functions

### Architecture Decisions

1. **Wrapper pattern for isCancel**: The `isCancel` function wraps @clack/prompts' isCancel with a named argument pattern (`{ value }`) to match the codebase style. This allows consistent API across all prompts modules.

2. **Validator return type**: Validators return `string | undefined` to match @clack/prompts validation callback signature. `undefined` = valid, `string` = error message.

3. **Validation pattern**: Both `validateProfileName` and `validateOrgId` use the same regex pattern `/^[a-z0-9]+(-[a-z0-9]+)*$/` which:
   - Requires lowercase alphanumeric
   - Allows hyphens but not at start/end
   - Prevents consecutive hyphens
   This matches the existing `isValidOrgId` in `src/utils/url.ts`.

4. **handleCancel never returns**: Typed as `never` since it always calls `process.exit(0)`. Tests mock `process.exit` to throw for verification.

### Test Mocking Pattern

Tests mock `@clack/prompts` at module level:
```typescript
vi.mock("@clack/prompts", () => ({
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));
```

This pattern should be reused for future prompt module tests.

## Completed: Core Prompt Modules - confirm.ts & text.ts (2026-02-03)

### Files Created

- `src/cli/prompts/confirm.ts` - `confirmAction()` wrapper for yes/no prompts
- `src/cli/prompts/text.ts` - `promptText()` wrapper for text input with validation
- `src/cli/prompts/confirm.test.ts` - 4 tests for confirm behavior
- `src/cli/prompts/text.test.ts` - 6 tests for text input behavior

### Architecture Decisions

1. **Named argument pattern**: Both `confirmAction({ message, initialValue? })` and `promptText({ message, placeholder?, defaultValue?, initialValue?, validate? })` follow the codebase's named argument convention.

2. **Validation adapter**: The `promptText` validate function adapts between the codebase's `{ value: string }` signature and @clack/prompts' `(value: string | undefined)` signature. When @clack/prompts passes `undefined`, we convert to empty string for validation.

3. **Cancel handling is uniform**: Both wrappers check `isCancel(result)` and call `handleCancel()` which exits with code 0.

### TypeScript Notes

- @clack/prompts' `text()` validate callback receives `string | undefined`, not just `string`. The wrapper handles this by using `value ?? ""` when calling the user's validator.

## Completed: Core Prompt Modules - auth.ts (2026-02-03)

### Files Created

- `src/cli/prompts/auth.ts` - `promptForAuth()` wrapper using group() for bundled auth prompts
- `src/cli/prompts/auth.test.ts` - 6 tests for auth behavior

### Architecture Decisions

1. **group() for bundled prompts**: Uses @clack/prompts' `group()` to bundle email, password, and org ID prompts together. This provides a cohesive auth flow with proper sequencing.

2. **Conditional prompts**: Password and org ID prompts are only shown if user provides a non-empty email. This is handled by returning `Promise.resolve(null)` from the prompt factory functions within `group()`.

3. **URL fallback support**: The org ID field accepts both:
   - Org ID format (e.g., "mycompany") → builds URL via `buildWatchtowerUrl()`
   - Full URL format (e.g., "https://custom.example.com") → normalizes via `normalizeUrl()`
   This preserves the existing behavior from `onboard.ts`.

4. **Skip auth pattern**: Empty email (or whitespace-only) returns `null`, signaling to caller that auth was skipped. Caller can then proceed without authentication.

5. **onCancel handler in group()**: Uses `group()`'s built-in `onCancel` option to call `handleCancel()`, providing consistent exit behavior.

### Test Mocking Pattern

Tests mock both `@clack/prompts` and `@/utils/url.js`:
```typescript
vi.mock("@clack/prompts", () => ({
  group: vi.fn(),
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/utils/url.js", () => ({
  buildWatchtowerUrl: vi.fn(({ orgId }) => `https://${orgId}.tilework.tech`),
  isValidUrl: vi.fn(({ input }) => { /* URL validation */ }),
  normalizeUrl: vi.fn(({ baseUrl }) => baseUrl.replace(/\/+$/, "")),
}));
```

### API

```typescript
type AuthCredentials = {
  username: string;
  password: string;
  organizationUrl: string;
};

const promptForAuth = async (): Promise<AuthCredentials | null>;
```

Returns `null` when user skips auth by entering empty email.

## Completed: Flow Module - switchSkillset.ts (2026-02-09)

### Files Created

- `src/cli/prompts/flows/switchSkillset.ts` - Complete switch-skillset flow using @clack/prompts
- `src/cli/prompts/flows/switchSkillset.test.ts` - 25 tests for the flow

### Files Modified

- `src/cli/prompts/flows/index.ts` - Added switchSkillset exports
- `src/cli/prompts/index.ts` - Added re-exports for switchSkillsetFlow, SwitchSkillsetCallbacks, SwitchSkillsetFlowResult
- `src/cli/commands/switch-profile/profiles.ts` - Added experimentalUi routing to switchSkillsetFlow
- `src/cli/commands/switch-profile/profiles.test.ts` - Added 3 experimental UI routing tests

### Architecture Decisions

1. **Flow pattern (not wrapper)**: Unlike the core prompt modules (confirm.ts, text.ts) which wrap individual @clack/prompts calls, switchSkillsetFlow is a self-contained flow module that orchestrates multiple @clack/prompts primitives (intro, outro, select, confirm, text, spinner, note, cancel). This follows the same pattern as loginFlow.

2. **Callback-based architecture**: The flow accepts a `SwitchSkillsetCallbacks` object with 6 callbacks:
   - `onResolveAgents` - Lists installed agents
   - `onDetectLocalChanges` - Compares manifest to detect user modifications
   - `onGetCurrentProfile` - Gets current profile name for display
   - `onCaptureConfig` - Saves current config as a new skillset
   - `onSwitchProfile` - Delegates to agent.switchProfile()
   - `onReinstall` - Runs silent install to regenerate files

   This keeps the flow pure of business logic, making it fully testable without filesystem, config, or agent dependencies.

3. **Direct @clack/prompts usage**: The flow uses select(), confirm(), text(), spinner(), note() directly rather than through wrapper modules. This is intentional — flows are the composition layer that uses primitives directly, while wrapper modules are for simple one-off prompts.

4. **experimentalUi routing**: The routing gate in `switchSkillsetAction` checks `experimentalUi && !nonInteractive` before dispatching to the flow. This matches the login command's pattern. The experimental UI path is completely independent — it reads globalOpts.experimentalUi directly from program.opts().

5. **Null return = cancellation**: The flow returns `SwitchSkillsetFlowResult | null`. Null means the user cancelled at any point (agent select, change handling, confirmation). The caller simply returns without side effects.

### Test Pattern

Tests mock `@clack/prompts` at module level, providing controllable return values for each prompt. Callbacks are mock functions that verify the flow orchestrates correctly. This pattern tests the flow's control logic without testing mocked behavior — assertions verify callback invocations with correct arguments.

### API

```typescript
type SwitchSkillsetCallbacks = {
  onResolveAgents: () => Promise<Array<{ name: string; displayName: string }>>;
  onDetectLocalChanges: (args: { installDir: string }) => Promise<ManifestDiff | null>;
  onGetCurrentProfile: (args: { agentName: string }) => Promise<string | null>;
  onCaptureConfig: (args: { installDir: string; profileName: string }) => Promise<void>;
  onSwitchProfile: (args: { installDir: string; agentName: string; profileName: string }) => Promise<void>;
  onReinstall: (args: { installDir: string; agentName: string }) => Promise<void>;
};

type SwitchSkillsetFlowResult = { agentName: string; profileName: string } | null;

const switchSkillsetFlow = async (args: {
  profileName: string;
  installDir: string;
  callbacks: SwitchSkillsetCallbacks;
}): Promise<SwitchSkillsetFlowResult>;
```
