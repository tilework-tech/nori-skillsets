/**
 * Prompts module
 *
 * Re-exports prompt utilities and validators for use across the CLI.
 * Built on top of the clack/prompts library.
 */

export { handleCancel, isCancel } from "./utils.js";
export {
  validateProfileName,
  validateOrgId,
  validateRequired,
} from "./validators.js";
export { confirmAction } from "./confirm.js";
export { promptText, type ValidateFunction } from "./text.js";
export {
  selectProfile,
  type ProfileOption,
  type ProfileSelection,
} from "./profile.js";
export { promptForAuth, type AuthCredentials } from "./auth.js";
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
} from "./flows/index.js";
