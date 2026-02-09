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

## Completed: Command Migration - init.ts + existingConfigCapture.ts (2026-02-09)

### Files Created

- `src/cli/prompts/flows/init.ts` - `confirmPersistenceWarning()` and `existingConfigCaptureFlow()` using @clack/prompts
- `src/cli/prompts/flows/init.test.ts` - 15 unit tests for both flow functions

### Files Modified

- `src/cli/commands/init/init.ts` - Added `experimentalUi` parameter, routing to new flows when flag is set
- `src/cli/commands/init/init.test.ts` - Added 6 integration tests for `--experimental-ui` path
- `src/cli/commands/noriSkillsetsCommands.ts` - Passes `experimentalUi` from global opts to `initMain()`
- `src/cli/prompts/flows/index.ts` - Re-exports init flow functions
- `src/cli/prompts/index.ts` - Re-exports init flow functions

### Architecture Decisions

1. **Flow functions use @clack/prompts directly**: Unlike the login flow which uses the wrapper modules (`confirmAction`, `promptText`), the init flow calls `confirm()`, `text()`, `note()`, and `log.warn()` from `@clack/prompts` directly. This is because the flow functions ARE the wrappers for this command — they encapsulate the complete UI experience.

2. **UX change from legacy**: The legacy init requires typing the exact word "yes" for the persistence warning. The experimental UI uses `confirm()` (y/n), which is the standard @clack pattern and more user-friendly.

3. **Priority chain for routing**: `skipWarning` > `nonInteractive` > `experimentalUi` > legacy. This ensures auto-init flows (from `registryDownload`) and non-interactive mode are unaffected by the experimental UI flag.

4. **Refactored config capture deduplication**: The three branches (nonInteractive, experimentalUi, legacy) only differ in how the profile name is obtained. The shared `captureExistingConfigAsProfile()` call and success message were extracted after the branches.

### Integration Test Pattern for --experimental-ui

Tests mock the flow module at the top level alongside the legacy prompt mock:
```typescript
vi.mock("@/cli/prompts/flows/init.js", () => ({
  confirmPersistenceWarning: vi.fn().mockResolvedValue(false),
  existingConfigCaptureFlow: vi.fn().mockResolvedValue("my-profile"),
}));
```
Then each test overrides with `mockResolvedValueOnce` for its specific scenario. This pattern should be reused for other command migrations.
