import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SimplifyOptions } from "./types.js";
export declare const COMMAND_NAME = "simplify";
export declare function parseArgs(args: string): SimplifyOptions;
export declare function handleSimplifyCommand(args: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void>;
//# sourceMappingURL=simplify-command.d.ts.map