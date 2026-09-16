import XCTest

final class JianweiAuthorizedPhotoJourneyTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testAuthorizedPhotoBecomesARealKnowledgeWidget() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiAuthorizedFixtureE2E", "-JianweiResetOnboarding"]
        app.launch()

        if app.buttons["继续"].waitForExistence(timeout: 8) {
            app.buttons["继续"].tap()
            XCTAssertTrue(app.buttons["继续"].waitForExistence(timeout: 5))
            app.buttons["继续"].tap()
            XCTAssertTrue(
                app.buttons["授权并开始自动发现"].waitForExistence(timeout: 5),
                "The automatic start action is not accessible. \(app.debugDescription)"
            )
            app.buttons["授权并开始自动发现"].tap()
            allowPhotoAccessIfRequested(in: app)

            XCTAssertTrue(
                app.staticTexts
                    .matching(NSPredicate(format: "label CONTAINS %@", "自动"))
                    .firstMatch
                    .waitForExistence(timeout: 8),
                "Authorized access did not start automatic preparation. \(app.debugDescription)"
            )
        }
        XCTAssertTrue(
            app.staticTexts["已核验来源"].waitForExistence(timeout: 70),
            "The authorized photo did not complete the Qwen card journey. \(app.debugDescription)"
        )
        let sourcePublisher = app.staticTexts
            .matching(NSPredicate(format: "label CONTAINS %@", "Google Patents"))
            .firstMatch
        XCTAssertTrue(sourcePublisher.exists)
        let objectName = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "扫帚"))
            .firstMatch
        XCTAssertTrue(objectName.exists)
        XCTAssertTrue(
            app.staticTexts["扫帚"].exists,
            "The imported photo should produce a visible, identified card. \(app.debugDescription)"
        )

        let appAttachment = XCTAttachment(screenshot: app.screenshot())
        appAttachment.name = "authorized-photo-qwen-card"
        appAttachment.lifetime = .keepAlways
        add(appAttachment)

        addSmallWidgetAndAssertBroomCard(app: app)
    }

    /// Read-only smoke test for an already-configured physical device. Unlike
    /// the fixture journey, this must never reset onboarding or local history.
    @MainActor
    func testExistingDeviceStateSurvivesOverwriteInstallAndRemainsBrowsable() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(
            app.staticTexts["已核验来源"].waitForExistence(timeout: 20),
            "The latest valid card was not retained after the overwrite install. \(app.debugDescription)"
        )
        XCTAssertFalse(app.staticTexts["当前真机构建没有配置 AI 服务地址，请重新安装正确的体验包。"].exists)
        XCTAssertFalse(app.buttons["选择照片"].exists)

        let reviewTab = app.tabBars.buttons["回顾"]
        XCTAssertTrue(reviewTab.waitForExistence(timeout: 5))
        reviewTab.tap()

        XCTAssertTrue(app.navigationBars["回顾"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts["还没有出现过的卡片"].exists)
        XCTAssertTrue(
            app.staticTexts["当前"].waitForExistence(timeout: 8),
            "The retained current card was not visible in Review. \(app.debugDescription)"
        )
    }

    @MainActor
    private func allowPhotoAccessIfRequested(in app: XCUIApplication) {
        let allow = firstButton(
            in: app,
            labels: ["Allow Full Access", "允许完全访问", "Allow Access to All Photos", "允许访问所有照片"]
        )
        if allow.waitForExistence(timeout: 5) { allow.tap() }
    }

    @MainActor
    private func addSmallWidgetAndAssertBroomCard(app: XCUIApplication) {
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))

        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.52, dy: 0.46))
            .press(forDuration: 1.8)
        let edit = firstButton(
            in: springboard,
            labels: ["Edit", "编辑", "Edit Home Screen", "编辑主屏幕", "编辑主画面"]
        )
        if edit.waitForExistence(timeout: 2) { edit.tap() }

        let addButton = firstButton(in: springboard, labels: ["Add", "添加", "Add Widget", "添加小组件"])
        XCTAssertTrue(addButton.waitForExistence(timeout: 5))
        addButton.tap()

        let search = springboard.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 6))
        search.tap()
        search.typeText("见微")
        let result = springboard.staticTexts["见微"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 6))
        result.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        let addWidget = firstButton(in: springboard, labels: ["Add Widget", "添加小组件", "加入小工具"])
        if addWidget.waitForExistence(timeout: 2) {
            addWidget.tap()
        } else {
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.91)).tap()
        }
        let done = firstButton(in: springboard, labels: ["Done", "完成"])
        if done.waitForExistence(timeout: 3) { done.tap() }

        let broom = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "扫帚"))
            .firstMatch
        XCTAssertTrue(
            broom.waitForExistence(timeout: 10),
            "The real Qwen card was not shared into WidgetKit. \(springboard.debugDescription)"
        )

        let widgetAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        widgetAttachment.name = "authorized-photo-widget-small"
        widgetAttachment.lifetime = .keepAlways
        add(widgetAttachment)

        addMediumWidgetAndAssertRealCard(app: app, springboard: springboard)
    }

    @MainActor
    private func addMediumWidgetAndAssertRealCard(
        app: XCUIApplication,
        springboard: XCUIApplication
    ) {
        let emptyArea = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.52, dy: 0.46))
        emptyArea.press(forDuration: 1.8)
        let edit = firstButton(
            in: springboard,
            labels: ["Edit", "编辑", "Edit Home Screen", "编辑主屏幕", "编辑主画面"]
        )
        if edit.waitForExistence(timeout: 2) { edit.tap() }

        let addButton = firstButton(
            in: springboard,
            labels: ["Add", "添加", "Add Widget", "添加小组件"]
        )
        XCTAssertTrue(addButton.waitForExistence(timeout: 5))
        addButton.tap()

        let search = springboard.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 6))
        search.tap()
        search.typeText("见微")
        let result = springboard.staticTexts["见微"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 6))
        result.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        let previewStart = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.78, dy: 0.52))
        let previewEnd = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.22, dy: 0.52))
        previewStart.press(forDuration: 0.1, thenDragTo: previewEnd)
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.91)).tap()

        let done = firstButton(in: springboard, labels: ["Done", "完成"])
        if done.waitForExistence(timeout: 3) { done.tap() }

        let publisher = springboard.staticTexts["Google Patents"]
        XCTAssertTrue(
            publisher.waitForExistence(timeout: 10),
            "The medium widget did not render the real card source. \(springboard.debugDescription)"
        )
        XCTAssertTrue(springboard.buttons["还没有下一张卡"].waitForExistence(timeout: 5))

        let mediumAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        mediumAttachment.name = "authorized-photo-widget-medium"
        mediumAttachment.lifetime = .keepAlways
        add(mediumAttachment)

        let detailLink = springboard.descendants(matching: .any)["打开扫帚知识卡详情"].firstMatch
        XCTAssertTrue(
            detailLink.waitForExistence(timeout: 5),
            "The real medium widget did not expose a card detail link. \(springboard.debugDescription)"
        )
        detailLink.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 8))
        XCTAssertTrue(
            app.buttons["完成"].waitForExistence(timeout: 8),
            "The real medium widget did not deep-link back to its card. \(app.debugDescription)"
        )
        XCTAssertTrue(app.staticTexts["已核验来源"].exists)

        let detailAttachment = XCTAttachment(screenshot: app.screenshot())
        detailAttachment.name = "authorized-photo-medium-widget-card-detail"
        detailAttachment.lifetime = .keepAlways
        add(detailAttachment)
    }

    @MainActor
    private func firstButton(in app: XCUIApplication, labels: [String]) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label IN %@", labels)).firstMatch
    }
}
