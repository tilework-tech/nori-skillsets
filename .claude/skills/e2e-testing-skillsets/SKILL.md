---
name: E2E Testing Nori Skillsets Subcommands
description: Use when you need to interactively test a nori-skillsets CLI subcommand end-to-end via tmux, with full filesystem isolation
---

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Run `e2e-setup` to build the project and create the isolated environment

```bash
source {{skills_dir}}/e2e-testing-skillsets/e2e-setup
```

The script prints the variables it exports. Verify `E2E_DIR`, `SKS`, and `NORI_GLOBAL_CONFIG` are set.

2. Read the TUI Puppeteering skill

```bash
Read {{skills_dir}}/tui-puppeteering-with-tmux/SKILL.md
```

Follow its instructions exactly. All tmux interaction goes through its scripts.

3. Write a test plan for the specified subcommand

Before touching tmux, write out a concrete plan:
- What subcommand you are testing and what behavior you want to verify
- What seed data you need to create in `$E2E_DIR` before launching the command
- The exact `tui-start` command you will use (must include the `env` wrapper shown below)
- The assert-act-assert sequence: what text you expect on screen, what input you will send, what text you expect after

4. Seed any required test data in `$E2E_DIR`

Many commands need pre-existing state. Create it directly in the filesystem:

```bash
# Example: create a fake skillset for switch/fork/edit to find
mkdir -p "$E2E_DIR/.nori/profiles/my-test-skillset"
echo '{"name":"my-test-skillset","version":"1.0.0","type":"skillset"}' > "$E2E_DIR/.nori/profiles/my-test-skillset/nori.json"
```

5. Execute the test using TUI puppeteering

Launch the command inside tmux with isolation env vars:

```bash
SCRIPTS="{{skills_dir}}/tui-puppeteering-with-tmux"
SESSION="sks-e2e-$$"

$SCRIPTS/tui-start "$SESSION" "env NORI_GLOBAL_CONFIG=$E2E_DIR node $SKS <subcommand> [args]"
```

Then follow the assert-act-assert loop from the TUI Puppeteering skill.

6. Verify filesystem side effects

After the command completes, check that the expected files were created/modified/deleted inside `$E2E_DIR`. Also verify that your real home directory was NOT touched.

7. Clean up

```bash
$SCRIPTS/tui-stop "$SESSION"
{{skills_dir}}/e2e-testing-skillsets/e2e-teardown
```

Always stop tmux first, then tear down the filesystem.
</required>

# Isolation Rules

<warning>
These rules are non-negotiable. Violating them risks corrupting the user's real configuration.
</warning>

- **All commands MUST run with `NORI_GLOBAL_CONFIG=$E2E_DIR`**. This env var redirects every path that `getHomeDir()` resolves: `~/.nori/`, `~/.nori-config.json`, `~/.claude/`, and anything else rooted at `$HOME`. Without it, the CLI writes to the real home directory.
- **Always use `env NORI_GLOBAL_CONFIG=$E2E_DIR node $SKS ...`** as the command passed to `tui-start`. Never run bare `nori-skillsets` or `sks`.
- **Never run `npm link`**. The built CLI is executed directly via `node`.
- **The e2e directory is always `/tmp/nori/skillsets-e2e-scenario/`**. The `e2e-setup` script wipes and recreates it on every run.
- **After the test, verify isolation**. Check that `~/.nori/` and `~/.claude/` were not modified. The `e2e-teardown` script does this automatically.

# UI Conventions to Assert

These are the authoritative conventions for nori-skillsets interactive subcommands. Use them to decide what to assert in your test plan.

## Framing

- Every interactive subcommand begins with a **clack intro** line. The intro text is a short, descriptive title in infinitive verb form (e.g., "Switch Skillset", "Initialize Nori"). It appears as a horizontal bar with the title.
- On success, every interactive subcommand ends with a **clack outro** line. The outro text uses past tense or describes the next step the user should take. It contains the most salient piece of information from the operation (e.g., the email that was logged in, the skillset name that was created).
- On cancellation, **no outro is displayed**. The flow returns silently after showing a clack cancel message (a short italic line like "Login cancelled.").
- On failure, some commands display an outro with the error and then exit with code 1 (via `exitOnFailure`). Others display the error inline (via `log.error`) and show a normal outro. Check the specific command's behavior.
- Uncaught exceptions always produce an outro prefixed with "Error: " followed by the error message, then exit with code 1.

## Prompts

- **Text inputs** show a message and an optional placeholder. Validation errors appear inline below the prompt.
- **Password inputs** mask characters. Otherwise identical to text.
- **Select menus** show a list of options. The user navigates with arrow keys and confirms with Enter.
- **Confirm prompts** show a yes/no question. The user presses `y` or `n`.
- **Group prompts** collect multiple inputs in sequence. If the user cancels any input in the group, the entire group is cancelled.
- Cancellation at any prompt produces a short cancel message (e.g., "Skillset creation cancelled.") and the command returns without showing an outro.

## Spinners

- Long-running operations are wrapped in a **clack spinner**. The spinner shows a start message (present participle, e.g., "Authenticating...") and a stop message (past tense, e.g., "Authenticated").
- On failure, the spinner stop message describes the failure (e.g., "Authentication failed").

## Notes

- **Notes** (`note(content, title)`) are used for multi-line structured information: change summaries, next steps, account details, artifact listings, diffs, warnings.
- Notes are never used for single-line errors. Use `log.error()` for that.
- If a hint or additional context accompanies an error, the error is shown via `log.error()` and the hint is shown in a separate note titled "Hint".
- Notes always appear before the outro, never after.

## Styling

