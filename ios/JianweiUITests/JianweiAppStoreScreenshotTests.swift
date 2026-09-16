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
            "-JianweiOnboardingPage", "2"
        ]
        onboarding.launch()

        XCTAssertTrue(onboarding.staticTexts["每天替你选出一条"].waitForExistence(timeout: 12))
        // Resetting onboarding deliberately retains the user's billing choice.
        // Select this fixture's mode through the same control a user would use.
        let managed = onboarding.buttons["使用见微体验服务"]
        if managed.exists { managed.tap() }
        XCTAssertTrue(onboarding.staticTexts["自动发现"].exists)
        XCTAssertTrue(onboarding.staticTexts["现有 AI 已配置，无需填写内容或 Key"].waitForExistence(timeout: 8))
        capture(onboarding, name: "app-store-01-automatic-discovery")
        onboarding.terminate()

        let app = XCUIApplication()
        app.launchArguments = ["-JianweiSeedStoreDemo"]
        app.launch()

        XCTAssertTrue(app.staticTexts["有些彩色打印机，会在彩色打印页上留下“隐形身份证”"].waitForExistence(timeout: 12))
        capture(app, name: "app-store-02-daily-knowledge-card")

        app.tabBars.buttons["回顾"].tap()
        XCTAssertTrue(app.navigationBars["回顾"].waitForExistence(timeout: 4))
        capture(app, name: "app-store-03-history")
    }

    @MainActor
    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
