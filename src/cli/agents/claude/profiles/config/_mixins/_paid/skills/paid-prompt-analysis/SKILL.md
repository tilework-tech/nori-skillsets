---
name: Prompt Analysis
description: Analyze prompts for quality and best practices before sending them to Claude.
---

# Prompt Analysis

## Overview

You CAN analyze prompts for quality and best practices by asking me for my prompt, then running the analysis script via Bash tool. The script returns AI-powered feedback categorized as good/warning/critical that you should explain to me.

## When to Use

Use this skill when I:

- Ask you to analyze or review a prompt I am working on
- Say my prompts aren't giving good results and wants help improving them
- Want to learn prompt engineering best practices
- Is unsure if my prompt is clear or specific enough
- Ask "Can you help me write a better prompt?"

Skip when:

- My prompt is already clear and well-structured
- The conversation is casual (not about prompt engineering)
- I have not indicated I want prompt analysis help

## Step-by-Step Instructions

### 1. Ask Me for My Prompt

Explicitly request the prompt to analyze:

```
I can analyze that prompt for you. Please share the exact prompt text you'd like me to review, and I'll run it through the analysis tool to identify areas for improvement.
```

**Wait for me to provide the prompt.** Do not proceed to analysis without receiving it.

### 2. Run the Analysis Script

Once you have the prompt, use the Bash tool to run the analysis:

```bash
node {{skills_dir}}/prompt-analysis/script.js --prompt="<my prompt here>"
```

**Important**:

- Escape the prompt properly for bash (use single quotes or escape double quotes)
- If the prompt contains single quotes, escape them: `'\''`
- If the prompt is very long, you may need to use a different quoting strategy

### 3. Read and Interpret the Output

The script returns colorized text output with three categories:

- **Good (green ✓)**: Things I am doing well
- **Warning (yellow ⚠)**: Areas that could be improved
- **Critical (red ✗)**: Issues that should be addressed immediately

### 4. Explain the Feedback to Me

**Don't just paste the raw output.** Instead:

1. **Summarize the overall quality** - Start with a high-level assessment
2. **Explain critical issues first** - These are blockers that must be fixed
3. **Address warnings next** - These would improve results significantly
4. **Acknowledge what's good** - Positive reinforcement for what I am doing well
5. **Provide specific examples** - Show concrete improvements I can make
6. **Offer to analyze a revised version** - Encourage iteration

### 5. Optional: Iterate

If I revise my prompt based on your feedback, offer to run the analysis again:

```
Would you like me to analyze your revised prompt to see if we've addressed those issues?
```

## Example Workflow

```
Me: "Can you help me improve this prompt: Write a function to sort numbers"

You: I can analyze that prompt for you. Let me run it through the analysis tool.

[Run: node {{skills_dir}}/prompt-analysis/script.js --prompt="Write a function to sort numbers"]

[Output shows warnings about missing language, algorithm, format details]

You: I've analyzed your prompt. Here's what the analysis found:

**Critical Issues:**
The prompt is quite vague - it doesn't specify which programming language you want, what sorting algorithm to use, or what format the input/output should be.

**Areas for Improvement:**
- Specify the programming language (JavaScript? Python? Java?)
- Define the input format (array? list? arguments?)
- Clarify the expected output (sorted array? in-place sort?)
- Mention edge cases you care about (empty arrays? duplicates?)

**What's Working:**
The request is concise and clear about the core action (sorting).

**Here's a revised version:**
"Write a JavaScript function called sortNumbers that takes an array of numbers as input and returns a new array sorted in ascending order. Handle edge cases like empty arrays and arrays with duplicates."

Would you like me to analyze this revised version?
```

## Common Mistakes

### ❌ Running analysis without asking for the prompt first

**Reality**: Always ask me to provide my prompt explicitly before running analysis.

### ❌ Pasting raw script output without explanation

**Reality**: The output is for YOUR interpretation - explain it in plain language with specific examples.

### ❌ Skipping the "what's good" feedback

**Reality**: Always acknowledge positive aspects before diving into criticism.

### ❌ Not offering to iterate

**Reality**: Prompt improvement is iterative - offer to analyze revised versions.

## Requirements

- Paid Nori subscription
- Configured credentials in `~/nori-config.json`

## Technical Details

The script calls the `/api/prompt-analysis` endpoint which uses an LLM to analyze the prompt and return structured feedback. The analysis considers:

- Clarity and specificity
- Completeness of requirements
- Context and constraints
- Examples and edge cases
- Tone and structure
