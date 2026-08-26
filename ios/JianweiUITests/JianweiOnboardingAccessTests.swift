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
        XCTAssertTrue(title.waitForExistence(timeout: 30))

        let startButton = app.buttons["开启自动发现"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 10))
        XCTAssertFalse(startButton.isEnabled)

        let keyField = app.secureTextFields["粘贴百炼 Qwen API Key"]
        for _ in 0..<3 where !keyField.exists {
            app.swipeUp()
        }
        XCTAssertTrue(keyField.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["或者使用自己的 Qwen Key"].exists)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "onboarding-ai-access-required"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testValidQwenKeyUnlocksTheSelectedStartMode() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiResetOnboarding", "-JianweiOnboardingPage", "2"]
        app.launch()

        XCTAssertTrue(app.staticTexts["选择你的开始方式"].waitForExistence(timeout: 30))
        let keyField = app.secureTextFields["粘贴百炼 Qwen API Key"]
        for _ in 0..<3 where !keyField.exists {
            app.swipeUp()
        }
        XCTAssertTrue(keyField.waitForExistence(timeout: 10))
        keyField.tap()
        keyField.typeText("sk-beta_12345678901234567890")

        let saveButton = app.buttons["保存并使用自己的 Key"]
        XCTAssertEqual(
            XCTWaiter().wait(
                for: [XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "enabled == true"),
                    object: saveButton
                )],
                timeout: 10
            ),
            .completed
        )
        saveButton.tap()

        let configured = app.staticTexts["本机 Qwen Key 已配置"]
        XCTAssertTrue(configured.waitForExistence(timeout: 15))
        let startButton = app.buttons["开启自动发现"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 10))
        XCTAssertEqual(
            XCTWaiter().wait(
                for: [XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "enabled == true"),
                    object: startButton
                )],
                timeout: 10
            ),
            .completed
        )

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "onboarding-byok-unlocked"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
