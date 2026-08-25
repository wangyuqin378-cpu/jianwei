import XCTest

final class JianweiAppStoreScreenshotTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCaptureStorefrontScreens() throws {
        let onboarding = XCUIApplication()
        onboarding.launchArguments = [
            "-JianweiResetOnboarding",
            "-JianweiOnboardingPage", "2",
            "-JianweiStorefrontPreview"
        ]
        onboarding.launch()

        XCTAssertTrue(onboarding.staticTexts["选择你的开始方式"].waitForExistence(timeout: 12))
        XCTAssertTrue(onboarding.buttons["订阅见微 Pro · ¥8.00/月"].waitForExistence(timeout: 4))
        capture(onboarding, name: "app-store-01-daily-three-to-one")
        onboarding.terminate()

        let app = XCUIApplication()
        app.launchArguments = ["-JianweiSeedDemo", "-JianweiStorefrontPreview"]
        app.launch()

        XCTAssertTrue(app.staticTexts["扫帚为什么总有一点斜？"].waitForExistence(timeout: 12))
        capture(app, name: "app-store-02-daily-knowledge-card")

        app.tabBars.buttons["设置"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 4))
        for _ in 0..<2 where !app.buttons["订阅见微 Pro · ¥8.00/月"].exists {
            app.swipeUp()
        }
        XCTAssertTrue(app.buttons["订阅见微 Pro · ¥8.00/月"].waitForExistence(timeout: 4))
        capture(app, name: "app-store-03-pro-or-own-key")
    }

    @MainActor
    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
