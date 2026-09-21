export type AutomationProfileMethod =
    | 'happyherd-list-commanders'
    | 'happyherd-automations-list'
    | 'happyherd-automations-create'
    | 'happyherd-automations-update'
    | 'happyherd-automations-pause'
    | 'happyherd-automations-resume'
    | 'happyherd-automations-delete'
    | 'happyherd-automations-run-now'
    | 'happyherd-automations-history';

type AutomationProfileStage = 'rpc' | 'render' | 'route';
type AutomationProfileOperation = AutomationProfileMethod | 'commit' | 'total';
type AutomationProfileOutcome = 'success' | 'error';

export function automationProfileStart(): number {
    return typeof globalThis.performance?.now === 'function'
        ? globalThis.performance.now()
        : Date.now();
}

export function recordAutomationProfile(
    stage: AutomationProfileStage,
    operation: AutomationProfileOperation,
    outcome: AutomationProfileOutcome,
    startedAt: number,
): void {
    const performanceApi = globalThis.performance;
    if (!performanceApi || typeof performanceApi.measure !== 'function') return;

    try {
        performanceApi.measure(
            `happyherd.automations.${stage}.${operation}.${outcome}`,
            { start: startedAt, end: performanceApi.now() },
        );
    } catch {
        // Profiling must never change application behavior.
    }
}

export async function profileAutomationRpc<T>(
    method: AutomationProfileMethod,
    operation: () => Promise<T>,
): Promise<T> {
    const startedAt = automationProfileStart();
    try {
        const result = await operation();
        recordAutomationProfile('rpc', method, 'success', startedAt);
        return result;
    } catch (error) {
        recordAutomationProfile('rpc', method, 'error', startedAt);
        throw error;
    }
}
