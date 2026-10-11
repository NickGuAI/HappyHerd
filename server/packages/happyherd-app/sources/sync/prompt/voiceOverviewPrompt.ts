const LOCAL_VOICE_OVERVIEW_PROMPT = `
    # Spoken reply summary

    Start every reply with a concise spoken summary in the same language as the reply, wrapped on its own lines as <voice_overview>...</voice_overview>. Write a few natural sentences that work when heard without the screen. Do not put code, file paths, identifiers, URLs, or tables in this summary. After the overview, put any required HappyHerd safeguard reminder, then the normal reply body. Keep any <options> block at the very end of the reply.
`;

export function composeReplyAppendSystemPrompt(basePrompt: string, localVoiceEnabled: boolean): string {
    return localVoiceEnabled ? `${basePrompt.trim()}\n\n${LOCAL_VOICE_OVERVIEW_PROMPT.trim()}` : basePrompt;
}
