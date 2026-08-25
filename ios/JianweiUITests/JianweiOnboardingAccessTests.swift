import XCTest

final class JianweiOnboardingAccessTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testAnalysisCannotStartBeforeAIServiceIsConfigured() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiResetOnboarding", "-JianweiOnboardingPage", "2"]
        app.launch()

        let title = app.staticTexts["选择你的开始方式"]
        XCTAssertTrue(title.waitForExistence(timeout: 12))

        let startButton = app.buttons["开启自动发现"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 4))
        XCTAssertFalse(startButton.isEnabled)

        let keyField = app.secureTextFields["粘贴百炼 Qwen API Key"]
        for _ in 0..<3 where !keyField.exists {
            app.swipeUp()
        }
        XCTAssertTrue(keyField.waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["或者使用自己的 Qwen Key"].exists)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "onboarding-ai-access-required"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
