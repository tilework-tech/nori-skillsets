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

## Completed: Command Migration - login.ts (2026-02-03)

### Files Created/Modified

- `src/cli/prompts/password.ts` - `promptPassword()` wrapper for masked password input
- `src/cli/prompts/password.test.ts` - 4 tests for password behavior
- `src/cli/commands/login/login.ts` - Migrated from `promptUser` to `promptText`/`promptPassword`
- `src/cli/commands/login/login.test.ts` - Updated mocks from `@/cli/prompt.js` to `@clack/prompts`

### Migration Pattern

The login command used `promptUser()` from the old prompt system in 3 places:
1. **Email prompt** (interactive login): `promptUser({ prompt: "Email: " })` → `promptText({ message: "Email" })`
2. **Password prompt** (interactive login): `promptUser({ prompt: "Password: ", hidden: true })` → `promptPassword({ message: "Password" })`
3. **Auth code prompt** (headless Google OAuth): `promptUser({ prompt: "Paste authorization code: " })` → `promptText({ message: "Paste authorization code" })`

### Test Migration Pattern

Tests must mock `@clack/prompts` at module level:
```typescript
import * as clack from "@clack/prompts";

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  password: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

// In tests:
vi.mocked(clack.text).mockResolvedValueOnce("user@example.com");
vi.mocked(clack.password).mockResolvedValueOnce("password123");
```

### API

```typescript
const promptPassword = async (args: {
  message: string;
  placeholder?: string | null;
}): Promise<string>;
```

### Critical Notes for Future Migrations

1. **Message format change**: Old `promptUser` used `prompt: "Email: "` with trailing colon/space. New wrappers use `message: "Email"` without punctuation - @clack/prompts adds its own formatting.

2. **Import path**: Use `@/cli/prompts/index.js` (or specific modules) instead of `@/cli/prompt.js`.

3. **Cancel handling is automatic**: The new wrappers call `handleCancel()` internally when user cancels, so no need for explicit cancel checking in the command code.

4. **Non-interactive mode unchanged**: The login command's non-interactive mode (using CLI flags) bypasses all prompts entirely - no changes needed there.
