/**
 * Re-exports from the canonical location under the claude-code agent.
 */

export type { ExistingConfig } from "@/cli/features/agentRegistry.js";
export {
  detectExistingConfig,
  captureExistingConfigAsProfile,
} from "@/cli/features/claude-code/existingConfigCapture.js";
