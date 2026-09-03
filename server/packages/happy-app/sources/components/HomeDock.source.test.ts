import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const homeDockSource = readFileSync(new URL('./HomeDock.tsx', import.meta.url), 'utf8');
const mainViewSource = readFileSync(new URL('./MainView.tsx', import.meta.url), 'utf8');

describe('HomeDock focused prompt placeholder', () => {
    it('renders the localized selected-provider name while preserving Codex copy', () => {
        expect(homeDockSource).toContain(`const focusedPromptPlaceholder = agentType === 'codex'
        ? t('uiCopy.askCodex')
        : t('uiCopy.askValue', { value1: currentAgent.name });`);
        expect(homeDockSource).toContain('placeholder={focusedPromptPlaceholder}');
    });
});

describe('HomeDock dsh workspace attachments', () => {
    it('reuses the machine uploader for Photos and unrestricted Device Files', () => {
        expect(homeDockSource).toContain('const workspaceUploader = useMachineFileUpload({');
        expect(homeDockSource).toContain('const images = await pickImagesForUpload(');
        expect(homeDockSource).toContain('await workspaceUploader.uploadAssets(images);');
        expect(homeDockSource).toContain('onPickDeviceFiles={canPickDshWorkspaceFiles');
        expect(homeDockSource).toContain('? () => void workspaceUploader.pickAndUpload()');
        expect(homeDockSource).toContain('const canSubmit = !isSubmitting && !dshUploadBusy && (');
    });

    it('passes exact uploaded entries into the shared initial-message owner', () => {
        expect(homeDockSource).toContain('const started = await onSubmit(workspaceEntries);');
        expect(mainViewSource).toContain('const started = await startHomeSession(workspaceEntries);');
    });

    it('remains native-only because Web mounts Full New Session instead of HomeDock', () => {
        expect(mainViewSource).toContain("{Platform.OS === 'web' ? (");
        expect(mainViewSource).toContain("{!searchActive && (");
        expect(mainViewSource).toContain('<HomeDock');
    });
});
