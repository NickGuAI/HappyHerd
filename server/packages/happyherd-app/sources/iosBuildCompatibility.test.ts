import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { patchPodfile, minimumDeploymentTarget } = require('../plugins/withIosBuildCompatibility');
const rubyPath = resolve(import.meta.dirname, '../plugins/iosBuildCompatibility.rb');
const podfile = `target 'HappyHerd' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
    )
  end
end
`;
const initializer = `    /// "Designated" initializer
    private init(stringRepresentation: String, underlyingColor: (any Sendable)?) {
        self.stringRepresentation = stringRepresentation
        self._underlyingColor = underlyingColor
    }
`;
const original = `public struct PaywallColor {
    public var stringRepresentation: String
    fileprivate var _underlyingColor: (any Sendable)?

}
extension PaywallColor {
    public init(stringRepresentation: String) throws {
        self.init(stringRepresentation: stringRepresentation, underlyingColor: nil)
    }
}
private extension PaywallColor {
${initializer}
}
`;

function runPostInstall(source: string | undefined, repetitions = 1) {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-ios-pods-'));
    const colorPath = join(directory, 'RevenueCat/Sources/Paywalls/PaywallColor.swift');
    try {
        if (source !== undefined) {
            mkdirSync(join(directory, 'RevenueCat/Sources/Paywalls'), { recursive: true });
            writeFileSync(colorPath, source, { mode: 0o444 });
        }
        const settings = JSON.parse(execFileSync('ruby', ['-e', `
require 'json'
require 'ostruct'
configs = [nil, '9.0', '15.1', '16.0', '17.2'].map do |value|
  OpenStruct.new(build_settings: { 'IPHONEOS_DEPLOYMENT_TARGET' => value })
end
installer = OpenStruct.new(
  pods_project: OpenStruct.new(targets: [OpenStruct.new(build_configurations: configs)]),
  sandbox: OpenStruct.new(root: ARGV[0])
)
${repetitions}.times { eval(File.read(ARGV[1]), binding, ARGV[1]) }
puts JSON.generate(configs.map { |config| config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] })
`, directory, rubyPath], { encoding: 'utf8' }));
        return { source: source === undefined ? undefined : readFileSync(colorPath, 'utf8'), settings };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

describe('iOS compiler compatibility', () => {
    it('inserts one post-install adjustment after React Native on repeated prebuilds', () => {
        const patched = patchPodfile(podfile);
        expect(patchPodfile(patched)).toBe(patched);
        expect(patched.indexOf('installer.pods_project.targets.each')).toBeGreaterThan(patched.indexOf(':mac_catalyst_enabled'));
        expect(patched.endsWith('  end\nend\n')).toBe(true);
        execFileSync('ruby', ['-c'], { input: patched });
    });

    it('reports a changed Expo hook rather than injecting Ruby into an unknown location', () => {
        expect(() => patchPodfile('target "App" do\nend\n')).toThrow('Cannot locate');
    });

    it('raises app/property minimums without lowering a higher deployment target', () => {
        expect([undefined, '9.0', '15.1', '16.0', '17.2', '"17.2"'].map(minimumDeploymentTarget))
            .toEqual(['16.0', '16.0', '16.0', '16.0', '17.2', '"17.2"']);
    });

    it('moves only the known initializer into the struct and raises every pod configuration', () => {
        const result = runPostInstall(original);
        expect(result.settings).toEqual(['16.0', '16.0', '16.0', '16.0', '17.2']);
        const expected = original.replace(initializer, '').replace(
            '    fileprivate var _underlyingColor: (any Sendable)?\n\n}',
            `    fileprivate var _underlyingColor: (any Sendable)?\n\n${initializer}\n}`,
        );
        expect(result.source).toBe(expected);
        expect(runPostInstall(original, 2).source).toBe(expected);
        expect(runPostInstall(expected).source).toBe(expected);
    });

    it('preserves upstream-changed sources and handles builds without RevenueCat', () => {
        const changed = original.replace('fileprivate var _underlyingColor', 'private var _underlyingColor');
        expect(runPostInstall(changed).source).toBe(changed);
        expect(runPostInstall(original.replace(initializer, '')).source).toBe(original.replace(initializer, ''));
        expect(runPostInstall(undefined).settings).toEqual(['16.0', '16.0', '16.0', '16.0', '17.2']);
    });
});
