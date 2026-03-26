# Performance-first Codex subagent role proposals

This directory contains TOML-only replacements for the existing Nori Codex subagents:

- `nori-change-documenter.toml`
- `nori-code-reviewer.toml`
- `nori-codebase-analyzer.toml`
- `nori-codebase-locator.toml`
- `nori-codebase-pattern-finder.toml`
- `nori-initial-documenter.toml`
- `nori-knowledge-researcher.toml`
- `nori-web-search-researcher.toml`

### What was changed

- Preserved existing role intent and names.
- Added explicit `model = "gpt-5.3-codex-spark"`.
- Added explicit `model_reasoning_effort = "low"` for performance-first behavior.
- Removed hard-coded, arbitrary tool-calling limits and tool-specific workflow constraints that reduce flexibility (for example, fixed call counts and hard-required research tools).

### Notes

These are proposals only. They are not installed into `~/.codex` or any home config in this repo.
