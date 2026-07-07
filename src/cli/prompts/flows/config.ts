/**
 * Config flow module
 *
 * Provides the interactive configuration experience using @clack/prompts.
 * This flow handles:
 * - Agent selection from the registry
 * - Install directory input with tilde expansion
 */

import { multiselect, text, confirm } from "@clack/prompts";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import { unwrapPrompt } from "./utils.js";

export type ConfigFlowCallbacks = {
  onLoadConfig: () => Promise<{
    currentAgents: Array<string> | null;
    currentInstallDir: string | null;
    currentRedownloadOnSwitch?: "enabled" | "disabled" | null;
    currentClaudeCodeStatusLine?: "enabled" | "disabled" | null;
  }>;
  onResolveAgents: () => Promise<
    Array<{
      name: string;
      displayName: string;
      description: string;
      supportTier: "supported" | "experimental";
    }>
  >;
};

export type ConfigFlowResult = {
  defaultAgents: Array<string>;
  installDir: string;
  redownloadOnSwitch: "enabled" | "disabled";
  claudeCodeStatusLine?: "enabled" | "disabled";
};

/**
 * Execute the interactive configuration flow
 *
 * @param args - Flow configuration
 * @param args.callbacks - Callback functions for loading config and resolving agents
 *
 * @returns Result on success, null on cancel
 */
export const configFlow = async (args: {
  callbacks: ConfigFlowCallbacks;
}): Promise<ConfigFlowResult | null> => {
  const { callbacks } = args;

  // Load current config values for defaults
  const {
    currentAgents,
    currentInstallDir,
    currentRedownloadOnSwitch,
    currentClaudeCodeStatusLine,
  } = await callbacks.onLoadConfig();

  // Resolve available agents from registry
  const agents = await callbacks.onResolveAgents();

  // Step 1: Select default agents — supported tier first, experimental marked
  const agentOptions = [
    ...agents.filter((agent) => agent.supportTier === "supported"),
    ...agents.filter((agent) => agent.supportTier !== "supported"),
  ].map((agent) => ({
    value: agent.name,
    label: agent.displayName,
    hint:
      agent.supportTier === "supported"
        ? agent.description
        : `${agent.description} (experimental)`,
  }));

  const selectedAgents = unwrapPrompt({
    value: await multiselect({
      message:
        "Which agents do you want to use?\n(space to toggle, enter to confirm)",
      options: agentOptions,
      initialValues: currentAgents ?? [
        AgentRegistry.getInstance().getDefaultAgentName(),
      ],
      required: true,
    }),
    cancelMessage: "Configuration cancelled.",
  });

  if (selectedAgents == null) return null;

  // Step 2: Enter install directory
  const installDir = unwrapPrompt({
    value: await text({
      message: "Default install and switch directory",
      initialValue: currentInstallDir ?? "~",
    }),
    cancelMessage: "Configuration cancelled.",
  });

  if (installDir == null) return null;

  // Step 3: Prompt to re-download skillsets on switch
  const redownloadOnSwitchEnabled = unwrapPrompt({
    value: await confirm({
      message: "Prompt to re-download skillsets from registry on switch?",
      initialValue: currentRedownloadOnSwitch !== "disabled",
    }),
    cancelMessage: "Configuration cancelled.",
  });

  if (redownloadOnSwitchEnabled == null) return null;

  // Step 4: Prompt to configure Claude Code status line during apply
  const claudeCodeStatusLineEnabled = unwrapPrompt({
    value: await confirm({
      message:
        "Add the Nori status line to Claude Code when applying skillsets?",
      initialValue: currentClaudeCodeStatusLine !== "disabled",
    }),
    cancelMessage: "Configuration cancelled.",
  });

  if (claudeCodeStatusLineEnabled == null) return null;

  return {
    defaultAgents: selectedAgents as Array<string>,
    installDir: installDir as string,
    redownloadOnSwitch: redownloadOnSwitchEnabled ? "enabled" : "disabled",
    claudeCodeStatusLine: claudeCodeStatusLineEnabled ? "enabled" : "disabled",
  };
};
