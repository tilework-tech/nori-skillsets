# Multi-Agent Support Implementation Plan

**Goal:** Refactor the CLI to support multiple coding agents (starting with Claude Code) by restructuring `features/` to `agents/claude/` and adding an agent selection mechanism.

**Architecture:** Create a two-tier registry system where an `AgentRegistry` maps agent names to their respective `LoaderRegistry` instances. Each agent gets its own directory under `agents/` containing its loaders and configurations. The CLI will accept an `--agent` flag (defaulting to `claude-code`) that determines which agent's loaders to use.

**Tech Stack:** TypeScript, Commander.js for CLI, existing loader pattern

---

## Testing Plan

I will add unit tests that verify:

1. **AgentRegistry behavior**: Correctly maps agent names to loader registries, handles unknown agents with helpful errors
2. **CLI --agent flag parsing**: Validates flag is passed through correctly to install/uninstall/check commands
3. **Backward compatibility**: Default behavior (no --agent flag) works identically to current behavior

I will add integration tests that verify:
1. Install command works with `--agent claude-code` (explicit)
2. Install command works without --agent flag (implicit default)
3. Check and uninstall commands respect the --agent flag

NOTE: I will write *all* tests before I add any implementation behavior.

---

## Phase 1: Create Agent Registry Architecture

### Step 1.1: Create AgentRegistry type and file

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support/src/cli/agents/agentRegistry.ts`

Create a new file that:
- Defines `AgentConfig` type:
  ```typescript
  type AgentConfig = {
    name: string;
    description: string;
    getLoaderRegistry: () => LoaderRegistry;
    getSourceProfilesDir: () => string;  // Path to bundled profiles
  };
  ```
- Defines `AgentRegistry` class that maps agent names to `AgentConfig`
- Exports a singleton `agentRegistry` with `claude-code` registered
- Provides `getAgent(name)` that throws helpful error for unknown agents

### Step 1.2: Write tests for AgentRegistry

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support/src/cli/agents/agentRegistry.test.ts`

Test cases:
- `getAgent("claude-code")` returns valid agent config
- `getAgent("unknown")` throws error with list of valid agents
- `getAllAgents()` returns array with claude-code
- Agent's `getLoaderRegistry()` returns a LoaderRegistry instance

### Step 1.3: Run tests - expect failures

```bash
cd /home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support
npm test -- src/cli/agents/agentRegistry.test.ts
```

### Step 1.4: Implement AgentRegistry

Implement the minimal code to make tests pass.

### Step 1.5: Run tests - expect pass

```bash
npm test -- src/cli/agents/agentRegistry.test.ts
```

---

## Phase 2: Restructure features/ to agents/claude/

### Step 2.1: Create directory structure

```bash
cd /home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support/src/cli
mkdir -p agents/claude
```

### Step 2.2: Move features/ contents to agents/claude/

Move all files from `src/cli/features/` to `src/cli/agents/claude/`:
- `loaderRegistry.ts` → `agents/claude/loaderRegistry.ts`
- `announcements/` → `agents/claude/announcements/`
- `config/` → `agents/claude/config/`
- `hooks/` → `agents/claude/hooks/`
- `profiles/` → `agents/claude/profiles/`
- `statusline/` → `agents/claude/statusline/`
- `version/` → `agents/claude/version/`
- `docs.md` → `agents/claude/docs.md`

### Step 2.3: Update all imports

Update import paths from `@/cli/features/` to `@/cli/agents/claude/` in:

**Files that import from features/:**
- `src/cli/commands/install/install.ts`
- `src/cli/commands/uninstall/uninstall.ts`
- `src/cli/commands/check/check.ts`
- `src/cli/commands/uninstall/uninstall.test.ts`
- `src/cli/commands/uninstall/uninstall.cleanup.test.ts`
- `src/cli/commands/install/configurable-install-dir.integration.test.ts`
- All files within `agents/claude/` that use relative paths

### Step 2.4: Update tsconfig paths if needed

Check if `@/cli/agents/` path mapping needs to be added to `tsconfig.json`.

### Step 2.5: Run full test suite

