import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { AwsCredentialsProvider } from "openai/providers/bedrock/aws";

import { BaseCredential } from "@/core/BaseCredential.js";

export type BedrockAwsCredentialValue = {
    readonly profile?: string;
    readonly provider: AwsCredentialsProvider;
};

export interface BedrockAwsCredentialLoadOptions {
    configFilepath?: string;
    credentialProvider?: AwsCredentialsProvider;
    credentialsFilepath?: string;
    profile?: string;
}

/** A refreshable AWS credential chain used to SigV4-sign Amazon Bedrock requests. */
export class BedrockAwsCredential extends BaseCredential<"bedrock-aws", BedrockAwsCredentialValue> {
    static async tryLoad(
        options: BedrockAwsCredentialLoadOptions = {},
    ): Promise<BedrockAwsCredential | null> {
        const profile = options.profile?.trim();
        if (options.profile !== undefined && !profile) return null;
        const provider =
            options.credentialProvider ??
            defaultProvider({
                ...(options.configFilepath === undefined
                    ? {}
                    : { configFilepath: options.configFilepath }),
                ...(options.credentialsFilepath === undefined
                    ? {}
                    : { filepath: options.credentialsFilepath }),
                ...(profile === undefined ? {} : { profile }),
            });
        try {
            // Resolve once so tryLoad keeps its normal meaning: a returned credential is usable.
            // The AWS provider memoizes this result and refreshes expiring process credentials.
            await provider();
        } catch (cause) {
            const explicit =
                options.configFilepath !== undefined ||
                options.credentialProvider !== undefined ||
                options.credentialsFilepath !== undefined ||
                options.profile !== undefined;
            if (!explicit) return null;
            throw new Error(
                profile === undefined
                    ? "Could not load AWS credentials for Amazon Bedrock."
                    : `Could not load AWS credentials for Amazon Bedrock profile "${profile}".`,
                { cause },
            );
        }
        return new BedrockAwsCredential({
            ...(profile === undefined ? {} : { profile }),
            provider,
        });
    }

    private constructor(credential: BedrockAwsCredentialValue) {
        super("bedrock-aws", credential);
    }
}
