import { describe, expect, it } from 'vitest';
import { resolveNewSessionProjectId } from './newSessionProject';

const projects = { focus: { kind: 'personal' }, other: { kind: 'personal' }, agent: { kind: null } };
const focus = { projectId: 'focus', endsAt: 2_000 };

describe('new session account project', () => {
    it('defaults an untouched choice to the active personal Focus project', () => {
        expect(resolveNewSessionProjectId(undefined, focus, projects, 1_000)).toBe('focus');
    });

    it.each([null, 'other'])('honors explicit choice %s instead of focus', (selection) => {
        expect(resolveNewSessionProjectId(selection, focus, projects, 1_000)).toBe(selection);
    });

    it('preserves active Focus while its project catalog entry is still loading', () => {
        expect(resolveNewSessionProjectId(undefined, focus, {}, 1_000)).toBe('focus');
    });

    it('ignores absent, expired and known nonpersonal focus projects', () => {
        expect(resolveNewSessionProjectId(undefined, null, projects, 1_000)).toBeNull();
        expect(resolveNewSessionProjectId(undefined, focus, projects, 2_000)).toBeNull();
        expect(resolveNewSessionProjectId(undefined, { ...focus, projectId: 'agent' }, projects, 1_000)).toBeNull();
    });
});
