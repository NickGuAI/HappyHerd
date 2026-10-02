/**
 * Compute is deliberately re-exported from the published host-compute package.
 *
 * The module owns the model-facing tools, while the compute package owns host, Docker, and
 * emulated filesystem/process boundaries. Keeping the type identity here prevents a second,
 * subtly incompatible filesystem contract from growing inside the modules package.
 */
export type {
    Compute,
    ComputeFileStat,
    ComputeFileSystem,
    ComputeDirectoryPage,
    ComputeDirectoryPageOptions,
    ComputeReadOptions,
    ComputeKind,
    ComputePermissions,
    ComputePermissionMode,
    ComputeNetworkPermissions,
    ComputeRunOptions,
    ComputeRunResult,
    ComputeSessionActivity,
    ComputeSessionExit,
    ComputeSessionReadOptions,
    ComputeSessionSnapshot,
    ComputeSessionStatus,
    ComputeShell,
} from "@slopus/happy-agent-compute";
