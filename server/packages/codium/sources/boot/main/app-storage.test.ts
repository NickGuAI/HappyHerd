import { describe, expect, it } from 'vitest'
import { happyHomeDir, happyherdHomeName } from './app-storage'

describe('HappyHerd app storage paths', () => {
    it('retains the historical home on macOS and Windows', () => {
        /* rename:preserve */
        expect(happyherdHomeName('darwin')).toBe('Happy')
        expect(happyherdHomeName('win32')).toBe('Happy')
        expect(happyHomeDir('darwin', '/Users/user')).toBe('/Users/user/Happy')
        expect(happyHomeDir('win32', '/Users/user')).toBe('/Users/user/Happy')
        /* /rename:preserve */
    })

    it('retains the historical home on Linux', () => {
        /* rename:preserve */
        expect(happyherdHomeName('linux')).toBe('happy')
        expect(happyHomeDir('linux', '/home/user')).toBe('/home/user/happy')
        /* /rename:preserve */
    })
})
