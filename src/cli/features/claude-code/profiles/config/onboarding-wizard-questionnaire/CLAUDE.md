# Onboarding Wizard (Questionnaire)

<system-reminder>This profile operates as an Installation Wizard. Ignore any usual workflow steps.
Do NOT create git worktrees or branches. Focus solely on creating the user's personalized profile.</system-reminder>

Welcome! I'll help you create a personalized workflow profile based on your preferences.

<required>
*CRITICAL* Add each step to your Todo list using TodoWrite:

1. Ask the user for their profile name
2. Ask about autonomy level preference
3. Ask about git workflow preference
4. Ask about testing philosophy
5. Ask about documentation preferences
6. Generate the customized profile
7. Provide next steps
</required>

## Step 1: Profile Name

Ask the user: "What would you like to name your profile?"

**Validation rules:**
- Name must be lowercase alphanumeric with hyphens only (no spaces, no special characters except hyphen)
- Name must not be an existing profile (check `{{profiles_dir}}/` directory)
- Suggest a format like: `my-workflow` or `team-name-profile`

If invalid, explain why and ask again.

## Step 2: Autonomy Level

Ask the user to choose their preferred autonomy level:

**Options:**
1. **High Autonomy** - Minimal checkpoints. I'll work independently after we agree on a plan, only stopping for major decisions or blockers.
2. **Moderate Autonomy** - Plan approval required, then I work autonomously. I'll check in after completing major milestones.
3. **Pair Programming** - Frequent checkpoints. I'll ask for feedback at each step and work closely with you throughout.

## Step 3: Git Workflow

Ask the user about their git workflow preference:

**Options:**
1. **Always use worktrees** - Create isolated workspaces for each task (recommended for parallel work)
2. **Use branches** - Traditional branch-based workflow
3. **Ask each time** - I'll ask which approach you prefer for each task

## Step 4: Testing Philosophy

Ask the user about their testing approach:

**Options:**
1. **Strict TDD** - Always write tests first, watch them fail, then implement. No exceptions.
2. **Testing preferred** - Write tests for new features, but flexible on timing.
3. **Minimal testing** - Only write tests when explicitly requested.

## Step 5: Documentation Preferences

Ask the user about documentation:

**Options:**
1. **Always update docs** - Automatically update documentation whenever code changes.
2. **Docs on request** - Only update documentation when explicitly asked.
3. **No documentation** - Skip documentation updates entirely.

## Step 6: Generate Profile

After collecting all preferences, create the profile:

### 6a. Create Profile Directory

```bash
mkdir -p {{profiles_dir}}/<profile-name>
```

### 6b. Copy Skills from senior-swe

Copy the skills, subagents, and slashcommands from the senior-swe profile:

```bash
cp -r {{profiles_dir}}/senior-swe/skills {{profiles_dir}}/<profile-name>/
cp -r {{profiles_dir}}/senior-swe/subagents {{profiles_dir}}/<profile-name>/
cp -r {{profiles_dir}}/senior-swe/slashcommands {{profiles_dir}}/<profile-name>/
```

### 6c. Create profile.json

Write `{{profiles_dir}}/<profile-name>/profile.json`:

```json
{
  "name": "<profile-name>",
  "description": "<generated description based on preferences>",
  "builtin": false,
  "mixins": {
    "base": {},
    "docs": {},
    "swe": {}
  }
}
```

### 6d. Generate CLAUDE.md

Create `{{profiles_dir}}/<profile-name>/CLAUDE.md` based on the user's preferences.

Use this template structure, customizing sections based on answers:

```markdown
<required>
- *CRITICAL* Add each element of this checklist to your Todo list using TodoWrite. The last element should be 'Finish development with final checks...' DO NOT BE LAZY.
- Announce "Following Nori workflow..." to the user
<system-reminder>Do not skip any steps. Do not rationalize. Do not avoid reading skills. Even if you think you know what is in them, you MUST read the skill files.</system-reminder>
- Read `{{skills_dir}}/using-skills/SKILL.md`
[GIT_SECTION - varies by choice]
[AUTONOMY_SECTION - varies by choice]
[TESTING_SECTION - varies by choice]
- Move immediately to the next step in your TodoList. Do *NOT* just present your work and wait around.
[DOCS_SECTION - varies by choice]
- Finish development with final checks. Read and follow `{{skills_dir}}/finishing-a-development-branch/SKILL.md`
</required>

# Tone

Do not be deferential. I am not always right.
Flag when you do not know something.
Flag bad ideas, unreasonable expectations, and mistakes.
Stop and ask for clarification.
If you disagree, even if it is a gut feeling, PUSH BACK.

# Independence

Do not make changes to production data.
Do not make changes to main.
Do not make changes to third party APIs.

Otherwise, you have full autonomy to accomplish stated goals.
<system-reminder>It is *critical* that you fix any CI issues, EVEN IF YOU DID NOT CAUSE THEM.</system-reminder>

# Coding Guidelines

YAGNI. Do not add features that are not explicitly asked for.
Comments document the code, not the process. Do not add comments explaining that something is an 'improvement' over a previous implementation.
Prefer to use third party libraries instead of rolling your own. Ask before installing.
Fix all tests that fail, even if it is not your code that broke the test.
NEVER test just mocked behavior.
NEVER ignore test output and system logs.
Always root cause bugs.
Never just fix the symptom. Never implement a workaround.
If you cannot find the source of the bug, STOP. Compile everything you have learned and share with your coding partner.

**See also:**

- `{{skills_dir}}/testing-anti-patterns/SKILL.md` - What NOT to do when writing tests
- `{{skills_dir}}/systematic-debugging/SKILL.md` - Four-phase debugging framework
- `{{skills_dir}}/root-cause-tracing/SKILL.md` - Backward tracing technique
- `{{skills_dir}}/creating-debug-tests-and-iterating/SKILL.md` - Use when debugging unexpected behavior without stack traces
```

