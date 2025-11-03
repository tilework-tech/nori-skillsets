# Noridoc: config

Path: @/plugin/src/installer/features/statusline/config

### Overview

Shell script configuration for Claude Code status line integration, displaying git branch, active Nori profile, token usage, cost information, and rotating tips.

### How it fits into the larger codebase

This folder contains the nori-statusline.sh script that is installed by @/plugin/src/installer/features/statusline/loader.ts into Claude Code settings. The script is executed by Claude Code to generate status line content displayed at the bottom of the interface. It reads Claude Code conversation data from stdin and enriches it with profile information from ~/nori-config.json before formatting it for display.

### Core Implementation

The nori-statusline.sh script performs two enrichment phases before displaying output: (1) Config tier enrichment - reads ~/nori-config.json to determine if auth credentials exist (free vs paid tier), and (2) Profile enrichment - reads profile.baseProfile from ~/nori-config.json (defaults to empty string if not set). After enrichment, it extracts git branch info from the conversation's cwd, parses the transcript file to calculate token usage (input tokens, cache creation tokens, cache read tokens, output tokens, and context length from the most recent main chain entry), and formats cost estimates. The script outputs three lines: Line 1 shows metrics (git branch, profile if set, cost, tokens, context, lines changed), Line 2 shows branding with an upgrade link for free tier users, and Line 3 shows a rotating tip selected deterministically based on day_of_year \* 24 + hour. Version information is injected during build via perl substitution in @/plugin/package.json build script.

### Things to Know

The status line script receives conversation data via stdin as a pipe from Claude Code. The profile name enrichment allows users to see which behavioral preset (senior-swe, amol, nontechnical) is currently active - this is conditionally displayed only when profile.baseProfile exists in ~/nori-config.json. The script must be executable and return formatted text quickly to avoid UI lag. Token usage is calculated by parsing the transcript file at the path provided in the conversation data, summing usage across all messages in the conversation. Context length represents the input tokens + cache tokens from the most recent non-sidechain message. The script uses OSC 8 hyperlink format for the "upgrade" link in free tier branding. Version string **VERSION** is replaced during build with the actual package version from package.json. The status line updates automatically as conversations progress. The rotating tips array contains 22 tips that highlight recent Nori features including brainstorming skill, prompt-analysis skill (paid), profile switching (/switch-nori-profile), clickable @/ references in noridocs, /sync-noridocs command (paid), nori-change-documenter subagent, documenter profile, recall skill (paid), memorize skill (paid), systematic-debugging skill, root-cause-tracing skill, and receiving-code-review skill, along with foundational features like webapp-testing, git worktrees, PR workflows, and Test Driven Development.
