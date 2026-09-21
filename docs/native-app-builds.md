# Native macOS and iOS builds

The desktop client is the existing Tauri app around the production Web bundle.
The iOS client is the existing Expo/React Native app. These builds are separate
from the CLI/server archives produced by `native-installer-release.yml`.

Run package commands from `server/` with the pinned pnpm version. Use Xcode with
the iOS SDK, CocoaPods, and Rust for the corresponding native build. The native
directories and build outputs are generated; do not commit signing identities,
provisioning profiles, account credentials, or exported archives.

## Release configuration

Set these values in the release environment before generating or building iOS:

```sh
export APP_ENV=production
export HAPPYHERD_APP_BUNDLE_ID=com.example.happyherd
export APPLE_TEAM_ID=EXAMPLETEAM
export HAPPYHERD_IOS_BUILD_NUMBER=1
export EXPO_PUBLIC_HAPPYHERD_SERVER_URL=https://happy.example.com
```

Use the registered bundle ID and actual Apple Developer team for the release.
The checked-in `app.happyherd.client` ID is a neutral local-build default.
Development and preview iOS variants append `.dev` and `.preview` respectively.
The app version comes from the maintained CLI package; the iOS build number is
independently incremented for each upload.

The server remains user-selectable through the normal app settings. Supply the
intended server when exporting Web assets for a desktop release or bundling iOS.

Optional service settings:

- `HAPPYHERD_EAS_PROJECT_ID` and `HAPPYHERD_EAS_OWNER` select the distribution's own Expo
  project/account for EAS, push notifications, and over-the-air updates. Without
  a project ID, OTA is disabled and Expo push registration has no project; local
  Xcode builds still work. Do not substitute the upstream Happy project.
- `HAPPYHERD_APP_LINK_HOST` enables the production iOS associated domain. Configure
  the matching Apple association file on that host before relying on universal
  links. The normal `happyherd` URL scheme is retained.
- EAS submission profiles deliberately contain no upstream account or App Store
  Connect app ID. Configure the release account before using EAS submission.

## macOS DMG

Use the standard Tauri signing and notarization environment for the release
account: `APPLE_SIGNING_IDENTITY`, plus either Apple's notarization API-key
credentials or `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), and
`APPLE_TEAM_ID`. Keep these in the release environment, never in Git.

```sh
pnpm --filter happyherd-app tauri:build:production \
  --bundles app dmg --config '{"identifier":"com.example.happyherd"}'
```

The identifier override must match the release identity above. Tauri's existing
`--config` mechanism supplies it without storing an operator's personal
identifier in public source. Its production script explicitly selects the
production Expo variant. Desktop versioning follows the CLI package, like iOS.

The default target is the build machine's architecture. For a universal macOS
artifact, install both Rust Apple targets and add
`--target universal-apple-darwin`. An unsigned local test build can use Tauri's
standard `--no-sign` option; that output is not a signed/notarized release.

Artifacts are under `packages/happyherd-app/src-tauri/target/release/bundle/`
(or the selected target directory). Before distribution, verify the actual app
and disk image with `codesign --verify --deep --strict`, Gatekeeper's `spctl`
assessment, `xcrun stapler validate`, and `hdiutil verify`. Launch the app and
exercise the normal account/server entry. A successful build alone is not
notarization or authenticated-flow evidence.

## iOS simulator, archive, and export

Generate the native project with the selected release configuration:

```sh
pnpm --filter happyherd-app exec expo prebuild --platform ios
xcodebuild -workspace packages/happyherd-app/ios/HappyHerd.xcworkspace \
  -scheme HappyHerd -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/happyherd-simulator CODE_SIGNING_ALLOWED=NO build
```

The simulator app is under the derived data directory's
`Build/Products/Release-iphonesimulator/`. It is not an IPA for physical devices.

For a signed device archive, use the enrolled Apple Developer team and its
Apple Distribution signing identity:

```sh
xcodebuild -workspace packages/happyherd-app/ios/HappyHerd.xcworkspace \
  -scheme HappyHerd -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/HappyHerd.xcarchive -allowProvisioningUpdates archive
```

Use Xcode Organizer to export/upload the archive for TestFlight, or
`xcodebuild -exportArchive` with a release-local export options plist specifying
`method=app-store-connect`, the actual `teamID`, `signingStyle=automatic`, and
`destination=export` (IPA) or `upload` (App Store Connect). Confirm the matching
App Store Connect app record exists. Apple signing/export and TestFlight
processing are separate verification steps. They do not constitute a public
App Store release.

## Commander creation and verification

The journey is New Session → Commander picker → Create Commander → ordinary
guided onboarding. The action follows available Commander rows on Web and
native, uses a button role with localized name/hint, and lets its text wrap for
larger text sizes. Selecting it sets the existing onboarding prompt, closes the
picker, and preserves machine, provider, path, Commander, and session controls.
The normal send action starts the session; this does not add a parallel creation
service or automatically run the prompt.

Source regression coverage:

- `sources/app/(app)/new/index.launch.test.ts`: compact/regular iOS and
  desktop/mobile Web hosts, row order, accessibility, and selection retention.
- `sources/utils/newSessionCommanderCreation.test.ts`: shared intent.
- `sources/nativeBuildConfig.test.ts`: distribution identities, optional Expo
  ownership, matching update channels, and absence of upstream submission/signing
  accounts.
- Metro excludes test/spec files and `__tests__` directories from native and Web
  bundles while preserving Expo's default exclusions. Verify with an actual
  production iOS bundle and Xcode Release build.

Run the app tests/typecheck, UI inventory and localization checks, production Web
export, and repository contract suite. Keep real native acceptance distinct:
test iPhone/iPad, English/Chinese/German, light/dark, Dynamic Type, VoiceOver, and
the authenticated onboarding completion/resume/discovery journey. Mocked host
tests and simulator startup do not by themselves close issue #85.

Record exact-commit build, signing, notarization, TestFlight, and native journey
evidence in the owning task and PR. Missing credentials or live acceptance remain
unproved; do not report them as passed.
