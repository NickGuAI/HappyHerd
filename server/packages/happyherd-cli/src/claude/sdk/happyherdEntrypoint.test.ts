import { describe, expect, it } from 'vitest'

import { HAPPYHERD_DEFAULT_ENTRYPOINT, resolveHappyHerdEntrypoint } from './happyherdEntrypoint'

describe('resolveHappyHerdEntrypoint', () => {
    it('falls back to the HappyHerd default when no value is set', () => {
        expect(resolveHappyHerdEntrypoint(undefined)).toBe(HAPPYHERD_DEFAULT_ENTRYPOINT)
        expect(resolveHappyHerdEntrypoint('')).toBe(HAPPYHERD_DEFAULT_ENTRYPOINT)
    })

    it('keeps a value the operator already exported', () => {
        expect(resolveHappyHerdEntrypoint('cli')).toBe('cli')
        expect(resolveHappyHerdEntrypoint('claude-vscode')).toBe('claude-vscode')
        expect(resolveHappyHerdEntrypoint('sdk-ts')).toBe('sdk-ts')
    })

    it('uses a default that is NOT in the SDK picker-filter set', () => {
        // Claude Code's `--resume` picker hides sessions whose recorded
        // entrypoint is one of these. The HappyHerd default must avoid that set
        // so HappyHerd-touched sessions stay visible in the picker.
        const sdkPickerFilterSet = new Set(['sdk-cli', 'sdk-ts', 'sdk-py'])
        expect(sdkPickerFilterSet.has(HAPPYHERD_DEFAULT_ENTRYPOINT)).toBe(false)
    })

    it('uses a default Claude Code recognises as a valid entrypoint', () => {
        // Mirrors `zO9` allowlist in the Claude Code binary (v2.1.x). If the
        // value falls outside this set, several internal helpers drop it.
        const claudeKnownEntrypoints = new Set([
            'cli',
            'mcp',
            'sdk-cli',
            'sdk-ts',
            'sdk-py',
            'bench',
            'claude-vscode',
            'claude-code-github-action',
            'local-agent',
            'claude-desktop',
            'remote',
            'remote_baku',
            'remote_desktop',
            'remote_mobile',
            'claude_in_slack',
            'claude-desktop-3p',
            'ssh-remote',
        ])
        expect(claudeKnownEntrypoints.has(HAPPYHERD_DEFAULT_ENTRYPOINT)).toBe(true)
    })
})
