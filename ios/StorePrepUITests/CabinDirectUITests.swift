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
        XCTAssertEqual(version.label, "版本 0.5.2（构建 1）")
        attach("support-light", from: app)
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
        reveal(appearance, identifier: "setting.appearance", in: app, requiresHittable: false)
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
        let selected = share.exists ? share : app.tabBars.buttons["投屏"]
        XCTAssertTrue(selected.isSelected, "Projection must be the default tab")
        XCTAssertTrue(element("action.broadcast.prepare", in: app).exists)
        XCTAssertTrue(element("share.network-guidance", in: app).exists)
        XCTAssertTrue(element("share.network-guidance", in: app).label.contains("这台手机的热点"))
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
            if isVisible(target, in: app) && (!requiresHittable || target.isHittable) { return }
            let surface = scrollSurface(in: app), viewport = surface.frame.intersection(app.frame)
            let goDown: Bool
            if target.exists && !target.frame.isEmpty {
                goDown = target.frame.midY < viewport.midY
            } else {
                // Lazy cells may have no element until scrolled into view: search
                // toward the end, then back toward the beginning, with a fixed bound.
                goDown = attempt >= 8
            }
            if goDown { surface.swipeDown(velocity: .slow) }
            else { surface.swipeUp(velocity: .slow) }
        }
        XCTAssertTrue(isVisible(target, in: app) && (!requiresHittable || target.isHittable),
                      "Not reachable by bounded bidirectional scrolling; \(details(target, identifier: identifier))")
    }

    @MainActor
    private func scrollSurface(in app: XCUIApplication) -> XCUIElement {
        for query in [app.collectionViews, app.tables, app.scrollViews] {
            for candidate in query.allElementsBoundByIndex {
                if candidate.exists && candidate.isHittable && !candidate.frame.intersection(app.frame).isEmpty {
                    return candidate
                }
            }
        }
        return app
    }

    @MainActor
    private func isVisible(_ target: XCUIElement, in app: XCUIApplication) -> Bool {
        guard target.exists, !target.frame.isEmpty else { return false }
        let overlap = target.frame.intersection(scrollSurface(in: app).frame.intersection(app.frame))
        return !overlap.isEmpty && overlap.width >= min(44, target.frame.width / 2)
            && overlap.height >= min(44, target.frame.height / 2)
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
