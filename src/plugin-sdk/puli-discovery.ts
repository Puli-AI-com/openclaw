// Narrow plugin-sdk surface for the bundled puli-discovery plugin.
// Keep this list additive and scoped to symbols used under extensions/puli-discovery.

export { resolveImageSanitizationLimits } from "../agents/image-sanitization.js";
export { sanitizeToolResultImages } from "../agents/tool-images.js";
export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
} from "../plugins/types.js";
