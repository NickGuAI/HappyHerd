import Foundation
import CoreImage
import XCTest

final class InboxAcceptanceTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.happyherd.issue345.acceptance")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private var restoring = false
    private lazy var qrDetector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                                             options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
    private var qrAttempts = 0
    private var qrFeatureCountMax = 0
    private var qrPayloadPresent = false
    private var qrLinkShapeMatched = false
    private var qrDecoderSetupError = false
    private var notificationPromptSeen = false
    private var notificationPromptDeclined = false
    private var nativePhase: NativePhase = .setup
    private var reportingNativeFailure = false

    private enum NativePhase: String {
        case setup, activate
        case startupWait = "startup-wait"
        case startupReady = "startup-ready"
        case openServer = "open-server"
        case serverField = "server-field"
        case serverValue = "server-value"
        case serverCapture = "server-capture"
        case openRoot = "open-root"
        case auth
        case authLogin = "auth-login"
        case authQR = "auth-qr"
        case authApproval = "auth-approval"
        case authBell = "auth-bell"
        case inboxBell = "inbox-bell"
        case inboxPopover = "inbox-popover"
        case inboxOpenPage = "inbox-open-page"
        case inboxReady = "inbox-ready"
        case inboxUnread = "inbox-unread"
        case singleRead = "single-read"
        case singleReadNavigation = "single-read-navigation"
        case singleReadState = "single-read-state"
        case markAllRead = "mark-all-read"
        case allReadState = "all-read-state"
        case relaunch
        case relaunchBell = "relaunch-bell"
        case persistedReadState = "persisted-read-state"
        case newArrival = "new-arrival"
        case remoteDone = "remote-done"
        case accountScope = "account-scope"
        case accountLogout = "account-logout"
        case accountLogoutPanel = "account-logout-panel"
        case accountLogoutSettings = "account-logout-settings"
        case accountLogoutAccount = "account-logout-account"
        case accountLogoutScroll = "account-logout-scroll"
        case accountLogoutAction = "account-logout-action"
        case accountLogoutConfirmation = "account-logout-confirmation"
        case accountLogoutConfirm = "account-logout-confirm"
        case accountLogoutLogin = "account-logout-login"
        case accountB = "account-b"
        case accountA = "account-a"
        case doneRace = "done-race"
        case racePending = "race-pending"
        case serverRestart = "server-restart"
        case reconnectedArrival = "reconnected-arrival"
        case reconnectedDone = "reconnected-done"
        case finalRelaunch = "final-relaunch"
        case complete
    }

    private enum NativeAppState: String {
        case unknown
        case notRunning = "not-running"
        case backgroundSuspended = "background-suspended"
        case background, foreground
    }

    private enum AuthDiagnosticPhase: String {
        case afterApproval = "after-approval"
        case notificationDeclined = "notification-declined"
        case bellReady = "bell-ready"
        case failure
    }

    private enum AuthFailure: String {
        case loginControlMissing = "login-control-missing"
        case qrUnavailable = "qr-unavailable"
        case approvalUnacknowledged = "approval-unacknowledged"
        case bellUnavailable = "bell-unavailable"
    }

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    override func record(_ issue: XCTIssue) {
        reportNativeFailure()
        // Authentication failures retain no hierarchy, URL or custom attachment.
        // The scheme discards automatic captures with keepNever.
        if restoring {
            restoring = false
            app.terminate()
            super.record(XCTIssue(type: issue.type, compactDescription: "Native linking failed; app terminated before recording."))
        } else {
            super.record(issue)
        }
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func setPhase(_ phase: NativePhase) {
        nativePhase = phase
        marker("HH345_NATIVE_PHASE phase=\(phase.rawValue)")
    }

    private func currentAppState() -> NativeAppState {
        switch app.state {
        case .unknown: return .unknown
        case .notRunning: return .notRunning
        case .runningBackgroundSuspended: return .backgroundSuspended
        case .runningBackground: return .background
        case .runningForeground: return .foreground
        @unknown default: return .unknown
        }
    }

    private func reportNativeFailure() {
        // Fixed vocabulary only: never forward the issue, field values, labels,
        // hierarchy, URLs or screenshots from a startup/authentication failure.
        // Emit the phase before any query: even failed activation or a query
        // that records another XCTest issue must retain the original phase.
        marker("HH345_NATIVE_FAILURE phase=\(nativePhase.rawValue)")
        guard !reportingNativeFailure else { return }
        reportingNativeFailure = true
        defer { reportingNativeFailure = false }
        let appState = currentAppState()
        let uiQueried = appState == .foreground
        let loginVisible = uiQueried && app.buttons["Login with mobile app"].firstMatch.exists
        let qrRouteVisible = uiQueried && app.buttons["Restore with Secret Key Instead"].firstMatch.exists
        let serverFieldVisible = uiQueried && app.textFields.firstMatch.exists
        let appAlertPresent = uiQueried && app.alerts.firstMatch.exists
        let systemAlertPresent = uiQueried && springboard.alerts.firstMatch.exists
        marker("HH345_NATIVE_STATE phase=\(nativePhase.rawValue) appState=\(appState.rawValue) uiQueried=\(uiQueried) loginVisible=\(loginVisible) qrRouteVisible=\(qrRouteVisible) serverFieldVisible=\(serverFieldVisible) appAlertPresent=\(appAlertPresent) systemAlertPresent=\(systemAlertPresent)")
    }

    private func wait(_ seconds: TimeInterval = 30, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        return condition()
    }

    private func restoreFailed(_ reason: AuthFailure) -> Bool {
        reportAuthDiagnostics(.failure)
        reportQRDiagnostics()
        marker("HH345_AUTH_FAILURE reason=\(reason.rawValue)")
        app.terminate()
        restoring = false
        XCTFail("Native linking did not complete; app terminated.")
        return false
    }

    private func verifyServerBeforeAuthentication() {
        setPhase(.openServer)
        app.open(URL(string: "happyherd:///server")!)
        // The maintained server route has one single-line URL TextInput.
        // Read only this server field's value, never an account-key field.
        let serverURL = app.textFields.firstMatch
        setPhase(.serverField)
        XCTAssertTrue(serverURL.waitForExistence(timeout: 20), "Server URL field must appear before authentication.")
        XCTAssertTrue(serverURL.isHittable, "Server URL must be visibly accessible.")
        setPhase(.serverValue)
        XCTAssertTrue(serverURL.value as? String == "http://127.0.0.1:43545", "Verify the isolated API before linking.")
        setPhase(.serverCapture)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "00-native-server-before-authentication"
        attachment.lifetime = .keepAlways
        add(attachment)
        // Do not save, update, or validate the form. Return through the normal route.
        setPhase(.openRoot)
        app.open(URL(string: "happyherd:///")!)
    }

    private func postToCoordinator(_ path: String, body: [String: String]) -> Bool {
        coordinatorReply(path, body: body) != nil
    }

    private func coordinatorReply(_ path: String, body: [String: String]) -> [String: Any]? {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:43547" + path)!)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        request.httpBody = bodyData
        let acknowledged = XCTestExpectation(description: "Local coordinator acknowledged the UI checkpoint.")
        var reply: [String: Any]?
        let task = session.dataTask(with: request) { data, response, error in
            guard error == nil,
                  let response = response as? HTTPURLResponse,
                  (200..<300).contains(response.statusCode),
                  let data,
                  let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  payload["ok"] as? Bool == true else { return }
            reply = payload
            acknowledged.fulfill()
        }
        task.resume()
        return XCTWaiter.wait(for: [acknowledged], timeout: 50) == .completed ? reply : nil
    }

    private func action(_ name: String) -> [String: Any] {
        guard let reply = coordinatorReply("/action", body: ["action": name]) else {
            XCTFail("Native acceptance action must acknowledge.")
            return [:]
        }
        return reply
    }

    private func feedID(_ reply: [String: Any], _ key: String) -> String {
        guard let id = reply[key] as? String, !id.isEmpty else {
            XCTFail("Native acceptance reply must contain its nonsecret feed identity.")
            return "missing-feed-identity"
        }
        return id
    }

    private func logoutNormally() {
        setPhase(.accountLogout)
        restoring = true // Never retain account-settings content on a test failure.
        XCTAssertTrue(element("inbox-mark-all-read").exists, "Normal account switching must start on Inbox.")
        // Both callers remain on Inbox. Open its ordinary navigation drawer;
        // navigating home first would change the toggle into a home-panel fold.
        setPhase(.accountLogoutPanel)
        let panel = element("navigation-sidebar-toggle")
        XCTAssertTrue(wait(20) { panel.exists && panel.isHittable }, "Visible navigation drawer action must exist.")
        panel.tap()
        setPhase(.accountLogoutSettings)
        let settings = element("herd-panel-settings")
        XCTAssertTrue(wait(20) { settings.exists && settings.isHittable }, "Visible native Settings action must exist.")
        settings.tap()
        setPhase(.accountLogoutAccount)
        let account = element("settings-section-account")
        XCTAssertTrue(account.waitForExistence(timeout: 20) && account.isHittable, "Visible Account settings action must exist.")
        account.tap()
        setPhase(.accountLogoutScroll)
        // Item's native label combines its leading icon, title and subtitle.
        // Match both visible text parts instead of assuming the title is first.
        let logoutRows = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@ AND label CONTAINS %@", "Logout", "Sign out and clear local data"))
        var swipes = 0
        for _ in 0..<12 {
            if reportLogoutDiagnostics(swipes: swipes, rows: logoutRows) { break }
            app.swipeUp()
            swipes += 1
        }
        reportLogoutDiagnostics(swipes: swipes, rows: logoutRows)
        XCTAssertEqual(logoutRows.count, 1, "Normal Logout row must be uniquely identified.")
        let logout = logoutRows.element(boundBy: 0)
        XCTAssertTrue(logout.exists && logout.isHittable, "Normal Logout action must be visible.")
        setPhase(.accountLogoutAction)
        logout.tap()
        setPhase(.accountLogoutConfirmation)
        let confirm = app.alerts.buttons["Logout"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "Native Logout confirmation must appear.")
        setPhase(.accountLogoutConfirm)
        confirm.tap()
        setPhase(.accountLogoutLogin)
        XCTAssertTrue(app.buttons["Login with mobile app"].firstMatch.waitForExistence(timeout: 60), "Normal Logout must return to login.")
    }

    @discardableResult
    private func reportLogoutDiagnostics(swipes: Int, rows: XCUIElementQuery) -> Bool {
        // Only bounded counts and booleans leave this account-settings screen.
        // The old prefix is diagnostic-only and is never a fallback selector.
        let prefixMatches = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "Logout")).count
        let rowMatches = rows.count
        let rowHittable = rowMatches == 1 && rows.element(boundBy: 0).isHittable
        let scrollViewPresent = app.scrollViews.firstMatch.exists
        let appAlertPresent = app.alerts.firstMatch.exists
        marker("HH345_LOGOUT_DIAGNOSTICS swipes=\(min(max(swipes, 0), 12)) prefixMatches=\(min(prefixMatches, 100)) rowMatches=\(min(rowMatches, 100)) rowHittable=\(rowHittable) scrollViewPresent=\(scrollViewPresent) appAlertPresent=\(appAlertPresent)")
        return rowHittable
    }

    private func reportQRDiagnostics() {
        // Counts and booleans only. Never emit image data, decoded payloads,
        // linking URLs, error descriptions or accessibility hierarchies.
        let routeVisible = app.buttons["Restore with Secret Key Instead"].firstMatch.exists
        let errorAlertPresent = app.alerts.firstMatch.exists
        marker("HH345_QR_DIAGNOSTICS attempts=\(qrAttempts) featuresMax=\(qrFeatureCountMax) payloadPresent=\(qrPayloadPresent) linkShapeMatched=\(qrLinkShapeMatched) routeVisible=\(routeVisible) errorAlertPresent=\(errorAlertPresent) decoderSetupError=\(qrDecoderSetupError)")
    }

    private func reportAuthDiagnostics(_ phase: AuthDiagnosticPhase) {
        // Query current state each time. Never record labels, hierarchy, URLs,
        // screenshots, account material or descriptions from an auth alert.
        let qrRouteVisible = app.buttons["Restore with Secret Key Instead"].firstMatch.exists
        let loginVisible = app.buttons["Login with mobile app"].firstMatch.exists
        let bellVisible = element("herd-inbox-bell").exists
        let appAlertPresent = app.alerts.firstMatch.exists
        let systemAlertPresent = springboard.alerts.firstMatch.exists
        let appState = currentAppState().rawValue
        marker("HH345_AUTH_DIAGNOSTICS phase=\(phase.rawValue) qrRouteVisible=\(qrRouteVisible) loginVisible=\(loginVisible) bellVisible=\(bellVisible) appAlertPresent=\(appAlertPresent) systemAlertPresent=\(systemAlertPresent) notificationPromptSeen=\(notificationPromptSeen) notificationPromptDeclined=\(notificationPromptDeclined) appState=\(appState)")
    }

    private func declineOwnedNotificationPrompt() {
        // A fresh native login can trigger the normal push-permission prompt.
        // Match this app's notification title AND both permission choices;
        // never dismiss generic authentication errors or unrelated system UI.
        let title = NSPredicate(format: "label CONTAINS %@ AND label CONTAINS[c] %@",
                                "HappyHerd", "Would Like to Send You Notifications")
        for owner in [app, springboard] {
            for alert in owner.alerts.allElementsBoundByIndex {
                guard title.evaluate(with: ["label": alert.label])
                        || alert.staticTexts.matching(title).firstMatch.exists else { continue }
                guard alert.buttons["Allow"].firstMatch.exists,
                      let decline = ["Don’t Allow", "Don't Allow"].map({ alert.buttons[$0].firstMatch })
                        .first(where: { $0.exists }) else { continue }
                notificationPromptSeen = true
                guard decline.isHittable else { continue }
                decline.tap()
                notificationPromptDeclined = true
                reportAuthDiagnostics(.notificationDeclined)
                return
            }
        }
    }

    private func publicLinkFromVisibleQR() -> String? {
        // Decode only the app's visible public-key QR. The PNG and URL remain
        // in memory: no screenshot attachment, image file, hierarchy or URL log.
        return autoreleasepool {
            qrAttempts += 1
            let png = app.screenshot().pngRepresentation
            guard let image = CIImage(data: png), let detector = qrDetector else {
                qrDecoderSetupError = true
                return nil
            }
            let features = detector.features(in: image).compactMap { $0 as? CIQRCodeFeature }
            qrFeatureCountMax = max(qrFeatureCountMax, features.count)
            let payloads = features.compactMap(\.messageString)
            qrPayloadPresent = qrPayloadPresent || !payloads.isEmpty
            let link = payloads.first {
                $0.range(of: "^happyherd:///account\\?[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
            }
            qrLinkShapeMatched = qrLinkShapeMatched || link != nil
            return link
        }
    }

    private func authenticateIfNeeded() -> Bool {
        setPhase(.auth)
        if element("herd-inbox-bell").waitForExistence(timeout: 8) { return true }
        restoring = true
        setPhase(.authLogin)
        let link = app.buttons["Login with mobile app"].firstMatch
        guard link.waitForExistence(timeout: 20) else { return restoreFailed(.loginControlMissing) }
        link.tap()
        setPhase(.authQR)
        var publicLink: String?
        guard wait(30, until: {
            publicLink = publicLinkFromVisibleQR()
            return publicLink != nil
        }), let publicLink else { return restoreFailed(.qrUnavailable) }
        reportQRDiagnostics()
        // The coordinator acts as the real authenticated companion. It approves
        // this public request through /v1/auth/account/response; the app's normal
        // /restore polling consumes the encrypted response and performs login.
        setPhase(.authApproval)
        guard postToCoordinator("/native-link", body: ["url": publicLink]) else { return restoreFailed(.approvalUnacknowledged) }
        var reportedApproval = false
        setPhase(.authBell)
        guard wait(60, until: {
            declineOwnedNotificationPrompt()
            if !reportedApproval {
                reportAuthDiagnostics(.afterApproval)
                reportedApproval = true
            }
            return element("herd-inbox-bell").exists
        }) else { return restoreFailed(.bellUnavailable) }
        reportAuthDiagnostics(.bellReady)
        restoring = false
        return true
    }

    private func openInbox() {
        setPhase(.inboxBell)
        let bell = element("herd-inbox-bell")
        XCTAssertTrue(bell.waitForExistence(timeout: 30), "Authenticated Inbox bell must exist.")
        bell.tap()
        setPhase(.inboxPopover)
        XCTAssertTrue(element("herd-inbox-popover").waitForExistence(timeout: 10), "Inbox popover must open.")
        let openPage = element("herd-inbox-open-page")
        setPhase(.inboxOpenPage)
        XCTAssertTrue(openPage.waitForExistence(timeout: 10), "Inbox page action must exist.")
        openPage.tap()
        setPhase(.inboxReady)
        XCTAssertTrue(element("inbox-mark-all-read").waitForExistence(timeout: 15), "Inbox title Done action must exist.")
    }

    private func captureInbox(_ name: String, checkpoint: Bool = true) {
        XCTAssertFalse(restoring, "Screenshots are allowed only after authentication.")
        XCTAssertTrue(element("inbox-mark-all-read").exists, "Only capture the Inbox page.")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if checkpoint {
            XCTAssertTrue(postToCoordinator("/checkpoint", body: ["stage": name]), "Persisted feed state must match the native UI checkpoint.")
        }
    }

    private func marker(_ value: String) {
        // FileHandle writes immediately; these static markers coordinate real API/UI actions.
        FileHandle.standardOutput.write(Data((value + "\n").utf8))
    }

    func testNativeInboxReadJourney() {
        setPhase(.setup)
        let environment = ProcessInfo.processInfo.environment
        guard let firstID = environment["HH345_FIRST_ID"], !firstID.isEmpty,
              let secondID = environment["HH345_SECOND_ID"], !secondID.isEmpty,
              firstID != secondID else {
            XCTFail("Provide the two distinct, nonsecret real feed IDs to the test runner.")
            return
        }
        setPhase(.activate)
        app.activate()
        setPhase(.startupWait)
        let startupLogin = app.buttons["Login with mobile app"].firstMatch
        XCTAssertTrue(wait(60) { startupLogin.exists && startupLogin.isHittable }, "Unauthenticated login control must become ready before the server route.")
        setPhase(.startupReady)
        verifyServerBeforeAuthentication()
        guard authenticateIfNeeded() else { return }
        openInbox()
        captureInbox("00a-native-inbox-before-assertions", checkpoint: false)
        let firstDot = element("feed-unread-" + firstID)
        let secondDot = element("feed-unread-" + secondID)
        let bellDot = element("herd-inbox-dot")
        setPhase(.inboxUnread)
        XCTAssertTrue(wait { firstDot.exists && secondDot.exists && bellDot.exists }, "Both initial updates and the bell must be unread.")
        captureInbox("01-native-inbox-unread")

        let firstCard = element("feed-card-" + firstID)
        setPhase(.singleRead)
        XCTAssertTrue(firstCard.exists, "First automation update card must exist.")
        firstCard.tap()
        setPhase(.singleReadNavigation)
        XCTAssertTrue(app.staticTexts["Automations"].firstMatch.waitForExistence(timeout: 20), "Reading the automation update must retain navigation.")
        // Automations is a phone top-level destination and intentionally has no
        // Back button. Return through the same visible bell and Inbox action.
        openInbox()
        setPhase(.singleReadState)
        XCTAssertTrue(wait { !firstDot.exists && secondDot.exists && bellDot.exists }, "Single read must preserve the other update's unread state.")
        captureInbox("02-native-inbox-single-read")

        setPhase(.markAllRead)
        element("inbox-mark-all-read").tap()
        setPhase(.allReadState)
        XCTAssertTrue(wait { !firstDot.exists && !secondDot.exists && !bellDot.exists }, "Done must clear both updates and the feed bell.")
        captureInbox("03-native-inbox-done")
        setPhase(.relaunch)
        app.terminate()
        app.launch()
        setPhase(.relaunchBell)
        XCTAssertTrue(element("herd-inbox-bell").waitForExistence(timeout: 60), "Authentication must survive relaunch.")
        openInbox()
        setPhase(.persistedReadState)
        XCTAssertTrue(wait {
            element("feed-card-" + firstID).exists && element("feed-card-" + secondID).exists
                && !firstDot.exists && !secondDot.exists && !bellDot.exists
        }, "Persisted cards must reload without unread dots.")
        captureInbox("04-native-inbox-after-relaunch")

        let unreadDots = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "feed-unread-"))
        setPhase(.newArrival)
        marker("HH345_READY_FOR_NEW_ARRIVAL")
        XCTAssertTrue(wait(180) { unreadDots.count > 0 && bellDot.exists }, "A real incoming update must show a dot and bell.")
        XCTAssertFalse(firstDot.exists)
        XCTAssertFalse(secondDot.exists)
        captureInbox("05-native-inbox-new-arrival")
        setPhase(.remoteDone)
        marker("HH345_READY_FOR_REMOTE_DONE")
        XCTAssertTrue(wait(180) { unreadDots.count == 0 && !bellDot.exists }, "Desktop Done must clear the native update over the real connection.")
        captureInbox("06-native-inbox-remote-done")
        // Account scope is proved on this installed app through ordinary
        // logout and fresh QR linking, with no key typing or state injection.
        setPhase(.accountScope)
        marker("HH345_NATIVE_ACCOUNT_SCOPE")
        let scope = action("prepare-scope")
        let scopeAID = feedID(scope, "first")
        let scopeBID = feedID(scope, "other")
        let scopeADot = element("feed-unread-" + scopeAID)
        let scopeBDot = element("feed-unread-" + scopeBID)
        XCTAssertTrue(wait { scopeADot.exists && bellDot.exists && !element("feed-card-" + scopeBID).exists }, "Native A must receive only its own unread update.")
        captureInbox("07-native-account-a-unread")
        element("inbox-mark-all-read").tap()
        XCTAssertTrue(wait { unreadDots.count == 0 && !bellDot.exists }, "Native A Done must clear only A.")
        captureInbox("08-native-account-a-done")
        let protectedID = feedID(action("select-b"), "protected")
        logoutNormally()
        setPhase(.accountB)
        guard authenticateIfNeeded() else { return }
        openInbox()
        XCTAssertTrue(wait { scopeBDot.exists && bellDot.exists && !element("feed-card-" + scopeAID).exists && !element("feed-card-" + protectedID).exists }, "Native B must not retain A cards after normal account switching.")
        captureInbox("09-native-account-b-unread")
        element("inbox-mark-all-read").tap()
        XCTAssertTrue(wait { !scopeBDot.exists && unreadDots.count == 0 && !bellDot.exists }, "Native B Done must clear only B.")
        captureInbox("10-native-account-b-done")
        _ = action("select-a")
        logoutNormally()
        setPhase(.accountA)
        guard authenticateIfNeeded() else { return }
        openInbox()
        let protectedDot = element("feed-unread-" + protectedID)
        XCTAssertTrue(wait { protectedDot.exists && bellDot.exists && !element("feed-card-" + scopeBID).exists }, "A's unread update must survive B Done and normal account restoration.")
        captureInbox("11-native-account-a-restored")

        setPhase(.doneRace)
        marker("HH345_NATIVE_DONE_RACE")
        _ = action("arm-race")
        let doneButton = element("inbox-mark-all-read")
        doneButton.tap()
        setPhase(.racePending)
        XCTAssertTrue(wait { !doneButton.isEnabled }, "Native Done must remain disabled while its real request is pending.")
        let raceID = feedID(action("race-pending"), "incoming")
        let raceDot = element("feed-unread-" + raceID)
        XCTAssertTrue(wait { !doneButton.isEnabled && protectedDot.exists && raceDot.exists && bellDot.exists }, "The new native update must arrive while its earlier Done request is still pending.")
        _ = action("release-race")
        XCTAssertTrue(wait { doneButton.isEnabled && !protectedDot.exists && raceDot.exists && bellDot.exists && unreadDots.count == 1 }, "Native Done must preserve the update arriving after its sent snapshot.")
        captureInbox("12-native-race-new-arrival")

        setPhase(.serverRestart)
        marker("HH345_NATIVE_SERVER_RESTART")
        _ = action("restart")
        XCTAssertTrue(wait { raceDot.exists && !protectedDot.exists && bellDot.exists }, "The foreground native Inbox must retain durable read state across server restart.")
        captureInbox("13-native-after-server-restart")
        setPhase(.reconnectedArrival)
        let restartID = feedID(action("publish-after-restart"), "incoming")
        let restartDot = element("feed-unread-" + restartID)
        XCTAssertTrue(wait(180) { restartDot.exists && raceDot.exists && bellDot.exists && unreadDots.count == 2 }, "The foreground native client must receive a real update after server reconnect.")
        captureInbox("14-native-reconnected-new-arrival")
        _ = action("resume-web")
        setPhase(.reconnectedDone)
        doneButton.tap()
        XCTAssertTrue(wait { unreadDots.count == 0 && !bellDot.exists }, "Native Done after reconnect must persist both reads.")
        captureInbox("15-native-reconnected-done")
        setPhase(.finalRelaunch)
        app.terminate()
        app.launch()
        XCTAssertTrue(element("herd-inbox-bell").waitForExistence(timeout: 60), "Authentication must survive final relaunch after server restart.")
        openInbox()
        XCTAssertTrue(wait {
            element("feed-card-" + raceID).exists && element("feed-card-" + restartID).exists
                && unreadDots.count == 0 && !bellDot.exists && !element("feed-card-" + scopeBID).exists
        }, "Final reload must retain the correct account and all durable read timestamps.")
        captureInbox("16-native-final-relaunch")
        setPhase(.complete)
    }
}
