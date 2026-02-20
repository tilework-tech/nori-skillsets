# Noridoc: features

Path: @/src/cli/features

### Overview

The features directory contains the agent abstraction layer and all agent-specific feature implementations. It defines the `Agent` and `Loader` interfaces that allow the system to support multiple AI coding agents, and houses the Claude Code agent implementation along with shared test utilities.

### How it fits into the larger codebase

The `AgentRegistry` singleton is the central entry point used by CLI commands (e.g., `@/src/cli/commands/init`) to discover and interact with agent implementations. Each agent provides a `LoaderRegistry` that returns ordered `Loader` instances, which the init flow executes sequentially to install configuration. The `managedFolder.ts` module provides agent-agnostic skillset discovery by scanning `~/.nori/profiles/` for directories containing `nori.json` manifests, and is used by commands that need to list available skillsets.

### Core Implementation

`agentRegistry.ts` defines the `Agent` interface (install detection, skillset switching, factory reset, existing config capture) and the `AgentRegistry` singleton that maps agent names to implementations. Currently, the only registered agent is `claude-code`. `managedFolder.ts` provides `listSkillsets()` which discovers both flat skillsets (e.g., `"senior-swe"`) and namespaced skillsets (e.g., `"myorg/my-skillset"`) by walking the profiles directory and checking for `nori.json` manifests. The `Loader` type defined here is the contract that all feature loaders must satisfy: a `name`, `description`, and async `run` function.

### Things to Know

The `AgentRegistry` hardcodes `claude-code` as the only agent in its constructor. The `Agent` interface includes optional methods (`factoryReset`, `detectExistingConfig`, `captureExistingConfig`) that not all agents need to implement. `listSkillsets` calls `ensureNoriJson` as a backwards-compatibility shim, auto-generating `nori.json` for legacy skillsets that lack one.

Created and maintained by Nori.
