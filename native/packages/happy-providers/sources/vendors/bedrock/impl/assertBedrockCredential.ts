import { isBedrockCredential, type BedrockCredential } from "@/vendors/VendorCredential.js";

export function assertBedrockCredential(value: unknown): asserts value is BedrockCredential {
    if (isBedrockCredential(value)) return;
    throw new Error("BedrockProvider requires a Bedrock bearer token or AWS credential.");
}
