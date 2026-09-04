import metadata from '../../product-metadata.json';

// HappyHerd builds link back to their canonical repository by default. Public
// distributions can still replace repository and support destinations through
// deployment metadata without changing the shared Settings UI.
export const PRODUCT = Object.freeze({
    ...metadata,
    repositoryDisplay: process.env.EXPO_PUBLIC_HAPPYHERD_REPOSITORY_DISPLAY?.trim() || 'NickGuAI/HappyHerd',
    repositoryUrl: process.env.EXPO_PUBLIC_HAPPYHERD_REPOSITORY_URL?.trim() || 'https://github.com/NickGuAI/HappyHerd',
    issueUrl: process.env.EXPO_PUBLIC_HAPPYHERD_ISSUE_URL?.trim() ?? '',
    supportUrl: process.env.EXPO_PUBLIC_HAPPYHERD_SUPPORT_URL?.trim() ?? '',
});
