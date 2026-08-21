import type {
    HappyHerdAutomation,
    HappyHerdAutomationHistoryResponse,
    HappyHerdAutomationRun,
} from '@slopus/happy-wire';

export type HappyHerdAutomationMachineOperations = {
    pause: (machineId: string, automationId: string) => Promise<HappyHerdAutomation>;
    resume: (machineId: string, automationId: string) => Promise<HappyHerdAutomation>;
    runNow: (machineId: string, automationId: string) => Promise<HappyHerdAutomationRun>;
    history: (machineId: string, automationId: string) => Promise<HappyHerdAutomationHistoryResponse>;
    delete: (machineId: string, automationId: string) => Promise<void>;
};

export function createHappyHerdAutomationMachineActions(
    operations: HappyHerdAutomationMachineOperations,
) {
    return {
        toggleStatus(automation: HappyHerdAutomation) {
            return automation.status === 'active'
                ? operations.pause(automation.machineId, automation.id)
                : operations.resume(automation.machineId, automation.id);
        },
        runNow(automation: HappyHerdAutomation) {
            return operations.runNow(automation.machineId, automation.id);
        },
        history(automation: HappyHerdAutomation) {
            return operations.history(automation.machineId, automation.id);
        },
        delete(automation: HappyHerdAutomation) {
            return operations.delete(automation.machineId, automation.id);
        },
    };
}
