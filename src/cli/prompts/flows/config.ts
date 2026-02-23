/**
 * Config flow module
 *
 * Provides the interactive configuration experience using @clack/prompts.
 * This flow handles:
 * - Agent selection from the registry
 * - Install directory input with tilde expansion
 * - Intro/outro framing
 */

import { intro, multiselect, text } from "@clack/prompts";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

import { unwrapPrompt } from "./utils.js";

export type ConfigFlowCallbacks = {
  onLoadConfig: () => Promise<{
    currentAgents: Array<string> | null;
    currentInstallDir: string | null;
  }>;
  onResolveAgents: () => Promise<
    Array<{ name: string; displayName: string; description: string }>
  >;
};

export type ConfigFlowResult = {
  defaultAgents: Array<string>;
  installDir: string;
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

  intro("Configure Nori");

  // Load current config values for defaults
  const { currentAgents, currentInstallDir } = await callbacks.onLoadConfig();

  // Resolve available agents from registry
  const agents = await callbacks.onResolveAgents();

  // Step 1: Select default agents
  const agentOptions = agents.map((agent) => ({
    value: agent.name,
    label: agent.displayName,
    hint: agent.description,
  }));

  const selectedAgents = unwrapPrompt({
    value: await multiselect({
      message: "Which agents do you want to use?",
      options: agentOptions,
      initialValues: currentAgents ?? AgentRegistry.getInstance().list(),
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

  return {
    defaultAgents: selectedAgents as Array<string>,
    installDir: installDir as string,
  };
};
