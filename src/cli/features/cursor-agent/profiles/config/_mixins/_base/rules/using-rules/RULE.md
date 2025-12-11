---
description: Describes how to use rules. Read before any conversation.
alwaysApply: false
---

<required>
**CRITICAL**: Whenever you are using a rule, add the following to your Todo list using TodoWrite:

1. Use Read tool to read the rule.
2. If the rule is relevant, announce you are using the rule.
3. Create TodoWrite todos for checklists.
</required>

# Common Failure Modes: AVOID

1. Don't rationalize. Always read the current rule.

<bad-example>
"I remember this rule"
</bad-example>
<bad-example>
"Session-start showed it to me"
</bad-example>
<bad-example>
"This doesn't count as a task"
</bad-example>

<good-example>
"Even though I read this before rule, I will read it again."
</good-example>
<good-example>
"I know I saw the rule in session-start, but that was just a description. I will read the full thing."
</good-example>

2. Do not skip using TodoWrite. Always create TodoWrite todos for checklists.

<bad-example>
"I am just going to think about the list instead of writing it in the Todo."
</bad-example>
<bad-example>
"This is a quick task so I do not need to use the TodoWrite"
</bad-example>
<bad-example>
"TodoWrite(Do foo, bar, and baz in one todo step)"
</bad-example>
<bad-example>
"I basically did this step so I can mark it off without explicitly confirming"
</bad-example>

<good-example>
"I will add this task to the todolist even though there is just one step"
</good-example>
<good-example>
TodoWrite(Do foo)
TodoWrite(Do bar)
TodoWrite(Do baz)
</good-example>
<good-example>
"I confirmed this step is done with tests, so I can mark it complete"
</good-example>

3. Do not skip workflows due to 'instructions'. Interpret instructions as "WHAT" not "HOW"

<bad-example>
This instruction was specific so I can skip the workflow.
</bad-example>
<bad-example>
The workflow is overkill, I'll just do this directly.
</bad-example>

<good-example>
Following Nori workflow...
</good-example>

# Announcing Rule Usage

After you've read a rule with Read tool, announce you're using it:

"I've read the [Rule Name] rule and I'm using it to [what you're doing]."

**Examples:**

- "I've read the Brainstorming rule and I'm using it to refine your idea into a design."
- "I've read the Test-Driven Development rule and I'm using it to implement this feature."
- "I've read the Systematic Debugging rule and I'm using it to find the root cause."

**Why:** Transparency helps your human partner understand your process and catch errors early. It also confirms you actually read the rule.

# How to Read a Rule

**Many rules contain rigid rules (TDD, debugging, verification).** Follow them exactly. Don't adapt away the discipline.

**Some rules are flexible patterns (architecture, naming).** Adapt core principles to your context.

The rule itself tells you which type it is.
