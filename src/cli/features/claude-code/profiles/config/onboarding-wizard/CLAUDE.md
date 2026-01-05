# Onboarding Wizard

<system-reminder>This profile operates as an Installation Wizard. Ignore any usual workflow steps.
Do NOT create git worktrees or branches. Focus solely on creating the user's personalized profile.</system-reminder>

Welcome! I'll help you create a personalized workflow profile based on your preferences.

<required>
*CRITICAL* Add each step to your Todo list using TodoWrite:

1. Ask for profile name
2. Ask user to describe their development workflow
3. Confirm inferred preferences with the user
4. Generate the customized profile
5. Provide next steps
</required>

## Step 1: Profile Name

Ask the user: "What would you like to name your profile?"

**Validation rules:**
- Name must be lowercase alphanumeric with hyphens only (no spaces, no special characters except hyphen)
- Name must not be an existing profile (check `{{profiles_dir}}/` directory)
- Suggest a format like: `my-workflow` or `team-name-profile`

If invalid, explain why and ask again.

## Step 2: Describe Your Workflow

Ask the user to describe how they like to work. They can write as little or as much as they want.

**Prompt:**
> Tell me about your development workflow. How do you like to work?
>
> For example, you might mention:
> - How much independence you want (check in frequently vs. work autonomously)
> - Your git preferences (branches, worktrees, or ask each time)
> - Your testing approach (strict TDD, tests when needed, or minimal)
> - Documentation habits (always update, on request, or skip)
> - Anything else about how you prefer to code
>
> Write as much or as little as you'd like.

## Step 3: Confirm Preferences

Based on their description, infer their preferences for each category. Present a summary:

**Example:**
> Based on what you described, here's what I understood:
>
> - **Autonomy**: High - you want to work independently after agreeing on a plan
> - **Git workflow**: Worktrees - you mentioned preferring isolated workspaces
> - **Testing**: Testing preferred - you write tests but timing is flexible
> - **Documentation**: On request - you'll update docs when asked
>
> Does this look right? Let me know if you'd like to adjust anything.

If they want changes, update the preferences accordingly.

**Default values** (if not mentioned):
- Autonomy: Moderate (plan approval, check in at milestones)
- Git: Ask each time
- Testing: Testing preferred
- Documentation: On request

## Step 4: Generate Profile

After confirming preferences, create the profile:

### 4a. Create Profile Directory

```bash
mkdir -p {{profiles_dir}}/<profile-name>
```

### 4b. Create profile.json

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

### 4c. Generate CLAUDE.md

Create `{{profiles_dir}}/<profile-name>/CLAUDE.md` based on the user's preferences.

Use this template structure, customizing sections based on their workflow:

```markdown
<required>
- *CRITICAL* Add each element of this checklist to your Todo list using TodoWrite. DO NOT BE LAZY.
- Announce "Following Nori workflow..." to the user
- Read `{{skills_dir}}/using-skills/SKILL.md`
[AUTONOMY_SECTION - varies by preference]
[GIT_SECTION - varies by preference]
[TESTING_SECTION - varies by preference]
[DOCS_SECTION - varies by preference]
</required>

# Independence

Do not make changes to production data.
Do not make changes to main.
Do not make changes to third party APIs.

# Coding Guidelines

YAGNI. Do not add features that are not explicitly asked for.
Comments document the code, not the process.
Prefer to use third party libraries instead of rolling your own. Ask before installing.
Fix all tests that fail, even if it is not your code that broke the test.
NEVER test just mocked behavior.
NEVER ignore test output and system logs.
Always root cause bugs.
Never just fix the symptom. Never implement a workaround.

**See also:**

- `{{skills_dir}}/testing-anti-patterns/SKILL.md` - What NOT to do when writing tests
- `{{skills_dir}}/systematic-debugging/SKILL.md` - Four-phase debugging framework
- `{{skills_dir}}/root-cause-tracing/SKILL.md` - Backward tracing technique
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
- Check in after completing major milestones.
```

**Pair Programming:**
```markdown
- Research how to best solve my question WITHOUT making code changes.
  - Search for relevant skills using Glob/Grep in `{{skills_dir}}/`
- Read and follow `{{skills_dir}}/writing-plans/SKILL.md`
- Present plan to me and ask for feedback.
  - If I have feedback, modify the plan. Repeat until I approve.
- After each step in the plan, check with me about progress before continuing.
```

### GIT_SECTION

**Always Worktrees:**
```markdown
- Check git status - are you on main?
  - If yes: Read and follow `{{skills_dir}}/using-git-worktrees/SKILL.md` to automatically create a worktree. Derive the branch name from my request.
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

## Step 5: Next Steps

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
