const fs = require('node:fs');
const path = require('node:path');

const MINIMUM_IOS_VERSION = '16.0';
const START = '    # @generated begin happyherd-ios-build-compatibility';
const END = '    # @generated end happyherd-ios-build-compatibility';

function minimumDeploymentTarget(value) {
  const current = Number.parseFloat(String(value ?? '').replaceAll('"', ''));
  return Number.isFinite(current) && current >= 16 ? value : MINIMUM_IOS_VERSION;
}

function patchPodfile(contents) {
  const clean = contents.replace(new RegExp(`\\n${START}\\n[\\s\\S]*?${END}\\n`, 'g'), '');
  // Expo SDK 55's hook must finish first: React Native also adjusts pod settings.
  const anchor = /(^[ \t]*)react_native_post_install\(\n[\s\S]*?^\1\)/m;
  if (!anchor.test(clean)) {
    throw new Error('Cannot locate Expo react_native_post_install in the generated Podfile');
  }
  const ruby = fs.readFileSync(path.join(__dirname, 'iosBuildCompatibility.rb'), 'utf8').trimEnd();
  const block = ruby.split('\n').map((line) => line ? `    ${line}` : '').join('\n');
  return clean.replace(anchor, (hook) => `${hook}\n${START}\n${block}\n${END}\n`);
}

function withIosBuildCompatibility(config) {
  const { withPodfile, withPodfileProperties, withXcodeProject } = require('@expo/config-plugins');
  config = withPodfileProperties(config, (mod) => {
    mod.modResults['ios.deploymentTarget'] = minimumDeploymentTarget(mod.modResults['ios.deploymentTarget']);
    return mod;
  });
  config = withXcodeProject(config, (mod) => {
    for (const section of Object.values(mod.modResults.pbxXCBuildConfigurationSection())) {
      if (section?.buildSettings?.IPHONEOS_DEPLOYMENT_TARGET !== undefined) {
        section.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = minimumDeploymentTarget(section.buildSettings.IPHONEOS_DEPLOYMENT_TARGET);
      }
    }
    return mod;
  });
  return withPodfile(config, (mod) => {
    mod.modResults.contents = patchPodfile(mod.modResults.contents);
    return mod;
  });
}

module.exports = withIosBuildCompatibility;
module.exports.patchPodfile = patchPodfile;
module.exports.minimumDeploymentTarget = minimumDeploymentTarget;
