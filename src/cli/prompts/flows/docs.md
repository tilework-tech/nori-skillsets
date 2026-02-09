# Noridoc: flows

Path: @/src/cli/prompts/flows

### Overview

- Complete interactive flow modules built on @clack/prompts that compose multiple prompts, spinners, notes, and intro/outro into cohesive CLI experiences
- Each flow uses a callbacks pattern to separate UI handling from business logic, making flows testable and reusable
- Currently provides loginFlow (authentication) and switchSkillsetFlow (skillset switching with local change detection)

### How it fits into the larger codebase

- CLI commands in @/cli/commands/ import flows to handle multi-step interactive sequences instead of managing prompt logic inline
- Flows use @clack/prompts primitives directly (intro, outro, select, confirm, text, spinner, note, cancel) rather than going through the individual prompt wrappers in the parent @/cli/prompts/ directory
- Flows are re-exported through @/cli/prompts/flows/index.ts and again through @/cli/prompts/index.ts so commands can import from either level
- The switchSkillsetFlow is consumed by the switch-profile command (@/cli/commands/switch-profile/profiles.ts) when the --experimental-ui flag is active
- Validators from @/cli/prompts/validators.ts are used within flows for input validation (e.g., validateProfileName in switchSkillsetFlow)

### Core Implementation

- **Callback pattern:** Each flow accepts a callbacks object containing async functions for all side-effectful operations (API calls, file I/O, config mutations). The flow itself only handles UI. This makes flows fully testable by injecting mock callbacks.
- **Return convention:** Flows return a typed result object on success or null on cancellation/abort. The flow handles displaying cancel messages internally via @clack/prompts cancel().
- **loginFlow:** Collects email/password credentials, runs authentication via callback, displays organization info in a note box, and returns the auth result.
- **switchSkillsetFlow:** Multi-step flow that resolves which agent to switch, detects local changes (with options to proceed/capture/abort), shows switch details in a note, confirms with the user, then executes the switch and reinstall via spinners. Accepts 6 callbacks covering the full switch lifecycle.

### Things to Know

- Flows use @clack/prompts isCancel() directly (not the wrapper in utils.ts) since they work with raw @clack/prompts return values rather than the named-args wrappers
- The switchSkillsetFlow's buildChangesSummary helper truncates file lists to 5 entries per category (modified/added/deleted) with a "... and N more" overflow message
- When a flow returns null, the command should treat it as a clean cancellation -- the flow has already displayed the appropriate cancel message to the user
- The experimental UI gate (`experimentalUi && !nonInteractive`) lives in the command handler, not in the flow itself. Flows have no awareness of feature flags.

Created and maintained by Nori.
