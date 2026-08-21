import XCTest

final class JianweiWidgetJourneyTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testSeededDailyCardRendersAndWidgetCanBeAdded() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiSeedDemo"]
        app.launch()

        XCTAssertTrue(app.staticTexts["扫帚为什么总有一点斜？"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["已核验来源"].exists)
        let dailyCardAttachment = XCTAttachment(screenshot: app.screenshot())
        dailyCardAttachment.name = "daily-card"
        dailyCardAttachment.lifetime = XCTAttachment.Lifetime.keepAlways
        add(dailyCardAttachment)

        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))

        let emptyArea = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.52, dy: 0.46))
        emptyArea.press(forDuration: 1.8)

        let editHome = firstButton(
            in: springboard,
            labels: ["Edit", "编辑", "Edit Home Screen", "编辑主屏幕", "编辑主画面"]
        )
        if editHome.waitForExistence(timeout: 2) {
            editHome.tap()
        }

        let addButton = firstButton(
            in: springboard,
            labels: ["Add", "添加", "Add Widget", "添加小组件"]
        )
        guard addButton.waitForExistence(timeout: 5) else {
            XCTFail("Could not enter Home Screen edit mode. \(springboard.debugDescription)")
            return
        }
        addButton.tap()

        let search = springboard.searchFields.firstMatch
        guard search.waitForExistence(timeout: 6) else {
            XCTFail("Widget gallery search did not appear. \(springboard.debugDescription)")
            return
        }
        search.tap()
        search.typeText("见微")

        let result = springboard.staticTexts["见微"].firstMatch
        guard result.waitForExistence(timeout: 6) else {
            XCTFail("Jianwei widget is not discoverable. \(springboard.debugDescription)")
            return
        }
        if result.isHittable {
            result.tap()
        } else {
            result.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }

        let addWidget = firstButton(
            in: springboard,
            labels: ["Add Widget", "添加小组件", "加入小工具"]
        )
        if addWidget.waitForExistence(timeout: 2) {
            addWidget.tap()
        } else {
            // iOS 26 renders the gallery's blue CTA without exposing it as an
            // accessibility button. Its center remains anchored to the sheet.
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.91)).tap()
        }

        let done = firstButton(in: springboard, labels: ["Done", "完成"])
        if done.waitForExistence(timeout: 3) { done.tap() }

        let cardTitle = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "扫帚为什么总有一点斜"))
            .firstMatch
        XCTAssertTrue(
            cardTitle.waitForExistence(timeout: 8),
            "Added widget did not render the cached card. \(springboard.debugDescription)"
        )
        let widgetAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        widgetAttachment.name = "home-screen-widget-small"
        widgetAttachment.lifetime = XCTAttachment.Lifetime.keepAlways
        add(widgetAttachment)

        emptyArea.press(forDuration: 1.8)
        let editHomeAgain = firstButton(
            in: springboard,
            labels: ["Edit", "编辑", "Edit Home Screen", "编辑主屏幕", "编辑主画面"]
        )
        if editHomeAgain.waitForExistence(timeout: 2) { editHomeAgain.tap() }

        let addAgain = firstButton(
            in: springboard,
            labels: ["Add", "添加", "Add Widget", "添加小组件"]
        )
        XCTAssertTrue(addAgain.waitForExistence(timeout: 5))
        addAgain.tap()

        let secondSearch = springboard.searchFields.firstMatch
        XCTAssertTrue(secondSearch.waitForExistence(timeout: 6))
        secondSearch.tap()
        secondSearch.typeText("见微")
        let secondResult = springboard.staticTexts["见微"].firstMatch
        XCTAssertTrue(secondResult.waitForExistence(timeout: 6))
        secondResult.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        let previewStart = springboard.coordinate(
            withNormalizedOffset: CGVector(dx: 0.78, dy: 0.52)
        )
        let previewEnd = springboard.coordinate(
            withNormalizedOffset: CGVector(dx: 0.22, dy: 0.52)
        )
        previewStart.press(forDuration: 0.1, thenDragTo: previewEnd)
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.91)).tap()

        let doneAgain = firstButton(in: springboard, labels: ["Done", "完成"])
        if doneAgain.waitForExistence(timeout: 3) { doneAgain.tap() }

        XCTAssertTrue(springboard.staticTexts["Google Patents"].waitForExistence(timeout: 8))
        XCTAssertTrue(
            springboard.staticTexts[
                "现代扫帚常把刷毛设计成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。"
            ].exists
        )

        let switchButton = springboard.buttons
            .matching(NSPredicate(format: "label CONTAINS %@", "换一条"))
            .firstMatch
        XCTAssertTrue(switchButton.waitForExistence(timeout: 5))
        switchButton.tap()

        let nextTitle = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "一把扫帚，也在照顾你的手腕"))
            .firstMatch
        XCTAssertTrue(nextTitle.waitForExistence(timeout: 8))

        let secondSwitch = springboard.buttons
            .matching(NSPredicate(format: "label CONTAINS %@", "换一条"))
            .firstMatch
        XCTAssertTrue(secondSwitch.waitForExistence(timeout: 5))
        secondSwitch.tap()

        let thirdTitle = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "软毛与硬毛，其实各有分工"))
            .firstMatch
        XCTAssertTrue(thirdTitle.waitForExistence(timeout: 8))
        let exhausted = springboard.buttons["今天已经不能再换"]
        XCTAssertTrue(exhausted.waitForExistence(timeout: 5))

        let mediumAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        mediumAttachment.name = "home-screen-widget-medium-after-two-switches"
        mediumAttachment.lifetime = XCTAttachment.Lifetime.keepAlways
        add(mediumAttachment)

        let detailLink = springboard.descendants(matching: .any)["打开扫帚知识卡详情"].firstMatch
        XCTAssertTrue(
            detailLink.waitForExistence(timeout: 5),
            "The medium widget did not expose a card detail link. \(springboard.debugDescription)"
        )
        detailLink.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 8))
        XCTAssertTrue(
            app.buttons["完成"].waitForExistence(timeout: 8),
            "Tapping the medium widget did not open its card detail. \(app.debugDescription)"
        )
        XCTAssertTrue(app.staticTexts["软毛与硬毛，其实各有分工"].exists)

        let returnAttachment = XCTAttachment(screenshot: app.screenshot())
        returnAttachment.name = "app-returned-from-medium-widget"
        returnAttachment.lifetime = .keepAlways
        add(returnAttachment)

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))

        emptyArea.press(forDuration: 1.8)
        let editForAppearance = firstButton(
            in: springboard,
            labels: ["Edit", "编辑", "Edit Home Screen", "编辑主屏幕", "编辑主画面"]
        )
        if editForAppearance.waitForExistence(timeout: 2) {
            editForAppearance.tap()
        }

        let customizeAppearance = firstElement(
            in: springboard,
            labels: ["Customize", "自定", "自定义", "个性化"]
        )
        XCTAssertTrue(
            customizeAppearance.waitForExistence(timeout: 5),
            "Home Screen appearance controls were not available. \(springboard.debugDescription)"
        )
        customizeAppearance.tap()

        let tintedAppearance = firstElement(
            in: springboard,
            labels: ["Tinted", "Tint", "色调", "着色", "染色", "有色"]
        )
        XCTAssertTrue(
            tintedAppearance.waitForExistence(timeout: 5),
            "Tinted Home Screen appearance was not discoverable. \(springboard.debugDescription)"
        )
        tintedAppearance.tap()
        XCTAssertTrue(
            tintedAppearance.isSelected,
            "Tinted Home Screen appearance did not become selected. \(springboard.debugDescription)"
        )

        XCTAssertTrue(
            thirdTitle.waitForExistence(timeout: 8),
            "The knowledge title disappeared in tinted appearance. \(springboard.debugDescription)"
        )
        XCTAssertTrue(springboard.staticTexts["Google Patents"].exists)
        XCTAssertTrue(springboard.descendants(matching: .any)["打开扫帚知识卡详情"].exists)

        let tintedAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        tintedAttachment.name = "home-screen-widget-medium-tinted"
        tintedAttachment.lifetime = .keepAlways
        add(tintedAttachment)
    }

    @MainActor
    private func firstButton(in app: XCUIApplication, labels: [String]) -> XCUIElement {
        let predicate = NSPredicate(format: "label IN %@", labels)
        return app.buttons.matching(predicate).firstMatch
    }

    @MainActor
    private func firstElement(in app: XCUIApplication, labels: [String]) -> XCUIElement {
        let predicate = NSPredicate(format: "label IN %@", labels)
        return app.descendants(matching: .any).matching(predicate).firstMatch
    }

}
