# @clack/prompts Migration TODO

High-level tasks for migrating CLI prompts to @clack/prompts.
Ordered approximately from smallest to largest effort.

## Setup & Foundation

- [x] Add @clack/prompts dependency and create src/cli/prompts/ directory structure
- [x] Implement utils.ts with cancel handling (handleCancel, isCancel re-export)
- [x] Implement validators.ts with extracted validation functions and unit tests

## Core Prompt Modules

- [x] Implement confirm.ts with confirm() wrapper and tests
- [x] Implement text.ts with validation wrapper and tests
- [x] Implement profile.ts with select() for profile selection and tests
- [x] Implement auth.ts with group() for bundled auth prompts and tests

## Command Migration

- [ ] Migrate login.ts to use new prompt modules (simplest: 2 prompts)
- [x] Migrate init.ts to use new prompt modules (single confirmation)
- [x] Migrate existingConfigCapture.ts to use new prompt modules (text with validation)
- [x] Migrate switch-profile/profiles.ts to use new prompt modules (select + confirm)
- [ ] Migrate onboard.ts to use new prompt modules (full flow, most complex)

## Cleanup & Polish

- [ ] Delete src/cli/prompt.ts and update all test mocks to use @clack/prompts
- [ ] Add spinners to async operations across all migrated commands
- [ ] Add intro/outro framing to commands for consistent UX
- [ ] Verify non-interactive mode still works for all commands
- [ ] Cross-platform testing on macOS and Linux terminals