- **Bold ANSI** (`\x1b[1m...\x1b[22m`) is used in success outro messages to highlight the most important dynamic value: a skillset name, an email address, a package@version. Only one or two values per outro are bolded.
- **Bold is NOT used** in error messages, cancel messages, spinner text, or note content.
- **No other ANSI styling** (colors, underline, etc.) is used in outro messages.
- Inside notes, `green` and `red` ANSI colors are used for diff content (added/removed lines). `bold` may highlight key values.
- To verify ANSI output, use `tui-capture -e` which preserves escape codes.

## Status Messages

- No trailing periods in outro messages.
- Double quotes around interpolated names (e.g., `Created new skillset "my-skillset"`).
- Status messages describe what was accomplished, not what was attempted.

## Exit Behavior

- Commands that represent a critical operation (fork, new, register, edit, factory-reset, download, upload, install) exit with code 1 on failure.
- Commands that represent a user preference (switch, init, config, watch, login) do NOT exit with code 1 on failure — they return normally.
- Cancelled commands never exit with code 1. They return normally with no outro.

# Subcommand Categories

## Fully Interactive (test via tmux)

These commands present interactive prompts and are the primary targets for e2e testing:

- `new` — collects name, optional description/license/keywords/version/repository via group prompt
- `fork <base> <new>` — no prompts, but shows notes and has error paths
- `switch [name]` — select menu if no name given, change detection with save/abort/view-diff options, confirm prompt
- `init` — persistence warning confirm, optional existing config capture with text prompt
- `factory-reset <agent>` — artifact listing note, "confirm" text prompt (must type exact string)
- `config` — interactive config editor
- `edit [name]` — select menu if no name given, opens editor
- `register [name]` — collects skillset metadata via group prompt

## Network-Dependent (out of scope for offline e2e)

These require registry access or authentication infrastructure:

- `login` — requires real auth credentials
- `upload` — requires registry access
- `download` — requires registry access
- `search` — requires registry access
- `install` — requires registry access
- `download-skill` — requires registry access
- `watch` — requires daemon lifecycle and org access

## Non-Interactive (test without tmux)

These produce raw output and can be tested by running them directly and checking stdout:

- `list` — prints skillset names, one per line
- `current` — prints the active skillset name
- `dir` — prints or opens a directory path
- `install-location` — prints the install location
- `completion` — prints shell completion script
- `clear` — clears managed configuration
- `logout` — removes auth credentials

# Tips

## Seeding Test Data

Most interactive commands need pre-existing state. Here are common patterns:

```bash
# Create a skillset (needed by: switch, fork, edit, register)
mkdir -p "$E2E_DIR/.nori/profiles/test-skillset"
cat > "$E2E_DIR/.nori/profiles/test-skillset/nori.json" << 'EOF'
{"name":"test-skillset","version":"1.0.0","type":"skillset"}
EOF

# Create a config file (needed by: switch, init, config)
cat > "$E2E_DIR/.nori-config.json" << 'EOF'
{"activeSkillset":"test-skillset","version":"1.0.0"}
EOF

# Create an agent config directory (needed by: init, switch, factory-reset)
mkdir -p "$E2E_DIR/.claude"
echo "# Test CLAUDE.md" > "$E2E_DIR/.claude/CLAUDE.md"

# Create a second skillset (needed by: switch selection menu)
mkdir -p "$E2E_DIR/.nori/profiles/other-skillset"
cat > "$E2E_DIR/.nori/profiles/other-skillset/nori.json" << 'EOF'
{"name":"other-skillset","version":"1.0.0","type":"skillset"}
EOF
```

## Interacting with Select Menus

Select menus in clack use arrow keys for navigation and Enter to confirm:

```bash
# Select the first option (it's already highlighted)
$SCRIPTS/tui-send "$SESSION" --keys "Enter"

# Select the second option
$SCRIPTS/tui-send "$SESSION" --keys "Down"
$SCRIPTS/tui-send "$SESSION" --keys "Enter"

# Select the third option
$SCRIPTS/tui-send "$SESSION" --keys "Down"
$SCRIPTS/tui-send "$SESSION" --keys "Down"
$SCRIPTS/tui-send "$SESSION" --keys "Enter"
```

## Interacting with Confirm Prompts

Confirm prompts in clack respond to arrow keys, not `y`/`n`:

```bash
# Accept (Yes is the default for most prompts)
$SCRIPTS/tui-send "$SESSION" --keys "Enter"

# Decline — move to "No" first
$SCRIPTS/tui-send "$SESSION" --keys "Left"
$SCRIPTS/tui-send "$SESSION" --keys "Enter"
```

## Typing into Text Prompts

```bash
# Type text and confirm
$SCRIPTS/tui-send "$SESSION" "my-skillset-name"
$SCRIPTS/tui-send "$SESSION" --keys "Enter"
```

## Checking Exit Codes

After the command finishes, check the exit code via the tmux pane:

```bash
# After the command completes, send 'echo $?' to see the exit code
$SCRIPTS/tui-send "$SESSION" "echo \$?"
$SCRIPTS/tui-send "$SESSION" --keys "Enter"
$SCRIPTS/tui-assert "$SESSION" "0" 5  # or "1" for expected failure
```

Note: this only works if `tui-start` was given a shell command like `bash -c 'env ... node $SKS ... ; echo EXIT:$?'` rather than the node command directly, because a direct node command exits the tmux pane on completion. Prefer wrapping in bash:

```bash
$SCRIPTS/tui-start "$SESSION" "bash -c 'env NORI_GLOBAL_CONFIG=$E2E_DIR node $SKS <subcommand> [args]; echo EXIT_CODE:\$?; exec bash'"
```

This keeps the pane alive after the command finishes so you can assert on exit code and inspect output.
