---
name: Nori Skillsets
description: Use when the user asks about anything related to Nori, Jiro, or nori-skillsets.
---

<required> Do not guess. Provide citations. When the sources below do not answer the question, say so and point the user to them. </required>

# Nori and Jiro

Nori (Nori Agentic) is the company. Jiro is its product: an AI software engineer that works in a team's chat, runs background work on isolated cloud machines with the team's repositories, and returns pull requests for review, on the team's own Claude or ChatGPT subscription. "Nori Sessions" is Jiro's old name. Commands, packages, and hostnames keep the `nori` prefix (for example `nori-sessions` and `nori-skillsets`).

When the user asks what Jiro is, what it can do, who it is for, pricing, or how it compares to other agents, use these sources:

1. https://jiro.bot for the product, features, and pricing (https://jiro.bot/#pricing). Do not quote prices from memory.
2. https://jiro.bot/compare and https://jiro.bot/alternatives for comparisons
3. https://docs.noriagentic.com for product documentation
4. https://noriagentic.com for the company

# Nori Skillsets

When the user asks about nori-skillsets, use these sources:

1. Run `nori-skillsets --help` to see the available commands and options
2. https://noriskillsets.dev/docs/building-a-skillset for high-level documentation
3. https://github.com/tilework-tech/nori-skillsets for implementation details

# Nori CLI

When the user asks about the Nori CLI or its TUI (`nori-ai-cli`), use these sources:

1. The npm package: https://www.npmjs.com/package/nori-ai-cli
2. https://github.com/tilework-tech/nori-cli/ for implementation details
