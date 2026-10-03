import type { AnyAgentTool } from "@slopus/happy-agent-base";

import type { Compute } from "../../Compute.js";
import type { FileReadLog } from "../../../impl/FileReadLog.js";
import { grokGetCommandOrSubagentOutputTool } from "./get_command_or_subagent_output.js";
import { grokGrepTool } from "./grep.js";
import { grokKillCommandOrSubagentTool } from "./kill_command_or_subagent.js";
import { grokListDirTool } from "./list_dir.js";
import { grokReadFileTool } from "./read_file.js";
import { grokRunTerminalCommandTool } from "./run_terminal_command.js";
import { grokSearchReplaceTool } from "./search_replace.js";
import { grokSendCommandInputTool } from "./send_command_input.js";
import { grokWriteTool } from "./write.js";

/**
 * Grok's own machine, in Grok's own order.
 *
 * The order is the one Grok's tools are listed in, with `write` beside the other file tools it
 * belongs with. The array is fixed: nothing here inspects the model, filters a list, or decides
 * a tool is unnecessary.
 */
export function assembleGrokComputeTools(
    compute: Compute,
    reads: FileReadLog,
): readonly AnyAgentTool[] {
    return [
        grokRunTerminalCommandTool(compute),
        grokReadFileTool(compute, reads),
        grokWriteTool(compute, reads),
        grokSearchReplaceTool(compute, reads),
        grokListDirTool(compute),
        grokGrepTool(compute),
        grokGetCommandOrSubagentOutputTool(compute),
        grokKillCommandOrSubagentTool(compute),
        grokSendCommandInputTool(compute),
    ];
}
