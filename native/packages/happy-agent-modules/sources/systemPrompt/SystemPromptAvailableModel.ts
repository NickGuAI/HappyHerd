import { Type, type Static } from "@sinclair/typebox";

/** The largest number of provider/model routes one prompt may enumerate. */
export const MAX_SYSTEM_PROMPT_AVAILABLE_MODELS = 1_000;
/** The largest label, model ID, or provider ID accepted in the prompt's model catalog. */
export const MAX_SYSTEM_PROMPT_AVAILABLE_MODEL_FIELD_LENGTH = 256;
/**
 * The largest UTF-8 rendering of the available-models section accepted at construction.
 *
 * The instruction assembly fits the live AGENTS.md chain into whatever output budget remains
 * after this section, the vendor prompt, and the environment details are rendered.
 */
export const MAX_SYSTEM_PROMPT_AVAILABLE_MODELS_BYTES = 512_000;

const availableModelFieldSchema = Type.String({
    minLength: 1,
    maxLength: MAX_SYSTEM_PROMPT_AVAILABLE_MODEL_FIELD_LENGTH,
    pattern: "^[^\\u0000\\r\\n]+$",
});

/**
 * The small model-catalog view the host supplies to the system prompt.
 *
 * The prompt needs only the three values it prints. Provider/model capability details remain
 * outside this module.
 */
export const systemPromptAvailableModelSchema = Type.Object(
    {
        name: availableModelFieldSchema,
        id: availableModelFieldSchema,
        providerId: availableModelFieldSchema,
    },
    { additionalProperties: false },
);

/** The TypeScript type inferred from {@link systemPromptAvailableModelSchema}. */
export type SystemPromptAvailableModel = Static<typeof systemPromptAvailableModelSchema>;

/** The bounded catalog accepted by {@link SystemPromptModule}. */
export const systemPromptAvailableModelsSchema = Type.Array(systemPromptAvailableModelSchema, {
    maxItems: MAX_SYSTEM_PROMPT_AVAILABLE_MODELS,
});

/** The TypeScript type inferred from {@link systemPromptAvailableModelsSchema}. */
export type SystemPromptAvailableModels = Static<typeof systemPromptAvailableModelsSchema>;
