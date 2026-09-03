import metadata from '../../product-metadata.json';

// Repository ownership is deployment metadata, not product identity. Public
// distributions can inject their support destination without baking a person
// or organization into this generic source tree.
export const PRODUCT = Object.freeze({
    ...metadata,
    repositoryDisplay: process.env.EXPO_PUBLIC_HAPPYHERD_REPOSITORY_DISPLAY?.trim() ?? '',
    repositoryUrl: process.env.EXPO_PUBLIC_HAPPYHERD_REPOSITORY_URL?.trim() ?? '',
    issueUrl: process.env.EXPO_PUBLIC_HAPPYHERD_ISSUE_URL?.trim() ?? '',
    supportUrl: process.env.EXPO_PUBLIC_HAPPYHERD_SUPPORT_URL?.trim() ?? '',
});