```bash
npm test
```

All 617 tests should pass - this is a pure refactor with no behavior change.

---

## Phase 3: Add --agent CLI flag

### Step 3.1: Write tests for CLI agent flag

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support/src/cli/cli.test.ts` (or add to existing)

Test cases:
- `nori-ai install` uses default agent (claude-code)
- `nori-ai --agent claude-code install` explicitly uses claude-code
- `nori-ai --agent unknown install` shows error with valid agents
- Global --agent option is accessible from all subcommands

### Step 3.2: Run tests - expect failures

```bash
npm test -- src/cli/cli.test.ts
```

### Step 3.3: Update cli.ts to add --agent option

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support/src/cli/cli.ts`

Add global option:
```typescript
.option(
  "-a, --agent <name>",
  "Target coding agent (default: claude-code)",
  "claude-code"
)
```

### Step 3.4: Update install.ts to use agent registry

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support/src/cli/commands/install/install.ts`

- Import `agentRegistry` from `@/cli/agents/agentRegistry.js`
- Get agent name from global options
- Get LoaderRegistry via `agentRegistry.getAgent(agentName).getLoaderRegistry()`
- Replace direct `LoaderRegistry.getInstance()` calls

### Step 3.5: Update uninstall.ts to use agent registry

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support/src/cli/commands/uninstall/uninstall.ts`

Same pattern as install.ts.

### Step 3.6: Update check.ts to use agent registry

**File:** `/home/amol/code/nori/nori-profiles/.worktrees/multi-agent-support/src/cli/commands/check/check.ts`

Same pattern as install.ts.

### Step 3.7: Run tests - expect pass

```bash
npm test
```

---

## Phase 4: Update Documentation

### Step 4.1: Update src/cli/docs.md

Document the new agent architecture.

### Step 4.2: Update src/cli/agents/claude/docs.md

Update paths and explain this is the Claude Code agent implementation.

### Step 4.3: Update CLI help text

Ensure `--agent` flag is documented in help output.

---

## Phase 5: Final Verification

### Step 5.1: Run full test suite

```bash
npm test
```

### Step 5.2: Run lint and format

```bash
npm run format && npm run lint
```

### Step 5.3: Build

```bash
npm run build
```

### Step 5.4: Manual verification

```bash
# Test default behavior
node build/src/cli/cli.js install --help

# Test explicit agent
node build/src/cli/cli.js --agent claude-code install --help

# Test invalid agent error message
node build/src/cli/cli.js --agent invalid install
```

---

## Edge Cases

1. **Unknown agent name**: Should show helpful error listing valid agents
2. **Agent with no loaders**: AgentRegistry should validate agents have valid LoaderRegistry
3. **Config compatibility**: Existing installations should continue working (backward compatible)
4. **Path resolution**: `SOURCE_PROFILES_DIR` in install.ts uses `__dirname` relative path - needs updating for new directory structure

---

## Design Decisions (Confirmed)

1. **CLI style**: Flag-based (`--agent claude-code`) ✓

2. **Agent persistence**: Store installed agents in `nori-config.json` as a list:
   ```typescript
   type Config = {
     // ... existing fields ...
     installedAgents?: Array<string> | null;  // e.g., ["claude-code"]
   };
   ```

3. **SOURCE_PROFILES_DIR**: Move path resolution into `AgentConfig` so each agent provides its own profiles directory path. This keeps install.ts agent-agnostic.

---

**Testing Details:** Unit tests verify AgentRegistry maps names to loader registries and handles errors gracefully. Integration tests verify CLI commands work with both explicit `--agent` flag and default behavior. All tests focus on actual command behavior, not just mocked internals.

**Implementation Details:**
- Two-tier registry: AgentRegistry → LoaderRegistry per agent
- Directory restructure: `features/` → `agents/claude/`
- ~40 import path updates across codebase
- Single new CLI flag: `--agent <name>` with default `claude-code`
- Backward compatible: existing behavior unchanged when no flag provided
- Singleton pattern preserved for LoaderRegistry within each agent

**Questions:** All design questions resolved - ready to implement.

---
