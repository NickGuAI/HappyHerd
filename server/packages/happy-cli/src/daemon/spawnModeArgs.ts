import type { SpawnSessionOptions } from '@/modules/common/registerCommonHandlers';

export function appendDaemonSpawnModeArgs(
    args: string[],
    options: SpawnSessionOptions,
    agent: string,
): void {
    if (agent !== 'claude' && agent !== 'codex' && agent !== 'grok' && agent !== 'agy') {
        return;
    }
    const validated = options.effectiveSettings?.provider === agent
        ? options.effectiveSettings
        : null;
    const permissionMode = validated ? validated.permission : options.permissionMode;
    const modelMode = validated ? validated.model : options.modelMode;
    const effortLevel = validated ? validated.effort : options.effortLevel;
    // Every advertised permission is a concrete Human selection. Missing is
    // ambient provider configuration; explicit `default` must still leave a
    // prior bypass/plan mode at launch and on resume.
    if (permissionMode) {
        args.push('--permission-mode', permissionMode);
    }
    if (modelMode && modelMode !== 'default') {
        args.push('--model', modelMode);
    }
    if (effortLevel) {
        if (agent === 'agy') {
            return;
        }
        args.push('--effort', effortLevel);
    }
}
