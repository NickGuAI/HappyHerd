import { describe, expect, it } from 'vitest'
import { happyherdHomeDir, happyherdHomeName } from './app-storage'

describe('HappyHerd app storage paths', () => {
    it('retains the historical home on macOS and Windows', () => {
        expect(happyherdHomeName('darwin')).toBe('Happy')
        expect(happyherdHomeName('win32')).toBe('Happy')
        expect(happyherdHomeDir('darwin', '/Users/user')).toBe('/Users/user/Happy')
        expect(happyherdHomeDir('win32', '/Users/user')).toBe('/Users/user/Happy')
    })

    it('retains the historical home on Linux', () => {
        expect(happyherdHomeName('linux')).toBe('happy')
        expect(happyherdHomeDir('linux', '/home/user')).toBe('/home/user/happy')
    })
})
