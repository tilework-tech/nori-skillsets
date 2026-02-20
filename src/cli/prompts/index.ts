/**
 * Prompts module
 *
 * Re-exports prompt utilities and validators for use across the CLI.
 * Built on top of the clack/prompts library.
 */

export { handleCancel } from "./utils.js";
export { validateSkillsetName } from "./validators.js";
export { confirmAction } from "./confirm.js";
export { promptText } from "./text.js";
export { promptPassword } from "./password.js";

// Flow modules - complete interactive experiences
export {
  loginFlow,
  type AuthenticateResult,
  type LoginFlowCallbacks,
  type LoginFlowResult,
  switchSkillsetFlow,
  type SwitchSkillsetCallbacks,
  type SwitchSkillsetFlowResult,
  uploadFlow,
  type UploadFlowCallbacks,
  type UploadFlowResult,
  type UploadResult,
  type DetermineVersionResult,
  listVersionsFlow,
  type ListVersionsFlowCallbacks,
  type ListVersionsFlowResult,
} from "./flows/index.js";
