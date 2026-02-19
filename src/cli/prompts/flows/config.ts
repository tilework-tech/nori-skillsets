/**
 * Config flow module
 *
 * Provides the interactive configuration experience using @clack/prompts.
 * This flow handles:
 * - Agent selection from the registry
 * - Install directory input with tilde expansion
 * - Intro/outro framing
 */

import { intro, select, text } from "@clack/prompts";

import { unwrapPrompt } from "./utils.js";

export type ConfigFlowCallbacks = {
  onLoadConfig: () => Promise<{
    currentAgent: string | null;
    currentInstallDir: string | null;
  }>;
  onResolveAgents: () => Promise<Array<{ name: string; displayName: string }>>;
};

export type ConfigFlowResult = {
  defaultAgent: string;
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
  const { currentAgent, currentInstallDir } = await callbacks.onLoadConfig();

  // Resolve available agents from registry
  const agents = await callbacks.onResolveAgents();

  // Step 1: Select default agent
  const agentOptions = agents.map((agent) => ({
    value: agent.name,
    label: agent.displayName,
  }));

  const selectedAgent = unwrapPrompt({
    value: await select({
      message: "Which agent do you want to use?",
      options: agentOptions,
      initialValue: currentAgent ?? "claude-code",
    }),
    cancelMessage: "Configuration cancelled.",
  });

  if (selectedAgent == null) return null;

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
    defaultAgent: selectedAgent as string,
    installDir: installDir as string,
  };
};
