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
        reveal(preview, in: app)
        XCTAssertTrue(preview.exists, "Opt-in shows the actual native ROI controls")
        for identifier in ["setting.region.x", "setting.region.y", "setting.region.width", "setting.region.height"] {
            let slider = app.sliders[identifier]
            reveal(slider, in: app)
            XCTAssertTrue(slider.isHittable, "ROI slider must remain operable: \(identifier)")
            XCTAssertFalse((slider.value as? String ?? "").isEmpty, "Slider exposes its current percentage")
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
        reveal(app.switches["setting.visible-text"], in: app)
        XCTAssertTrue(app.switches["setting.visible-text"].isHittable)

        tapTab("tab.help", label: "帮助", in: app)
        reveal(element("help.privacy", in: app), in: app)
        attach("help-dark", from: app)
        tap("help.privacy", in: app)
        XCTAssertTrue(element("privacy.heading", in: app).waitForExistence(timeout: 5))
        attach("privacy-accessibility", from: app)

        back(in: app)
        tap("help.support", in: app)
        XCTAssertTrue(element("about.version", in: app).waitForExistence(timeout: 5))
        let appearance = element("about.appearance", in: app)
        reveal(appearance, in: app)
        XCTAssertTrue(appearance.label.contains("深色"), "Verify actual SwiftUI appearance, not a fabricated dark fixture")
        let textSize = element("about.text-size", in: app)
        reveal(textSize, in: app)
        XCTAssertTrue(textSize.label.contains("辅助功能字号"), "Verify actual Dynamic Type environment")
        attach("support-accessibility", from: app)
    }

    @MainActor
    private func launch(appearance: XCUIDevice.Appearance, accessibilityText: Bool = false) -> XCUIApplication {
        XCUIDevice.shared.appearance = appearance
        let app = XCUIApplication()
        // Standard system language/content-size preferences only; the app has no UI-test bypass.
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN",
                               "-UIPreferredContentSizeCategoryName",
                               accessibilityText ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
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
        reveal(target, in: app)
        XCTAssertTrue(target.isHittable)
        target.tap()
    }

    @MainActor
    private func reveal(_ target: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<20 {
            if target.exists && target.isHittable { return }
            if app.collectionViews.firstMatch.exists { app.collectionViews.firstMatch.swipeUp() }
            else if app.tables.firstMatch.exists { app.tables.firstMatch.swipeUp() }
            else { app.swipeUp() }
        }
        XCTAssertTrue(target.exists && target.isHittable, "Element was not reachable by ordinary scrolling")
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
