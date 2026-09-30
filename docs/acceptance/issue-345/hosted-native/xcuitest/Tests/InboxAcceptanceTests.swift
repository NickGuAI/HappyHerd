import Foundation
import CoreImage
import XCTest

final class InboxAcceptanceTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.happyherd.issue345.acceptance")
    private var restoring = false
    private lazy var qrDetector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                                             options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
    private var qrAttempts = 0
    private var qrFeatureCountMax = 0
    private var qrPayloadPresent = false
    private var qrLinkShapeMatched = false
    private var qrRouteVisible = false
    private var qrErrorAlertPresent = false
    private var qrDecoderSetupError = false

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    override func record(_ issue: XCTIssue) {
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

    private func wait(_ seconds: TimeInterval = 30, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        return condition()
    }

    private func restoreFailed() -> Bool {
        reportQRDiagnostics()
        app.terminate()
        restoring = false
        XCTFail("Native linking did not complete; app terminated.")
        return false
    }

    private func verifyServerBeforeAuthentication() {
        app.open(URL(string: "happyherd:///server")!)
        // The maintained server route has one single-line URL TextInput.
        // This is the only text value read by the test; no account key is read.
        let serverURL = app.textFields.firstMatch
        XCTAssertTrue(serverURL.waitForExistence(timeout: 20), "Server URL field must appear before authentication.")
        XCTAssertTrue(serverURL.isHittable, "Server URL must be visibly accessible.")
        XCTAssertEqual(serverURL.value as? String, "http://127.0.0.1:43545", "Verify the isolated API before linking.")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "00-native-server-before-authentication"
        attachment.lifetime = .keepAlways
        add(attachment)
        // Do not save, update, or validate the form. Return through the normal route.
        app.open(URL(string: "happyherd:///")!)
    }

    private func postToCoordinator(_ path: String, body: [String: String]) -> Bool {
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
        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else { return false }
        request.httpBody = bodyData
        let acknowledged = XCTestExpectation(description: "Local coordinator acknowledged the UI checkpoint.")
        let task = session.dataTask(with: request) { data, response, error in
            guard error == nil,
                  let response = response as? HTTPURLResponse,
                  (200..<300).contains(response.statusCode),
                  let data,
                  let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  payload["ok"] as? Bool == true else { return }
            acknowledged.fulfill()
        }
        task.resume()
        return XCTWaiter.wait(for: [acknowledged], timeout: 50) == .completed
    }

    private func reportQRDiagnostics() {
        // Counts and booleans only. Never emit image data, decoded payloads,
        // linking URLs, error descriptions or accessibility hierarchies.
        marker("HH345_QR_DIAGNOSTICS attempts=\(qrAttempts) featuresMax=\(qrFeatureCountMax) payloadPresent=\(qrPayloadPresent) linkShapeMatched=\(qrLinkShapeMatched) routeVisible=\(qrRouteVisible) errorAlertPresent=\(qrErrorAlertPresent) decoderSetupError=\(qrDecoderSetupError)")
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
        if element("herd-inbox-bell").waitForExistence(timeout: 8) { return true }
        restoring = true
        let link = app.buttons["Login with mobile app"].firstMatch
        guard link.waitForExistence(timeout: 20) else { return restoreFailed() }
        link.tap()
        qrRouteVisible = app.buttons["Restore with Secret Key Instead"].firstMatch.exists
        qrErrorAlertPresent = app.alerts.firstMatch.exists
        var publicLink: String?
        guard wait(30, until: {
            publicLink = publicLinkFromVisibleQR()
            return publicLink != nil
        }), let publicLink else { return restoreFailed() }
        reportQRDiagnostics()
        // The coordinator acts as the real authenticated companion. It approves
        // this public request through /v1/auth/account/response; the app's normal
        // /restore polling consumes the encrypted response and performs login.
        guard postToCoordinator("/native-link", body: ["url": publicLink]) else { return restoreFailed() }
        guard element("herd-inbox-bell").waitForExistence(timeout: 60) else { return restoreFailed() }
        restoring = false
        return true
    }

    private func openInbox() {
        let bell = element("herd-inbox-bell")
        XCTAssertTrue(bell.waitForExistence(timeout: 30), "Authenticated Inbox bell must exist.")
        bell.tap()
        XCTAssertTrue(element("herd-inbox-popover").waitForExistence(timeout: 10), "Inbox popover must open.")
        let openPage = element("herd-inbox-open-page")
        XCTAssertTrue(openPage.waitForExistence(timeout: 10), "Inbox page action must exist.")
        openPage.tap()
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
        let environment = ProcessInfo.processInfo.environment
        guard let firstID = environment["HH345_FIRST_ID"], !firstID.isEmpty,
              let secondID = environment["HH345_SECOND_ID"], !secondID.isEmpty,
              firstID != secondID else {
            XCTFail("Provide the two distinct, nonsecret real feed IDs to the test runner.")
            return
        }
        app.activate()
        verifyServerBeforeAuthentication()
        guard authenticateIfNeeded() else { return }
        openInbox()
        captureInbox("00a-native-inbox-before-assertions", checkpoint: false)
        let firstDot = element("feed-unread-" + firstID)
        let secondDot = element("feed-unread-" + secondID)
        let bellDot = element("herd-inbox-dot")
        XCTAssertTrue(wait { firstDot.exists && secondDot.exists && bellDot.exists }, "Both initial updates and the bell must be unread.")
        captureInbox("01-native-inbox-unread")

        let firstCard = element("feed-card-" + firstID)
        XCTAssertTrue(firstCard.exists, "First automation update card must exist.")
        firstCard.tap()
        XCTAssertTrue(app.staticTexts["Automations"].firstMatch.waitForExistence(timeout: 20), "Reading the automation update must retain navigation.")
        // Automations is a phone top-level destination and intentionally has no
        // Back button. Return through the same visible bell and Inbox action.
        openInbox()
        XCTAssertTrue(wait { !firstDot.exists && secondDot.exists && bellDot.exists }, "Single read must preserve the other update's unread state.")
        captureInbox("02-native-inbox-single-read")

        element("inbox-mark-all-read").tap()
        XCTAssertTrue(wait { !firstDot.exists && !secondDot.exists && !bellDot.exists }, "Done must clear both updates and the feed bell.")
        captureInbox("03-native-inbox-done")
        app.terminate()
        app.launch()
        XCTAssertTrue(element("herd-inbox-bell").waitForExistence(timeout: 60), "Authentication must survive relaunch.")
        openInbox()
        XCTAssertTrue(wait {
            element("feed-card-" + firstID).exists && element("feed-card-" + secondID).exists
                && !firstDot.exists && !secondDot.exists && !bellDot.exists
        }, "Persisted cards must reload without unread dots.")
        captureInbox("04-native-inbox-after-relaunch")

        let unreadDots = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "feed-unread-"))
        marker("HH345_READY_FOR_NEW_ARRIVAL")
        XCTAssertTrue(wait(180) { unreadDots.count > 0 && bellDot.exists }, "A real incoming update must show a dot and bell.")
        XCTAssertFalse(firstDot.exists)
        XCTAssertFalse(secondDot.exists)
        captureInbox("05-native-inbox-new-arrival")
        marker("HH345_READY_FOR_REMOTE_DONE")
        XCTAssertTrue(wait(180) { unreadDots.count == 0 && !bellDot.exists }, "Desktop Done must clear the native update over the real connection.")
        captureInbox("06-native-inbox-remote-done")
    }
}
