const fs = require('node:fs');
const path = require('node:path');
const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

// Expo SDK 55 still generates UIApplication-owned windows. iOS 27 requires
// scene ownership when linking with its SDK. Keep this in prebuild so clean
// native builds receive the same migration as incremental builds.
const sceneDelegate = fs.readFileSync(path.join(__dirname, 'ios/SceneDelegate.swift'), 'utf8');
const marker = '// @generated HappyHerd iOS scene lifecycle';

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (config) => {
    const manifest = config.modResults.UIApplicationSceneManifest ?? {};
    config.modResults.UIApplicationSceneManifest = {
      ...manifest,
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        ...manifest.UISceneConfigurations,
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          // Matches @objc(SceneDelegate), independently of the product name.
          UISceneDelegateClassName: 'SceneDelegate',
        }],
      },
    };
    return config;
  });

  return withAppDelegate(config, (config) => {
    const appDelegate = config.modResults;
    if (appDelegate.language !== 'swift') {
      throw new Error('withIosSceneLifecycle requires the Expo Swift AppDelegate template.');
    }
    if (appDelegate.contents.includes(marker)) return config;

    const windowProperty = /^[ \t]*var window: UIWindow\?[ \t]*$/m;
    const startup = /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\(\s+withModuleName: "main",\s+in: window,\s+launchOptions: launchOptions\)\s+#endif/;
    if (!windowProperty.test(appDelegate.contents) || !startup.test(appDelegate.contents)) {
      throw new Error('withIosSceneLifecycle could not locate the Expo SDK 55 window startup block. Update the migration for the new AppDelegate template.');
    }
    appDelegate.contents = appDelegate.contents
      .replace(windowProperty, '$&\n  var initialLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?')
      .replace(startup, '    initialLaunchOptions = launchOptions')
      .trimEnd() + '\n\n' + marker + '\n' + sceneDelegate;
    return config;
  });
};
