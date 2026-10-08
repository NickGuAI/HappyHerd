import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const withIosSceneLifecycle = require('../plugins/withIosSceneLifecycle.js');
const template = readFileSync(new URL('./__fixtures__/AppDelegate.sdk55.swift', import.meta.url), 'utf8');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

// Invoke the real Expo mods rather than mocking withAppDelegate/withInfoPlist.
// File providers supply these same modResults during prebuild.
async function runMods(contents = template, infoPlist: Record<string, unknown> = {}, registrations = 1) {
    let config: any = { name: 'Scene test', slug: 'scene-test' };
    for (let i = 0; i < registrations; i++) config = withIosSceneLifecycle(config);
    const run = (mod: string, modResults: unknown) => config.mods.ios[mod]({
        ...config,
        modResults,
        modRawConfig: {},
        modRequest: { projectRoot, platformProjectRoot: `${projectRoot}/ios`, platform: 'ios', modName: mod },
    });
    const app = await run('appDelegate', { path: 'AppDelegate.swift', language: 'swift', contents });
    const plist = await run('infoPlist', infoPlist);
    return { contents: app.modResults.contents as string, infoPlist: plist.modResults };
}

describe('iOS scene lifecycle prebuild plugin', () => {
    it('moves the Expo SDK 55 startup to a scene while preserving factory and link overrides', async () => {
        const { contents, infoPlist } = await runMods();
        const appDelegate = contents.slice(0, contents.indexOf('@objc(SceneDelegate)'));
        const scene = contents.slice(contents.indexOf('@objc(SceneDelegate)'));
        expect(appDelegate).toContain('let factory = ExpoReactNativeFactory(delegate: delegate)');
        expect(appDelegate).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
        expect(appDelegate).toContain('RCTLinkingManager.application(app, open: url, options: options)');
        expect(appDelegate).toContain('initialLaunchOptions = launchOptions');
        expect(appDelegate).not.toContain('factory.startReactNative(');
        expect(contents).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
        expect(contents.match(/factory.startReactNative\(/g)).toHaveLength(1);
        expect(scene).toContain('UIWindow(windowScene: windowScene)');
        expect(scene).toContain('window = sceneWindow');
        expect(scene).toContain('appDelegate.window = sceneWindow');
        expect(infoPlist.UIApplicationSceneManifest).toEqual({
            UIApplicationSupportsMultipleScenes: false,
            UISceneConfigurations: {
                UIWindowSceneSessionRoleApplication: [{
                    UISceneConfigurationName: 'Default Configuration',
                    UISceneDelegateClassName: 'SceneDelegate',
                }],
            },
        });
    });

    it('preserves cold URL delivery before JS and forwards warm links and Expo lifecycle callbacks', async () => {
        const { contents } = await runMods();
        expect(contents).toContain('var launchOptions = appDelegate.initialLaunchOptions ?? [:]');
        expect(contents).toContain('launchOptions[.url] = context.url');
        expect(contents).toContain('"UIApplicationLaunchOptionsUserActivityKey": activity');
        expect(contents.indexOf('self.scene(scene, openURLContexts: connectionOptions.urlContexts)'))
            .toBeLessThan(contents.indexOf('factory.startReactNative('));
        expect(contents).toContain('appDelegate?.application(UIApplication.shared, open: context.url, options: options)');
        expect(contents).toContain('appDelegate?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })');
        for (const event of ['DidBecomeActive', 'WillResignActive', 'DidEnterBackground', 'WillEnterForeground']) {
            expect(contents).toContain(`func scene${event}(_ scene: UIScene)`);
            expect(contents).toContain(`appDelegate?.application${event}(UIApplication.shared)`);
        }
        expect(contents).not.toContain('NotificationCenter.default.post');
    });

    it('is stable on a second prebuild and duplicate plugin registration', async () => {
        const first = await runMods();
        expect(await runMods(first.contents, first.infoPlist)).toEqual(first);
        expect(await runMods(template, {}, 2)).toEqual(first);
    });

    it('preserves unrelated native customizations and scene roles', async () => {
        const customized = template.replace('import Expo', 'internal import Expo')
            .replace('  var window:', '  // Another plugin customization\n  var window:');
        const { contents, infoPlist } = await runMods(customized, {
            CFBundleDisplayName: 'Independent build',
            UIApplicationSceneManifest: {
                SomeOtherSetting: true,
                UISceneConfigurations: { UIWindowSceneSessionRoleExternalDisplayNonInteractive: [{ name: 'external' }] },
            },
        });
        expect(contents).toContain('internal import Expo');
        expect(contents).toContain('// Another plugin customization');
        expect(infoPlist.CFBundleDisplayName).toBe('Independent build');
        expect(infoPlist.UIApplicationSceneManifest.SomeOtherSetting).toBe(true);
        expect(infoPlist.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleExternalDisplayNonInteractive)
            .toEqual([{ name: 'external' }]);
    });

    it('reports a changed native template instead of leaving a manifest without migrated startup', async () => {
        await expect(runMods(template.replace('factory.startReactNative(', 'otherFactory.startReactNative(')))
            .rejects.toThrow('could not locate the Expo SDK 55 window startup block');
    });
});
