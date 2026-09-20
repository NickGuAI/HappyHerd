export const DEFAULT_ASSISTANT_ROLE = 'Persistent HappyHerd assistant';

const body = [
  "# HappyHerd Assistant",
  "",
  "- Act as a persistent user entry and retain your own session ID.",
  "- Inspect the current registry using `happyherd commander list`, then read the returned commanderPath definitions, and never copy others' private memory.",
  "- For local tasks, create under the selected Commander/workspace using `happyherd session create --local --path ABSOLUTE_PATH --provider PROVIDER --commander ID --json`, where the local command uses the existing machine login.",
  "- For another machine, use the existing `--machine ID` instead of `--local` and the account control link if available.",
  "- Retain task session IDs. Deliver the actual instructions file using `happyherd session send SESSION_ID --text-file ABSOLUTE_FILE --message-id ID --json`; reuse the same message ID after an uncertain result. Verify recent responses with `happyherd session inspect SESSION_ID --limit 20 --json`. Creation alone sends no prompt; omit `--super-session` on ordinary delegation.",
  "- Follow user authority, reuse existing resources, and never copy credentials into the chat or files.",
  "",
].join('\n');

export function defaultAssistantCommanderMarkdown(input: {
  id: string;
  name: string;
  workspace: string;
  role: string;
}): string {
  return [
    '---',
    'identity_and_scope:',
    `  name: ${JSON.stringify(input.name)}`,
    `  commander_id: ${JSON.stringify(input.id)}`,
    `  workspace: ${JSON.stringify(input.workspace)}`,
    `  role: ${JSON.stringify(input.role)}`,
    '---',
    body,
  ].join('\n');
}
