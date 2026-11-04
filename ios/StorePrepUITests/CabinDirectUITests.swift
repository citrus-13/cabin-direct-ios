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

        XCTAssertTrue(element("connect.headline", in: app).waitForExistence(timeout: 5))
        attach("connect-light", from: app)

        tapTab("tab.share", label: "共享", in: app)
        XCTAssertTrue(app.switches["setting.visible-text"].waitForExistence(timeout: 5))
        attach("share-light", from: app)

        tapTab("tab.help", label: "帮助", in: app)
        tap("help.privacy", in: app)
        XCTAssertTrue(element("privacy.heading", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(element("privacy.heading", in: app).label.contains("草稿"))
        attach("privacy-light", from: app)

        back(in: app)
        tap("help.support", in: app)
        XCTAssertTrue(element("about.heading", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(element("about.version", in: app).label.contains("0.4.0"))
        attach("support-light", from: app)
    }

    @MainActor
    func testVisibleTextRegionControls() {
        let originalAppearance = XCUIDevice.shared.appearance
        let app = launch(appearance: .light)
        defer { app.terminate(); XCUIDevice.shared.appearance = originalAppearance }

        tapTab("tab.share", label: "共享", in: app)
        let visibleText = app.switches["setting.visible-text"]
        XCTAssertTrue(visibleText.waitForExistence(timeout: 5))
        if visibleText.value as? String != "1" { visibleText.tap() }
        let preview = element("setting.region.preview", in: app)
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

        XCTAssertTrue(element("connect.headline", in: app).waitForExistence(timeout: 5))
        tapTab("tab.share", label: "共享", in: app)
        reveal(app.switches["setting.visible-text"], identifier: "setting.visible-text", in: app)
        XCTAssertTrue(app.switches["setting.visible-text"].isHittable)

        tapTab("tab.help", label: "帮助", in: app)
        reveal(element("help.privacy", in: app), identifier: "help.privacy", in: app)
        attach("help-dark", from: app)
        tap("help.privacy", in: app)
        XCTAssertTrue(element("privacy.heading", in: app).waitForExistence(timeout: 5))
        attach("privacy-accessibility", from: app)

        back(in: app)
        tap("help.support", in: app)
        XCTAssertTrue(element("about.version", in: app).waitForExistence(timeout: 5))
        let appearance = element("about.appearance", in: app)
        reveal(appearance, identifier: "about.appearance", in: app, requiresHittable: false)
        XCTAssertEqual(appearance.value as? String, "深色",
                       "Actual SwiftUI colorScheme must be dark; \(details(appearance, identifier: "about.appearance"))")
        let textSize = element("about.text-size", in: app)
        reveal(textSize, identifier: "about.text-size", in: app, requiresHittable: false)
        XCTAssertEqual(textSize.value as? String, "辅助功能字号",
                       "Actual SwiftUI Dynamic Type must be accessibility-sized; \(details(textSize, identifier: "about.text-size"))")
        attach("support-accessibility", from: app)
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
        XCTAssertEqual(XCUIDevice.shared.appearance, appearance, "System appearance request did not take effect")
        return app
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
                       "setting.region.height", "setting.visible-text", "help.privacy", "help.support",
                       "about.appearance", "about.text-size"]
        guard allowed.contains(identifier), target.exists else { return "control=\(identifier), exists=\(target.exists)" }
        let label = String(target.label.prefix(120)), value = String(describing: target.value ?? "").prefix(120)
        return "control=\(identifier), type=\(target.elementType.rawValue), label=\(label), value=\(value), frame=\(target.frame), hittable=\(target.isHittable)"
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
