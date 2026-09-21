const { execFileSync } = require('node:child_process');
const productMetadata = require('./product-metadata.json');
const happyHerdCliPackage = require('../happyherd-cli/package.json');

const variant = process.env.APP_ENV || 'development';
/* rename:preserve */
const bundleIdBase = process.env.HAPPYHERD_APP_BUNDLE_ID || process.env.HAPPY_APP_BUNDLE_ID || 'app.happyherd.client';
const easProjectId = process.env.HAPPYHERD_EAS_PROJECT_ID || process.env.HAPPY_EAS_PROJECT_ID;
const appLinkHost = process.env.HAPPYHERD_APP_LINK_HOST || process.env.HAPPY_APP_LINK_HOST;
const iosBuildNumber = process.env.HAPPYHERD_IOS_BUILD_NUMBER || process.env.HAPPY_IOS_BUILD_NUMBER || '1';
const easOwner = process.env.HAPPYHERD_EAS_OWNER || process.env.HAPPY_EAS_OWNER;
/* /rename:preserve */
const name = {
    development: productMetadata.developmentDisplayName,
    preview: productMetadata.previewDisplayName,
    production: productMetadata.displayName,
}[variant];
const bundleId = {
    development: "com.slopus.happy.dev",
    preview: "com.slopus.happy.preview",
    production: "com.ex3ndr.happy"
}[variant];
const iosBundleId = {
    development: `${bundleIdBase}.dev`,
    preview: `${bundleIdBase}.preview`,
    production: bundleIdBase,
}[variant];
// const stagingElevenLabsAgentId = 'agent_7801k2c0r5hjfraa1kdbytpvs6yt';
const productionElevenLabsAgentId = 'agent_6701k211syvvegba4kt7m68nxjmw';
const elevenLabsAgentId = {
    development: productionElevenLabsAgentId,
    preview: productionElevenLabsAgentId,
    production: productionElevenLabsAgentId,
}[variant];
const consoleLoggingDefault = {
    development: true,
    preview: true,
    production: false,
}[variant];

