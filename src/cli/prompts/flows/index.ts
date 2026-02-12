/**
 * Flow modules index
 *
 * Re-exports all flow modules for CLI commands.
 * Flows provide complete interactive experiences using @clack/prompts.
 */

export {
  loginFlow,
  type AuthenticateResult,
  type LoginFlowCallbacks,
  type LoginFlowResult,
} from "./login.js";

export {
  switchSkillsetFlow,
  type SwitchSkillsetCallbacks,
  type SwitchSkillsetFlowResult,
} from "./switchSkillset.js";

export {
  initFlow,
  type InitFlowCallbacks,
  type InitFlowResult,
} from "./init.js";

export {
  uploadFlow,
  type UploadFlowCallbacks,
  type UploadFlowResult,
  type UploadResult,
  type DetermineVersionResult,
} from "./upload.js";

export {
  listVersionsFlow,
  type ListVersionsFlowCallbacks,
  type ListVersionsFlowResult,
} from "./listVersions.js";

export { unwrapPrompt } from "./utils.js";
