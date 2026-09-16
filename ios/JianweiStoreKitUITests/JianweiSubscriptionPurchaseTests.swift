import XCTest

final class JianweiSubscriptionPurchaseTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testManagedSubscriptionOfferAndBYOKFallbackAreVisible() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-JianweiSeedDemo",
            "-JianweiStorefrontPreview",
        ]
        app.launch()

        XCTAssertTrue(app.staticTexts["扫帚刷毛做成斜扇形，是为了更贴近墙角"].waitForExistence(timeout: 12))
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
        XCTAssertTrue(app.buttons["恢复购买"].exists)
        XCTAssertTrue(app.secureTextFields["粘贴百炼 Qwen API Key"].exists)
        XCTAssertTrue(app.buttons["保存并使用自己的 Key"].exists)
        capture(name: "managed-offer-and-byok")
    }

    @MainActor
    private func capture(name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
