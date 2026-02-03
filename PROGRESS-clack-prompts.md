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
