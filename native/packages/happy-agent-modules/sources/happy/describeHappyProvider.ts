/** How Happy names the service behind a model. */
export interface HappyProviderDescriptor {
    id: string;
    kind: string;
    name: string;
}

const KNOWN_PROVIDERS: Readonly<Record<string, Omit<HappyProviderDescriptor, "id">>> = {
    claude: { kind: "claude", name: "Anthropic Claude" },
    codex: { kind: "codex", name: "OpenAI Codex" },
    grok: { kind: "grok", name: "xAI Grok" },
};

/** Describes a provider for the phone, in words rather than an identifier. */
export function describeHappyProvider(providerId: string): HappyProviderDescriptor {
    return {
        id: providerId,
        ...(KNOWN_PROVIDERS[providerId] ?? {
            kind: "custom",
            name: providerId
                .replaceAll(/[_-]+/gu, " ")
                .replaceAll(/\b\w/gu, (character) => character.toUpperCase()),
        }),
    };
}
