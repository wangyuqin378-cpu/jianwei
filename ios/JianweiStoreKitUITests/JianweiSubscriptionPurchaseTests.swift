import XCTest

final class JianweiSubscriptionPurchaseTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testMonthlySubscriptionPurchaseAndEntitlement() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiSeedDemo"]
        app.launch()

        XCTAssertTrue(app.staticTexts["扫帚为什么总有一点斜？"].waitForExistence(timeout: 12))
        app.tabBars.buttons["设置"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5))

        let purchase = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "订阅见微 Pro")
        ).firstMatch
        for _ in 0..<3 where !purchase.exists { app.swipeUp() }
        XCTAssertTrue(
            purchase.waitForExistence(timeout: 8),
            "本地 StoreKit 套餐没有加载：\(app.debugDescription)"
        )
        let purchasable = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true"),
            object: purchase
        )
        XCTAssertEqual(
            XCTWaiter().wait(for: [purchasable], timeout: 45),
            .completed,
            "本地 StoreKit 套餐已显示但尚不可购买：\(app.debugDescription)"
        )
        purchase.tap()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let confirmationLabels = ["订阅", "Subscribe"]
        let confirmation = app.buttons.matching(
            NSPredicate(format: "label IN %@", confirmationLabels)
        ).firstMatch
        if confirmation.waitForExistence(timeout: 8), confirmation.isHittable {
            confirmation.tap()
        } else {
            let systemConfirmation = springboard.buttons.matching(
                NSPredicate(format: "label IN %@", confirmationLabels)
            ).firstMatch
            if systemConfirmation.waitForExistence(timeout: 3), systemConfirmation.isHittable {
                systemConfirmation.tap()
            } else {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)).tap()
            }
        }

        let completion = springboard.buttons.matching(
            NSPredicate(format: "label IN %@", ["OK", "好", "确定"])
        ).firstMatch
        if completion.waitForExistence(timeout: 12), completion.isHittable {
            completion.tap()
        } else {
            let successMessage = springboard.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "purchase was successful")
            ).firstMatch
            XCTAssertTrue(
                successMessage.exists,
                "系统没有显示购买成功确认：\(springboard.debugDescription)"
            )
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.60)).tap()
        }
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 8))

        let subscribed = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "已订阅")
        ).firstMatch
        XCTAssertTrue(
            subscribed.waitForExistence(timeout: 15),
            "确认购买后没有得到有效订阅：\(app.debugDescription)"
        )
        XCTAssertTrue(app.buttons["使用见微托管服务"].exists)
        capture(name: "storekit-purchased")
    }

    @MainActor
    private func capture(name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
