/** Public surface of the Goal module. */

export * from "./GoalEvent.js";
export * from "./GoalModule.js";
export * from "./SessionGoal.js";
export {
    createGoalContinuationPrompt,
    goalContinuationPromptSchema,
    MAX_GOAL_CONTINUATION_PROMPT_CHARS,
    type GoalContinuationPrompt,
} from "./impl/createGoalContinuationPrompt.js";
export { createGoalTitle } from "./impl/createGoalTitle.js";
export { formatGoalForModel } from "./impl/formatGoalForModel.js";
export { clearGoalTool } from "./tools/clear_goal.js";
export { createGoalTool } from "./tools/create_goal.js";
export { getGoalTool } from "./tools/get_goal.js";
export { updateGoalTool } from "./tools/update_goal.js";
