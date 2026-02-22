We want to add support for cursor into nori-skillsets. This should translate nori skillsets into configuration that can be supported by the cursor agent.

Read through spec/agent-broadcasting/ to understand the full scope of multi-agent behavior.

User Journey A: Configuration on install.
- User downloads nori-skillsets.
- Immediately after install, `nori-skillsets config` is run automatically without any additional user input.
- The default config option is to select claude-code and to use the home directory. The user can select alternatives.

User Journey B: Configuring the cursor agent.
- User runs `nori-skillsets config`
- The user has the option to select one or more agents in a multi-select menu
	- Each agent option shows, on 'hover', a small description of what is supported within a skillset
		- A skillset is composed of an 'instructions file', skills, subagents, and slashcommands
		- If an agent does not support configuration for one of these options, it should show that it is not supported in the description
- The user selects both claude code AND cursor
- The defaultAgents field is updated in the ~/.nori-config.json

User Journey C: Using the cursor agent configs.
- User runs `nori-skillsets config`
- The user has the option to select one or more agents in a multi-select menu
- The user selects both claude code AND cursor
- The defaultAgents field is updated in the ~/.nori-config.json
- The user runs `sks switch foobar` or `sks install foobar`
- The system reads the installDir in the config.toml
- The system reads and parses the `foobar` skillset
- The system converts the foobar skillset into configuration for both the claude code agent and the cursor agent
<system-reminder> At any point, there should be a single activeSkillset that is applied to all agents. </system-reminder>
- The system installs both the claude code agent config (into <installdir>/.claude mostly) and the cursor agent config (into <installdir>/.cursor mostly)

Implementation details:
- Do extensive research on what Cursor actually supports. A skillset is composed of a claude.md, skills, subagents, and slashcommands.
  - The CLAUDE.md should map to the AGENTS.md (https://cursor.com/docs/context/rules#agentsmd). <new-update> Note that the AGENTS.md should live inside the cursor rules directory and NOT the project root, to make management easier. The existing implementation is incorrect, the 'current progress' put the agents.md into the project root and this line was added as a fix. </new-update>
  - skills/ map seamlessly to cursor skills (https://cursor.com/docs/context/skills)
  - subagents map seamlessly to cursor subagents (https://cursor.com/docs/context/subagents)
  - slashcommands map seamlessly to cursor commands (https://cursor.com/docs/context/commands)
- Add a new agent in the agent registry and fulfill the type specification requirements
	- Agent name should be cursor-agent
	- Make sure that the managed files are handled appropriately by the installation-manifest, ensuring that local changes are captured properly and changes warn the user
	- Make sure template substitutions from the claude-code agent apply to the correct locations in the cursor code paths
- The cursor agent should also have a .nori-managed file added to track the current skillset in the file
