/** What the model would actually read, out of the blocks a tool rendered. */
export function llmText(blocks: readonly unknown[]): string {
    return blocks
        .map((block) => block as { readonly type?: string; readonly text?: string })
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n");
}
