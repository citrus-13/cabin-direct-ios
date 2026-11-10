import XCTest

/// Real app navigation only. No capture, demo listener, saved-session fixtures or support uploads.
/// Simulator screenshots are UI evidence, not physical-iPhone or parked-vehicle acceptance.
final class CabinDirectUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLightNavigationAndPrivacy() {
        let originalAppearance = XCUIDevice.shared.appearance
        let app = launch(appearance: .light)
        defer { app.terminate(); XCUIDevice.shared.appearance = originalAppearance }

        assertSimpleHome(in: app)
        attach("connect-light", from: app)

        tapTab("tab.settings", label: "设置", in: app)
        XCTAssertTrue(element("screen.settings", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.switches["setting.visible-text"].waitForExistence(timeout: 5))
        attach("share-light", from: app)
        assertMusicDefaults(in: app)
        assertNoDiagnostics(in: app)

        tap("help.privacy", in: app)
        XCTAssertTrue(element("privacy.heading", in: app).waitForExistence(timeout: 5))
        XCTAssertEqual(element("privacy.heading", in: app).label, "隐私说明")
        attach("privacy-light", from: app)

        back(in: app)
        tap("help.support", in: app)
        XCTAssertTrue(element("about.heading", in: app).waitForExistence(timeout: 5))
        let version = element("about.version", in: app)
        XCTAssertTrue(version.waitForExistence(timeout: 5))
        XCTAssertEqual(version.label, "版本 0.8.0（构建 1）")
        attach("support-light", from: app)
    }

    @MainActor
    func testLyricsModeDoesNotStartBroadcastOrMicrophone() {
        let app = launch(appearance: .light)
        defer { app.terminate() }
        let selector = app.segmentedControls["home.mode"]
        XCTAssertTrue(selector.waitForExistence(timeout: 5))
        selector.buttons["歌词"].tap()
        XCTAssertTrue(element("lyrics.headline", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(element("lyrics.start", in: app).exists)
        XCTAssertFalse(element("lyrics.start", in: app).isEnabled, "A VIN is required before starting")
        let guidance = element("lyrics.source-guidance", in: app)
        XCTAssertTrue(guidance.label.contains("通过蓝牙读取 Tesla"))
        XCTAssertTrue(guidance.label.contains("不使用麦克风"))
        XCTAssertTrue(guidance.label.contains("保持 Cabin 在前台"))
        XCTAssertFalse(element("action.system-broadcast-picker", in: app).exists)
        XCTAssertFalse(element("lyrics.stop", in: app).exists)
        attach("lyrics-light", from: app)

        let vin = app.textFields["tesla.vin"]
        reveal(vin, identifier: "tesla.vin", in: app)
        XCTAssertEqual(vin.value as? String, "17 位车辆 VIN", "Use only a fresh Simulator without a saved vehicle")
        vin.tap()
        vin.typeText("INVALID\n")
        let pair = element("tesla.pair", in: app)
        reveal(pair, identifier: "tesla.pair", in: app)
        XCTAssertFalse(pair.isEnabled, "Invalid VIN must not enable pairing")
        reveal(vin, identifier: "tesla.vin", in: app)
        vin.tap()
        vin.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7))
        vin.typeText("5YJ3E1EA7HF000000\n") // Synthetic input; never submit to a vehicle.
        reveal(pair, identifier: "tesla.pair", in: app)
        XCTAssertTrue(pair.isEnabled)
        tap("tesla.pair", in: app)
        let pairingAlert = app.alerts["配对 Tesla？"]
        XCTAssertTrue(pairingAlert.waitForExistence(timeout: 5))
        XCTAssertTrue(pairingAlert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Monitor 权限范围比歌曲信息更广")).firstMatch.exists)
        XCTAssertTrue(pairingAlert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "发出请求不代表配对成功")).firstMatch.exists)
        XCTAssertTrue(pairingAlert.buttons["同意并请求配对"].exists)
        attach("lyrics-pairing-consent-light", from: app)
        pairingAlert.buttons["取消"].tap()
        XCTAssertFalse(element("lyrics.stop", in: app).exists)