function git(args) {
    try {
        return execFileSync('git', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || undefined;
    } catch {
        return undefined;
    }
}

function loadBuildMetadata() {
    const commitSha =
        /* rename:preserve */
        process.env.HAPPYHERD_BUILD_COMMIT_SHA || process.env.HAPPY_BUILD_COMMIT_SHA ||
        /* /rename:preserve */
        process.env.EAS_BUILD_GIT_COMMIT_HASH ||
        process.env.GITHUB_SHA ||
        git(['rev-parse', 'HEAD']);
    const commitTimestamp =
        /* rename:preserve */
        process.env.HAPPYHERD_BUILD_COMMIT_TIMESTAMP || process.env.HAPPY_BUILD_COMMIT_TIMESTAMP ||
        /* /rename:preserve */
        (commitSha
            ? git(['show', '-s', '--format=%cI', commitSha])
            : git(['show', '-s', '--format=%cI', 'HEAD']));

    return {
        commitSha,
        commitTimestamp,
    };
}

const buildMetadata = loadBuildMetadata();

export default {
    expo: {
        name,
        slug: "happyherd",
        version: happyHerdCliPackage.version,
        runtimeVersion: "21",
        orientation: "default",
        icon: "./sources/assets/images/icon.png",
        scheme: ["happyherd", /* rename:preserve */ "happy" /* /rename:preserve */],
        userInterfaceStyle: "automatic",
        ios: {
            supportsTablet: true,
            bundleIdentifier: iosBundleId,
            buildNumber: iosBuildNumber,
            ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
            config: {
                usesNonExemptEncryption: false
            },
            infoPlist: {
                NSMicrophoneUsageDescription: "Allow $(PRODUCT_NAME) to access your microphone for voice conversations with AI.",
                NSLocalNetworkUsageDescription: "Allow $(PRODUCT_NAME) to find and connect to local devices on your network.",
                NSBonjourServices: ["_http._tcp", "_https._tcp"],
                // ATS:
                // - NSAllowsLocalNetworking: lets HTTP fetches reach LAN
                //   addresses (e.g. self-hosted server at 192.168.x.y) without
                //   forcing TLS. Production cloud server is HTTPS, so the
                //   default policy still applies there.
                // - In dev/preview only, allow arbitrary HTTP loads so a
                //   developer pointing the app at their machine doesn't have
                //   to ship a TLS cert just to test attachment uploads.
                NSAppTransportSecurity: variant === 'production'
                    ? { NSAllowsLocalNetworking: true }
                    : { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoads: true }
            },
            ...(variant === 'production' && appLinkHost
                ? { associatedDomains: [`applinks:${appLinkHost}`] }
                : {})
        },
        android: {
            adaptiveIcon: {
                foregroundImage: "./sources/assets/images/icon-adaptive.png",
                monochromeImage: "./sources/assets/images/icon-monochrome.png",
                backgroundColor: "#F7EFDD"
            },
            permissions: [
                "android.permission.RECORD_AUDIO",
                "android.permission.MODIFY_AUDIO_SETTINGS",
                "android.permission.ACCESS_NETWORK_STATE",
                "android.permission.POST_NOTIFICATIONS",
            ],
            blockedPermissions: [
                "android.permission.ACTIVITY_RECOGNITION",
                // Not using external storage/media access for now — blocks Google Play photo/video permission declaration
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.WRITE_EXTERNAL_STORAGE",
                "android.permission.READ_MEDIA_IMAGES",
                "android.permission.READ_MEDIA_VIDEO",
            ],
            package: bundleId,
            googleServicesFile: "./google-services.json",
            intentFilters: variant === 'production' ? [
                {
                    "action": "VIEW",
                    "autoVerify": true,
                    "data": [
                        {
                            "scheme": "https",
                            "host": "app.happy.engineering",
                            "pathPrefix": "/"
                        }
                    ],
                    "category": ["BROWSABLE", "DEFAULT"]
                }
            ] : []
        },
        web: {
            bundler: "metro",
            output: "single",
            favicon: "./sources/assets/images/favicon.png"
        },
        plugins: [
            require("./plugins/withEinkCompatibility.js"),
            [
                "expo-router",
                {
                    root: "./sources/app"
                }
            ],
            "expo-updates",
            "expo-asset",
            "expo-localization",
            "expo-mail-composer",
            "expo-secure-store",
            "expo-web-browser",
            "react-native-vision-camera",
            "@more-tech/react-native-libsodium",
            "react-native-audio-api",
            "@livekit/react-native-expo-plugin",
            "@config-plugins/react-native-webrtc",
            [
                "expo-audio",
                {
                    microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone for voice conversations."
                }
            ],
            [
                "expo-location",
                {
                    locationAlwaysAndWhenInUsePermission: "Allow $(PRODUCT_NAME) to improve AI quality by using your location.",
                    locationAlwaysPermission: "Allow $(PRODUCT_NAME) to improve AI quality by using your location.",
                    locationWhenInUsePermission: "Allow $(PRODUCT_NAME) to improve AI quality by using your location."
                }
            ],
            [
                "expo-calendar",
                {
                    "calendarPermission": "Allow $(PRODUCT_NAME) to access your calendar to improve AI quality."
                }
            ],
            [
                "expo-camera",
                {
                    cameraPermission: "Allow $(PRODUCT_NAME) to access your camera to scan QR codes and share photos with AI.",
                    microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone for voice conversations.",
                    recordAudioAndroid: true
                }
            ],
            [
                "expo-notifications",
                {
                    "enableBackgroundRemoteNotifications": true,
                    "icon": "./sources/assets/images/icon-notification.png"
                }
            ],
            [
                'expo-splash-screen',
                {
                    ios: {
                        backgroundColor: "#F7EFDD",
                        dark: {
                            backgroundColor: "#010204",
                        }
                    },
                    android: {
                        image: "./sources/assets/images/splash-android-light.png",
                        backgroundColor: "#F7EFDD",
                        dark: {
                            image: "./sources/assets/images/splash-android-dark.png",
                            backgroundColor: "#010204",
                        }
                    }
                }
            ]
        ],
        // Native builds can ship through Xcode without an Expo account. Only
        // configure OTA/push ownership when this distribution has its own project.
        updates: easProjectId ? {
            url: `https://u.expo.dev/${easProjectId}`,
            requestHeaders: {
                "expo-channel-name": variant,
            }
        } : { enabled: false },
        experiments: {
            typedRoutes: true
        },
        extra: {
            router: {
                root: "./sources/app"
            },
            ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
            app: {
                product: productMetadata,
                postHogKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
                revenueCatAppleKey: process.env.EXPO_PUBLIC_REVENUE_CAT_APPLE,
                revenueCatGoogleKey: process.env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE,
                revenueCatStripeKey: process.env.EXPO_PUBLIC_REVENUE_CAT_STRIPE,
                elevenLabsAgentId,
                consoleLoggingDefault,
                buildCommitSha: buildMetadata.commitSha,
                buildCommitTimestamp: buildMetadata.commitTimestamp,
            }
        },
        ...(easOwner ? { owner: easOwner } : {}),
    }
};
