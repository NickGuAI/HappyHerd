import type { AnyAgentTool } from "@slopus/happy-agent-base";

import type { Compute } from "../../Compute.js";
import type { FileReadLog } from "../../../impl/FileReadLog.js";
import { codexApplyPatchTool } from "./apply_patch.js";
import { codexExecCommandTool } from "./exec_command.js";
import { codexKillSessionTool } from "./kill_session.js";
import { codexViewImageTool } from "./view_image.js";
import { codexWriteStdinTool } from "./write_stdin.js";

/**
 * Codex's filesystem and shell surface, in Codex's own order.
 *
 * A fixed array, written out. Nothing here inspects a name, asks what the model supports, or
 * filters the list: what a Codex model can do is exactly what this array says.
 */
export function assembleCodexComputeTools(
    compute: Compute,
    reads: FileReadLog,
): readonly AnyAgentTool[] {
    return [
        codexExecCommandTool(compute),
        codexWriteStdinTool(compute),
        codexKillSessionTool(compute),
        codexApplyPatchTool(compute, reads),
        codexViewImageTool(compute, reads),
    ];
}