        // Inspect and cancel both real consent dialogs. Never confirm pairing,
        // create/read keys, request Bluetooth access, or start a lyric listener.
        tap("lyrics.start", in: app)
        let lyricsAlert = app.alerts["开始车机歌词？"]
        XCTAssertTrue(lyricsAlert.waitForExistence(timeout: 5))
        XCTAssertTrue(lyricsAlert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "曲目时长发送至 LRCLIB")).firstMatch.exists)
        XCTAssertTrue(lyricsAlert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "未加密 HTTP")).firstMatch.exists)
        lyricsAlert.buttons["取消"].tap()
        XCTAssertFalse(element("lyrics.stop", in: app).exists)
        reveal(selector, identifier: "home.mode", in: app)
        selector.buttons["投屏"].tap()
        XCTAssertTrue(element("action.broadcast.prepare", in: app).exists)

        // Editing alone must not persist the synthetic vehicle or start work.
        app.terminate()
        app.launch()
        XCTAssertTrue(selector.waitForExistence(timeout: 5))
        selector.buttons["歌词"].tap()
        reveal(vin, identifier: "tesla.vin", in: app)
        XCTAssertEqual(vin.value as? String, "17 位车辆 VIN")
        XCTAssertFalse(element("lyrics.stop", in: app).exists)
    }

    @MainActor
    func testVisibleTextRegionControls() {
        let originalAppearance = XCUIDevice.shared.appearance
        let app = launch(appearance: .light)
        defer { app.terminate(); XCUIDevice.shared.appearance = originalAppearance }

        tapTab("tab.settings", label: "设置", in: app)
        let visibleText = app.switches["setting.visible-text"]
        XCTAssertTrue(visibleText.waitForExistence(timeout: 5))
        setOn(visibleText, identifier: "setting.visible-text", in: app)
        XCTAssertEqual(switchValue(visibleText), "1",
                       "The real opt-in must be on before looking for ROI; \(details(visibleText, identifier: "setting.visible-text"))")
        tap("setting.region.open", in: app)
        XCTAssertTrue(element("screen.region", in: app).waitForExistence(timeout: 5))
        let identifiedPreview = element("setting.region.preview", in: app)
        let preview = identifiedPreview.waitForExistence(timeout: 3) ? identifiedPreview
            : app.images.matching(NSPredicate(format: "label == %@", "文字识别区域示意图，非实际屏幕预览")).firstMatch
        // This is an explanatory image, not a tappable control. Verify its visible
        // frame; reserve hit-point assertions for the genuine adjustable sliders.
        reveal(preview, identifier: "setting.region.preview", in: app, requiresHittable: false)
        XCTAssertTrue(isVisible(preview, in: app), details(preview, identifier: "setting.region.preview"))
        for identifier in ["setting.region.x", "setting.region.y", "setting.region.width", "setting.region.height"] {
            let slider = app.sliders[identifier]
            reveal(slider, identifier: identifier, in: app)
            XCTAssertTrue(slider.isHittable, "ROI slider must remain operable; \(details(slider, identifier: identifier))")
            XCTAssertFalse((slider.value as? String ?? "").isEmpty,
                           "Slider must expose its actual percentage; \(details(slider, identifier: identifier))")
        }
        attach("visible-text-controls-light", from: app)
        // Do not save, acknowledge capture, touch the system picker, or start the demo.
    }

    @MainActor
    func testDarkAndAccessibilityNavigation() {
        // This checks full navigation at accessibility XXXL, not app performance.
        // Keep a finite allowance within the runner's existing 240-second maximum;
        // the other tests retain the default and every assertion remains required.
        executionTimeAllowance = 240
        let originalAppearance = XCUIDevice.shared.appearance
        let app = launch(appearance: .dark, accessibilityText: true)
        defer { app.terminate(); XCUIDevice.shared.appearance = originalAppearance }
        print("[STORE-PREP TEST] dark-launched")

        assertSimpleHome(in: app)
        tapTab("tab.settings", label: "设置", in: app)
        assertNoDiagnostics(in: app)
        // Use the actual public, session-only appearance control. System device
        // appearance alone did not propagate into this app on the previous run.
        tap("help.support", in: app)
        print("[STORE-PREP TEST] dark-support-opened")
        XCTAssertTrue(element("about.version", in: app).waitForExistence(timeout: 5))
        selectDarkAppearance(in: app)
        print("[STORE-PREP TEST] dark-support-selected")
        let appearance = element("setting.appearance", in: app)
        // selectDarkAppearance just revealed and awaited this same control.
        // No navigation or swipe intervened; retain the actual-value assertion.
        XCTAssertEqual(appearance.value as? String, "深色",
                       "Actual SwiftUI colorScheme must be dark; \(details(appearance, identifier: "setting.appearance"))")
        let textSize = element("about.heading", in: app)
        reveal(textSize, identifier: "about.heading", in: app, requiresHittable: false)
        XCTAssertEqual(textSize.value as? String, "辅助功能字号",
                       "Actual SwiftUI Dynamic Type must be accessibility-sized; \(details(textSize, identifier: "about.heading"))")
        print("[STORE-PREP TEST] dark-environment-verified")
        attach("support-accessibility", from: app)
        print("[STORE-PREP TEST] dark-support-attached")

        back(in: app)
        reveal(element("help.privacy", in: app), identifier: "help.privacy", in: app)
        attach("help-dark", from: app)
        print("[STORE-PREP TEST] dark-help-attached")
        tap("help.privacy", in: app)
        XCTAssertTrue(element("privacy.heading", in: app).waitForExistence(timeout: 5))
        attach("privacy-accessibility", from: app)
        print("[STORE-PREP TEST] dark-privacy-attached")

        back(in: app)
        tapTab("tab.settings", label: "设置", in: app)
        reveal(app.switches["setting.visible-text"], identifier: "setting.visible-text", in: app)
        XCTAssertTrue(app.switches["setting.visible-text"].isHittable,
                      details(app.switches["setting.visible-text"], identifier: "setting.visible-text"))
        assertMusicDefaults(in: app)
        print("[STORE-PREP TEST] dark-share-controls-verified")
    }

    @MainActor
    private func assertSimpleHome(in app: XCUIApplication) {
        XCTAssertTrue(element("share.headline", in: app).waitForExistence(timeout: 5))
        XCTAssertEqual(app.tabBars.buttons.count, 2)
        let share = app.tabBars.buttons["tab.share"]
        let selected = share.exists ? share : app.tabBars.buttons["首页"]
        XCTAssertTrue(selected.isSelected, "Projection must be the default tab")
        XCTAssertTrue(element("action.broadcast.prepare", in: app).exists)
        XCTAssertTrue(element("share.network-guidance", in: app).exists)
        XCTAssertTrue(element("share.network-guidance", in: app).label.contains("这台手机的热点"))
        let fixedEntry = element("network.fixed-entry.value", in: app)
        reveal(fixedEntry, identifier: "network.fixed-entry.value", in: app, requiresHittable: false)
        XCTAssertEqual(fixedEntry.label, "https://citrus-13.github.io/cabin-direct-ios/")
        let addressStatus = element("network.address-status", in: app)
        reveal(addressStatus, identifier: "network.address-status", in: app, requiresHittable: false)
        XCTAssertEqual(addressStatus.label, "尚未开始投屏")
        let address = element("action.receiver.copy-address.value", in: app)
        if address.exists {
            reveal(address, identifier: "action.receiver.copy-address.value", in: app, requiresHittable: false)
            let url = URLComponents(string: address.label)
            XCTAssertEqual(url?.scheme, "http")
            XCTAssertEqual(url?.port, 8787)
            XCTAssertNotNil(url?.host)
            XCTAssertNil(url?.query, "Bookmark must not embed pairing credentials")
            let copy = element("action.receiver.copy-address", in: app)
            reveal(copy, identifier: "action.receiver.copy-address", in: app)
            XCTAssertTrue(copy.isHittable, "Copy control is available before capture; do not write the clipboard in this test")
            XCTAssertTrue(element("network.bookmark-guidance", in: app).exists)
        } else {
            XCTAssertTrue(element("network.address-unavailable", in: app).exists,
                          "No interface must show honest connection guidance rather than a fixture address")
        }
        XCTAssertFalse(element("action.receiver.copy-code", in: app).exists)
        XCTAssertFalse(element("action.broadcast.stop", in: app).exists)
        // The address section can scroll this lazy List row out of the AX tree
        // at accessibility sizes. Return to the actual control before querying
        // its state, and prove it is reachable without starting capture.
        let prepare = element("action.broadcast.prepare", in: app)
        reveal(prepare, identifier: "action.broadcast.prepare", in: app)
        XCTAssertTrue(prepare.isHittable, "Start must remain reachable after reading the connection address")
        XCTAssertTrue(prepare.isEnabled)
        assertNoDiagnostics(in: app)
        for phrase in ["开发验证版", "实机验收", "测试报告", "DEMO", "原创演示"] {
            XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", phrase)).firstMatch.exists,
                           "The functional home must not show verification or demo copy")
        }
    }

    @MainActor
    private func assertNoDiagnostics(in app: XCUIApplication) {
        for identifier in ["help.diagnostics", "notice.device-unverified", "action.diagnostics.copy"] {
            XCTAssertFalse(element(identifier, in: app).exists, "Removed diagnostic entry must not appear")
        }
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "诊断")).firstMatch.exists)
    }

    @MainActor
    private func assertMusicDefaults(in app: XCUIApplication) {
        // The workflow owns a fresh Simulator and these tests never save settings.
        // Inspect real controls only; do not select a mode or grant any consent.
        let mode = element("setting.music-mode", in: app)
        reveal(mode, identifier: "setting.music-mode", in: app)
        XCTAssertTrue(mode.isHittable, details(mode, identifier: "setting.music-mode"))
        XCTAssertEqual(mode.value as? String, "关闭", "Music must remain off by default")
        let lyricsConsent = app.switches["consent.network-lyrics"]
        XCTAssertTrue(!lyricsConsent.exists || !isVisible(lyricsConsent, in: app),
                      "Network lyrics consent must not be displayed while music is off")
    }

    @MainActor
    private func launch(appearance: XCUIDevice.Appearance, accessibilityText: Bool = false) -> XCUIApplication {
        XCUIDevice.shared.appearance = appearance
        let app = XCUIApplication()
        // Normal system language/appearance/content-size preferences only. The
        // app never reads these arguments or forces a test-only SwiftUI environment.
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN",
                               "-AppleInterfaceStyle", appearance == .dark ? "Dark" : "Light",
                               "-UIPreferredContentSizeCategoryName",
                               accessibilityText ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
        // System appearance is not evidence of the app's actual colorScheme;
        // the dark test verifies that separately after using its visible setting.
        return app
    }

    @MainActor
    private func selectDarkAppearance(in app: XCUIApplication) {
        let identified = app.buttons["setting.appearance.dark"]
        let dark = identified.exists ? identified : app.segmentedControls.buttons["深色"]
        reveal(dark, identifier: "setting.appearance.dark", in: app)
        XCTAssertTrue(dark.isEnabled, details(dark, identifier: "setting.appearance.dark"))
        dark.tap()
        let appearance = element("setting.appearance", in: app)
        reveal(appearance, identifier: "setting.appearance", in: app, requiresHittable: false)
        XCTAssertTrue(waitForValue("深色", on: appearance, timeout: 5),
                      "Public appearance choice must change actual colorScheme; \(details(appearance, identifier: "setting.appearance"))")
    }

    @MainActor
    private func setOn(_ control: XCUIElement, identifier: String, in app: XCUIApplication) {
        reveal(control, identifier: identifier, in: app)
        XCTAssertTrue(control.isEnabled, "Opt-in must be enabled; \(details(control, identifier: identifier))")
        if switchValue(control) == "1" { return }
        let before = details(control, identifier: identifier)
        control.tap()
        if waitForValue("1", on: control, timeout: 2) { return }
        if switchValue(control) == "1" { return } // Do not reverse a just-completed delayed toggle.
        // SwiftUI can expose a Toggle's whole labeled row as the switch frame;
        // one ordinary tap at its right-hand switch, not another label-center tap.
        XCTAssertTrue(control.isEnabled && control.isHittable,
                      "Opt-in changed availability after tap; before=\(before); after=\(details(control, identifier: identifier))")
        control.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertTrue(waitForValue("1", on: control, timeout: 3),
                      "User opt-in did not turn on; before=\(before); after=\(details(control, identifier: identifier))")
    }

    @MainActor
    private func waitForValue(_ expected: String, on target: XCUIElement, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate { object, _ in
            guard let element = object as? XCUIElement else { return false }
            return String(describing: element.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines) == expected
        }
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: target)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    @MainActor
    private func switchValue(_ control: XCUIElement) -> String {
        // Read the actual AX value consistently whether XCTest bridges NSString or NSNumber.
        String(describing: control.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @MainActor
    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    @MainActor
    private func tapTab(_ identifier: String, label: String, in app: XCUIApplication) {
        let identified = app.tabBars.buttons[identifier]
        // Tab-item accessibility propagation differs between iOS versions; the visible label is stable.
        let button = identified.exists ? identified : app.tabBars.buttons[label]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        XCTAssertTrue(button.isHittable)
        button.tap()
    }

    @MainActor
    private func tap(_ identifier: String, in app: XCUIApplication) {
        let target = element(identifier, in: app)
        reveal(target, identifier: identifier, in: app)
        XCTAssertTrue(target.isHittable, details(target, identifier: identifier))
        target.tap()
    }

    @MainActor
    private func reveal(_ target: XCUIElement, identifier: String, in app: XCUIApplication,
                        requiresHittable: Bool = true) {
        // Choose the onscreen list, not a retained offscreen tab's first list.
        // Small/slow swipes plus frame-guided reversal recover from overscroll.
        for attempt in 0..<16 {
            // AX queries are remote snapshots. Resolve the visible surface and
            // each frame once for this iteration, not again for swipe direction.
            // The next iteration refreshes everything after a swipe/navigation.
            let surface = scrollSurface(in: app)
            let targetExists = target.exists
            let targetFrame = targetExists ? target.frame : .zero
            if targetExists && isVisible(frame: targetFrame, viewport: surface.viewport) &&
                (!requiresHittable || target.isHittable) { return }
            let goDown: Bool
            if targetExists && !targetFrame.isEmpty {
                goDown = targetFrame.midY < surface.viewport.midY
            } else {
                // Lazy cells may have no element until scrolled into view: search
                // toward the end, then back toward the beginning, with a fixed bound.
                goDown = attempt >= 8
            }
            if goDown { surface.element.swipeDown(velocity: .slow) }
            else { surface.element.swipeUp(velocity: .slow) }
        }
        XCTAssertTrue(isVisible(target, in: app) && (!requiresHittable || target.isHittable),
                      "Not reachable by bounded bidirectional scrolling; \(details(target, identifier: identifier))")
    }

    @MainActor
    private func scrollSurface(in app: XCUIApplication) -> (element: XCUIElement, viewport: CGRect) {
        let appFrame = app.frame
        for query in [app.collectionViews, app.tables, app.scrollViews] {
            for candidate in query.allElementsBoundByIndex {
                if candidate.exists && candidate.isHittable {
                    let viewport = candidate.frame.intersection(appFrame)
                    if !viewport.isEmpty { return (candidate, viewport) }
                }
            }
        }
        return (app, appFrame)
    }

    @MainActor
    private func isVisible(_ target: XCUIElement, in app: XCUIApplication) -> Bool {
        guard target.exists else { return false }
        let frame = target.frame
        guard !frame.isEmpty else { return false }
        return isVisible(frame: frame, viewport: scrollSurface(in: app).viewport)
    }

    private func isVisible(frame: CGRect, viewport: CGRect) -> Bool {
        guard !frame.isEmpty else { return false }
        let overlap = frame.intersection(viewport)
        return !overlap.isEmpty && overlap.width >= min(44, frame.width / 2)
            && overlap.height >= min(44, frame.height / 2)
    }

    @MainActor
    private func details(_ target: XCUIElement, identifier: String) -> String {
        // Only known non-sensitive controls. Never dump the app tree, session
        // status, addresses, clipboard, pairing credentials or private screenshots.
        let allowed = ["setting.region.preview", "setting.region.x", "setting.region.y", "setting.region.width",
                       "setting.region.height", "setting.visible-text", "setting.region.open", "help.privacy", "help.support",
                       "setting.appearance", "about.heading", "setting.appearance.dark"]
        guard allowed.contains(identifier), target.exists else { return "control=\(identifier), exists=\(target.exists)" }
        let label = String(target.label.prefix(120)), value = String(describing: target.value ?? "").prefix(120)
        return "control=\(identifier), type=\(target.elementType.rawValue), label=\(label), value=\(value), frame=\(target.frame), enabled=\(target.isEnabled), hittable=\(target.isHittable)"
    }

    @MainActor
    private func back(in app: XCUIApplication) {
        let button = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
    }

    @MainActor
    private func attach(_ name: String, from app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
