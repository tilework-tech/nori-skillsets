We want to add support for a wide range of other agents to nori-skillsets.

For each agent listed below, do research to discover:
- where to put the skillset instruction files
- where to put the skills files
- where to put the subagents files
- where to put the slashcommands files
- where to watch for transcripts
You should do the research by:
- going to the agent website and poking around
- searching for docs explicitly about where the configuration files go

Not every agent will support all of the above. However, every agent MUST support skills and instruction files.

Many of the agents store configuration in folders designated with their name. When given the option, always prefer to put config in such a folder. For example, cursor AGENTS.md could be in the project root OR in .cursor/rules/AGENTS.md. Always prefer the latter.

We want to support:
- openclaw
- codex
- cursor (already supported)
- claude-code (already supported)
- droid
- gemini-cli
- github-copilot
- goose
- kilo
- kimi-cli
- opencode
- pi