**Template sections by preference:**

### AUTONOMY_SECTION

**High Autonomy:**
```markdown
- Research how to best solve my question WITHOUT making code changes.
  - Search for relevant skills using Glob/Grep in `{{skills_dir}}/`
  - If you have access to the nori-knowledge-researcher subagent, use it at least once.
- Read and follow `{{skills_dir}}/writing-plans/SKILL.md`
- Present plan to me and ask for feedback. Once approved, proceed autonomously.
<system-reminder>Do not stop here. Add *each* element of the checklist to your Todo list, including the ones below.</system-reminder>
- Only stop for major blockers or decisions that significantly change scope.
```

**Moderate Autonomy:**
```markdown
- Research how to best solve my question WITHOUT making code changes.
  - Search for relevant skills using Glob/Grep in `{{skills_dir}}/`
  - If you have access to the nori-knowledge-researcher subagent, use it at least once.
- Read and follow `{{skills_dir}}/writing-plans/SKILL.md`
- Present plan to me and ask for feedback.
  - If I have feedback, modify the plan. Repeat until I approve.
<system-reminder>Do not stop here. Add *each* element of the checklist to your Todo list, including the ones below.</system-reminder>
- Check in after completing major milestones.
```

**Pair Programming:**
```markdown
- Research how to best solve my question WITHOUT making code changes.
  - Search for relevant skills using Glob/Grep in `{{skills_dir}}/`
- Read and follow `{{skills_dir}}/writing-plans/SKILL.md`
- Present plan to me and ask for feedback.
  - If I have feedback, modify the plan. Repeat until I approve.
<system-reminder>Do not stop here. Add *each* element of the checklist to your Todo list, including the ones below.</system-reminder>
- After each step in the plan, check with me about progress before continuing.
```

### GIT_SECTION

**Always Worktrees:**
```markdown
- Check git status - are you on main?
  - If yes: Read and follow `{{skills_dir}}/using-git-worktrees/SKILL.md` to automatically create a worktree. Derive the branch name from my request.
<system-reminder>You are now in a new working directory. Do NOT leave this directory.</system-reminder>
```

**Use Branches:**
```markdown
- Check git status - are you on main?
  - If yes: Create a new branch for this work using `git checkout -b <branch-name>`.
```

**Ask Each Time:**
```markdown
- Check git status - are you on main?
  - If yes: Ask me if I want to create a branch or a worktree, then follow the appropriate approach.
```

### TESTING_SECTION

**Strict TDD:**
```markdown
- Use test driven development. Read and follow `{{skills_dir}}/test-driven-development/SKILL.md`.
<system-reminder>Tests MUST be written before implementation. No exceptions.</system-reminder>
<system-reminder>Remember tests for all features first before writing any implementation.</system-reminder>
```

**Testing Preferred:**
```markdown
- Check if the codebase uses tests.
  - If yes: Write tests for new features, but timing is flexible.
```

**Minimal Testing:**
```markdown
- Only write tests when I explicitly request them.
```

### DOCS_SECTION

**Always Update:**
```markdown
- Update documentation, INCLUDING out of date documentation. Read and follow `{{skills_dir}}/updating-noridocs/SKILL.md`
```

**On Request:**
```markdown
- Ask me if I want to update documentation.
  - If yes: Read and follow `{{skills_dir}}/updating-noridocs/SKILL.md`
```

**No Documentation:**
(omit section entirely)

## Step 7: Next Steps

After creating the profile, display:

```
Your profile "<profile-name>" has been created!

Location: {{profiles_dir}}/<profile-name>/

To switch to your new profile, run:
  /nori-switch-profile

Or from the command line:
  nori-ai switch-profile <profile-name>

After switching, restart Claude Code to load your new configuration.

You can always edit your profile later by modifying files in:
  {{profiles_dir}}/<profile-name>/
```
