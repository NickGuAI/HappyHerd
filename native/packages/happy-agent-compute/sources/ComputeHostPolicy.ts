import { type Static, Type } from "@sinclair/typebox";

/**
 * What the program embedding this package calls itself, and where it keeps its things.
 *
 * A compute enforces boundaries around files, and some of those files belong to the agent product
 * itself: the configuration that decides what a command may reach, the directory holding its
 * credentials, the skills it can read. Which files those are is not something this package can
 * know — it is a fact about the product built on top of it. Naming them here keeps the package
 * general: any agent, not only Happy's, can describe its own layout and get the same protection.
 *
 * Everything is optional. A caller that describes nothing gets a compute that protects the
 * universally sensitive things — a person's SSH keys, cloud credentials, shell history — and
 * nothing product-specific, which is the correct default for an embedder that has no such files.
 */
export const computeHostPolicySchema = Type.Object({
    /**
     * Root project files that a restricted command must never create or modify.
     *
     * These are the settings that decide what later commands may do. A command that could rewrite
     * them could widen its own boundary, so they sit above the boundary rather than inside it.
     */
    protectedProjectFiles: Type.Optional(Type.Array(Type.String())),
    /**
     * The subset of those files that can grant a command network access, and so are read as policy
     * rather than merely protected from writes.
     */
    networkPolicyFiles: Type.Optional(Type.Array(Type.String())),
    /**
     * Absolute directories holding the embedding product's own configuration, state, or
     * credentials. A restricted command may not read these, for the same reason it may not read a
     * person's `.ssh`.
     */
    privateDirectories: Type.Optional(Type.Array(Type.String())),
    /** Absolute directories of read-only material a restricted command may read, such as skills. */
    readableDirectories: Type.Optional(Type.Array(Type.String())),
    /**
     * Environment variables whose values name private paths, so a command cannot reach them by
     * following a variable the package does not know about.
     */
    privatePathVariables: Type.Optional(Type.Array(Type.String())),
});

export type ComputeHostPolicy = Static<typeof computeHostPolicySchema>;

/**
 * The policy for an embedder that has described nothing.
 *
 * Deliberately empty. The universally sensitive paths — credentials, keys, shell history — are not
 * here because they are not the embedder's to declare; the package protects those on its own.
 */
export const EMPTY_COMPUTE_HOST_POLICY: ComputeHostPolicy = {};
