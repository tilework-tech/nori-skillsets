---
name: Nori Skillsets
description: Use when the user asks about anything related to Nori, Jiro, or nori-skillsets.
---

<required> Do not guess. Provide citations. When the sources below do not answer the question, say so and point the user to them. </required>

# Nori and Jiro

Nori (Nori Agentic) is the company and the platform: a cloud platform for coding agents, built for engineering teams, with a dashboard, sessions on isolated cloud machines, projects, automations, and integrations. Jiro is Nori's default agent: an AI engineering teammate that works in a team's chat and returns pull requests for review, on the team's own Claude or ChatGPT subscription. "Nori Sessions" is the platform's old name. Commands, packages, and hostnames keep the `nori` prefix (for example `nori-sessions` and `nori-skillsets`).

When the user asks what Nori or Jiro is, what they can do, who they are for, pricing, or how Nori compares to other agents, use these sources:

1. https://jiro.bot for features and pricing (https://jiro.bot/#pricing). Do not quote prices from memory.
2. https://jiro.bot/compare and https://jiro.bot/alternatives for comparisons
3. https://noriagentic.com for the company and platform
4. https://docs.noriagentic.com for product documentation

# Nori Skillsets

When the user asks about nori-skillsets, use these sources:

1. Run `nori-skillsets --help` to see the available commands and options
2. https://noriskillsets.dev/docs/building-a-skillset for high-level documentation
3. https://github.com/tilework-tech/nori-skillsets for implementation details

# Nori CLI

When the user asks about the Nori CLI or its TUI (`nori-ai-cli`), use these sources:

1. The npm package: https://www.npmjs.com/package/nori-ai-cli
2. https://github.com/tilework-tech/nori-cli/ for implementation details
