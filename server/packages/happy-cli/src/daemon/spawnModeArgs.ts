import type { SpawnSessionOptions } from '@/modules/common/registerCommonHandlers';

export function appendDaemonSpawnModeArgs(
    args: string[],
    options: SpawnSessionOptions,
    agent: string,
): void {
    if (agent !== 'claude' && agent !== 'codex' && agent !== 'grok') {
        return;
    }
    // For Claude, `default` is the app's ambient no-override value. For Codex,
    // it is a concrete ask-first mode and therefore must be forwarded.
    if (options.permissionMode && (agent === 'codex' || agent === 'grok' || options.permissionMode !== 'default')) {
        args.push('--permission-mode', options.permissionMode);
    }
    if (options.modelMode && options.modelMode !== 'default') {
        args.push('--model', options.modelMode);
    }
    if (options.effortLevel) {
        args.push('--effort', options.effortLevel);
    }
}
