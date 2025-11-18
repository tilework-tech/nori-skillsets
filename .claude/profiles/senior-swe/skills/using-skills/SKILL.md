---
name: Getting Started with Abilities
description: Describes how to use abilities. Read before any conversation.
---

# Getting Started with Abilities

## Critical Rules

1. **Use Read tool before announcing ability usage.** The session-start hook does NOT read abilities for you. Announcing without calling Read = lying.

2. **Follow mandatory workflows.** Check for abilities before ANY task.

3. **Create TodoWrite todos for checklists.** Mental tracking = steps get skipped. Every time.

## Mandatory Workflow: Before ANY Task

**1. Check abilities list** at session start.

**2. If relevant ability exists, YOU MUST use it:**

- Use Read tool with full path: `~/.claude/skills/<skill-name>/SKILL.md`
- Read ENTIRE file, not just frontmatter
- Announce: "I've read the Nori [Skill Name] ability and I'm using it to [purpose]"
- Follow it exactly

**Don't rationalize:**

- "I remember this ability" - Abilities evolve. Read the current version.
- "Session-start showed it to me" - That was using-skills/SKILL.md only. Read the actual ability.
- "This doesn't count as a task" - It counts. Find and read abilities.

**Why:** Abilities document proven techniques that save time and prevent mistakes. Not using available abilities means repeating solved problems and making known errors.

If a ability for your task exists, you must use it or you will fail at your task.

## Abilities with Checklists

If a ability has a checklist, YOU MUST create TodoWrite todos for EACH item.

**Don't:**

- Work through checklist mentally
- Skip creating todos "to save time"
- Batch multiple items into one todo
- Mark complete without doing them

**Why:** Checklists without TodoWrite tracking = steps get skipped. Every time. The overhead of TodoWrite is tiny compared to the cost of missing steps.

**Examples:** ~/.claude/skills/test-driven-development/SKILL.md, ~/.claude/skills/systematic-debugging/SKILL.md

## Announcing Skill Usage

After you've read a ability with Read tool, announce you're using it:

"I've read the [Skill Name] ability and I'm using it to [what you're doing]."

**Examples:**

- "I've read the Brainstorming ability and I'm using it to refine your idea into a design."
- "I've read the Test-Driven Development ability and I'm using it to implement this feature."
- "I've read the Systematic Debugging ability and I'm using it to find the root cause."

**Why:** Transparency helps your human partner understand your process and catch errors early. It also confirms you actually read the ability.

## How to Read a Skill

**Many abilities contain rigid rules (TDD, debugging, verification).** Follow them exactly. Don't adapt away the discipline.

**Some abilities are flexible patterns (architecture, naming).** Adapt core principles to your context.

The ability itself tells you which type it is.

## Instructions ≠ Permission to Skip Workflows

Your human partner's specific instructions describe WHAT to do, not HOW.

"Add X", "Fix Y" = the goal, NOT permission to skip brainstorming, TDD, or RED-GREEN-REFACTOR.

**Red flags:** "Instruction was specific" • "Seems simple" • "Workflow is overkill"

**Why:** Specific instructions mean clear requirements, which is when workflows matter MOST. Skipping process on "simple" tasks is how simple tasks become complex problems.

## Summary

**Starting any task:**

1. If relevant ability exists → Use Read tool with full path (includes /SKILL.md)
2. Announce you're using it
3. Follow what it says

**Skill has checklist?** TodoWrite for every item.

**Finding a relevant ability = mandatory to read and use it. Not optional.**
