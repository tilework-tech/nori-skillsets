This specification describes a refactor. It completes the move from a single agent specification to a multi-agent specification.

There are two goals for this refactor.
First: to make the semantics of how skillsets turn into per-agent configuration clear from types embedded in the codebase and in relevant function args.
Second: to make the entire codebase 'agent-agnostic' so that it is trivial to add new agents.

These changes should be invisible to the end user. They are, for now, entirely internal.

# Refactor A: Tight agent coupling prevents adding new agents. Decouple the agents.

The original version of the nori-skillsets repository was built around claude-code as an agent. claude-code was tightly coupled to every part of the cli behavior. We have taken steps to decouple this by adding an intermediate layer: the agentRegistry and the Agent type. Many commands now go through the agentRegistry and the Agent type. However, this is not by any means complete.

We must ensure that all code paths are NOT dependent on claude-code specific semantics (file paths, config names, etc.).
- add interface types and functions to the Agent definition for anything that is currently claude-code specific
- refactor any code paths that are dependent on claude-code internals to instead go through the generic agent definition interface

Example PRs https://github.com/tilework-tech/nori-skillsets/pull/400, https://github.com/tilework-tech/nori-skillsets/pull/413

Research the codebase extensively to find areas where this coupling still exists and aggressively remove it.

# Refactor B: All configuration types are currently implicit. These must be made explicit.

As of right now, there are no explicit types that describe the Skillset (i.e. the packages that live at ~/.nori/profiles/) and the individual per agent configs. Each loader within the claude-code agent implicitly looks for files and paths in a given skillset. The contract for what a skillset is or what it contains is hidden in the gaps between function calls and maybe some documentation. It is not enforced anywhere.

The nori-skillsets cli should be seen as a transpiler between our Skillset representation and many different agent representations. Right now, we cannot easily add new agent types because we do not even have a clear embedded data structure for what our Skillset representation is. This must be fixed.

- add a new skillset type in the types/ folder at the top level, next to the nori.json types
- add a parsing layer that lives above the agentRegistry
- modify the relevant agentRegistry functions to ingest this new skillset type
- modify the underlying functions so that instead of hardcoding skillset semantics, the agentRegistry functions read off the skillset type directly
- have each agent clearly indicate what their own managed files and folders are. This should include files that are created entirely by the individual agent that have no equivalent in the skillset -- for example, statusline.sh

Note that the skillset type is content agnostic. It maps to files and folders, not the contents of those files and folders (for the most part).

# Refactor C: Currently exposed functionality makes multi-agent support difficult. This should be made easy.

Here is how the product should work:
- there is a defaultAgents list, an installDir, and an activeSkillset
- at any given time, the activeSkillset should be applied to all agents in the defaultAgent list at the installDir

These rules lead to some complicated but necessary feature implementations. For example, when the user modifies the config, the skillset should be rebroadcast. If the agent list changes, it should update the skillset for that agent. If the installDir changes, it should switch the skillset for each agent at the new installdir and cleanup the skillset for each agent at the original dir. These can be unexpected, so we should ask the user.

It is vital that it is really easy to port skillsets to a specific agent and a particular folder at any time. This should be painless, and that painlessness should be reflected in our architecture. We should have clear semantic functions in our agent registry for things like:
- removing a skillset for an agent at a given dir
- adding a skillset for an agent at a given dir
- tracking local changes for an agent at a given dir and then flagging that to a user on a switch
- watching transcripts come in from different agents using the watch command
and so on.
