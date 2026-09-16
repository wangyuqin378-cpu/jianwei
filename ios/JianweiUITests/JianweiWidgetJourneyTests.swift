import XCTest

final class JianweiWidgetJourneyTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testViewAllHistoryClearsPreviousSavedFilter() throws {
        try exerciseViewAllHistory(leaveDetailOpen: false)
    }

    @MainActor
    func testViewAllHistoryReturnsFromPreviousDetailToHistoryRoot() throws {
        try exerciseViewAllHistory(leaveDetailOpen: true)
    }

    @MainActor
    private func exerciseViewAllHistory(leaveDetailOpen: Bool) throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo", "-JianweiSeedModelKnowledge",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"
        ]
        app.launch()
        let firstTitle = "扫帚刷毛做成斜扇形，是为了更贴近墙角"
        let secondTitle = "斜切刷毛不只贴地更稳，也会磨得更均匀"
        XCTAssertTrue(app.staticTexts[firstTitle].waitForExistence(timeout: 8))
        let swap = app.buttons["daily-swap-card"]
        scrollIntoReadingArea(swap, in: app)
        swap.tap()
        XCTAssertTrue(app.staticTexts[secondTitle].waitForExistence(timeout: 8))
        if app.buttons["关闭提示"].isHittable { app.buttons["关闭提示"].tap() }

        app.tabBars.buttons["回顾"].tap()
        XCTAssertTrue(app.navigationBars["回顾"].waitForExistence(timeout: 5))
        if leaveDetailOpen {
            app.staticTexts[firstTitle].tap()
            XCTAssertTrue(app.navigationBars["扫帚"].waitForExistence(timeout: 5))
        } else {
            app.segmentedControls.buttons["收藏"].tap()
            XCTAssertTrue(app.staticTexts["还没有收藏"].waitForExistence(timeout: 5))
        }

        app.tabBars.buttons["今天"].tap()
        let viewAll = app.buttons["查看全部"]
        scrollIntoReadingArea(viewAll, in: app)
        viewAll.tap()
        captureReadingState(app, name: leaveDetailOpen ? "requested-all-from-detail" : "requested-all-from-saved-filter")
        XCTAssertTrue(app.navigationBars["回顾"].waitForExistence(timeout: 5),
                      "View all must open history itself, not a detail left on the tab.")
        XCTAssertTrue(app.segmentedControls.buttons["全部"].isSelected,
                      "View all must not retain the saved-only filter.")
        XCTAssertTrue(app.staticTexts[firstTitle].exists)
        XCTAssertTrue(app.staticTexts[secondTitle].exists)
        captureReadingState(app, name: leaveDetailOpen ? "view-all-from-detail" : "view-all-from-saved-filter")

        // An ordinary tab switch should still preserve the reader's filter.
        app.segmentedControls.buttons["收藏"].tap()
        app.tabBars.buttons["今天"].tap()
        app.tabBars.buttons["回顾"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["收藏"].isSelected)
        XCTAssertTrue(app.staticTexts["还没有收藏"].exists)
    }

    @MainActor
    func testModelKnowledgeReadingAndSavedHistoryAtStandardTextSize() throws {
        try exerciseModelKnowledgeReading(contentSize: "UICTContentSizeCategoryL")
    }

    @MainActor
    func testModelKnowledgeReadingAndSavedHistoryAtLargestTextSize() throws {
        try exerciseModelKnowledgeReading(contentSize: "UICTContentSizeCategoryAccessibilityXXXL")
    }

    @MainActor
    func testModelKnowledgeReadingAtLargestStandardTextSize() throws {
        try exerciseModelKnowledgeReading(contentSize: "UICTContentSizeCategoryXXXL")
    }

    @MainActor
    func testModelKnowledgeReadingAtFirstAccessibilityTextSize() throws {
        try exerciseModelKnowledgeReading(contentSize: "UICTContentSizeCategoryAccessibilityM")
    }

    @MainActor
    private func exerciseModelKnowledgeReading(contentSize: String) throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo",
            "-JianweiSeedModelKnowledge", "-UIPreferredContentSizeCategoryName", contentSize
        ]
        app.launch()
        let firstTitle = "扫帚刷毛做成斜扇形，是为了更贴近墙角"
        let secondTitle = "斜切刷毛不只贴地更稳，也会磨得更均匀"
        let evidence = "AI 生成，未联网核实"
        XCTAssertTrue(app.staticTexts[firstTitle].waitForExistence(timeout: 8))

        let like = app.buttons["有意思"]
        scrollIntoReadingArea(like, in: app)
        captureReadingState(app, name: "reading-feedback-\(contentSize)")
        like.tap()
        if app.buttons["关闭提示"].waitForExistence(timeout: 2) { app.buttons["关闭提示"].tap() }
        XCTAssertTrue(like.isSelected, "The stored feedback must also be exposed to assistive technologies.")
        scrollIntoReadingArea(app.staticTexts[evidence].firstMatch, in: app)
        XCTAssertEqual(app.links.count, 0, "Model knowledge must not invent a source link.")
        captureReadingState(app, name: "reading-evidence-\(contentSize)")

        let swap = app.buttons["daily-swap-card"]
        scrollIntoReadingArea(swap, in: app)
        swap.tap()
        XCTAssertTrue(app.staticTexts[secondTitle].waitForExistence(timeout: 8))
        app.tabBars.buttons["回顾"].tap()
        XCTAssertTrue(app.navigationBars["回顾"].waitForExistence(timeout: 5))
        captureReadingState(app, name: "reading-history-\(contentSize)")

        let previous = app.staticTexts[firstTitle]
        scrollIntoReadingArea(previous, in: app)
        previous.tap()
        XCTAssertTrue(app.navigationBars["扫帚"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["收藏"].tap()
        XCTAssertTrue(app.navigationBars.buttons["取消收藏"].waitForExistence(timeout: 5))
        if app.buttons["关闭提示"].isHittable { app.buttons["关闭提示"].tap() }
        scrollIntoReadingArea(app.staticTexts[evidence].firstMatch, in: app)
        XCTAssertEqual(app.links.count, 0)
        captureReadingState(app, name: "reading-detail-\(contentSize)")
        app.navigationBars.buttons["完成"].tap()
        app.segmentedControls.buttons["收藏"].tap()
        XCTAssertTrue(app.staticTexts[firstTitle].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts[secondTitle].exists, "Saving an old card must not save today's replacement.")
        XCTAssertTrue(app.staticTexts[evidence].exists)
        captureReadingState(app, name: "reading-saved-\(contentSize)")
        try app.performAccessibilityAudit(for: .textClipped) { issue in
            let description = XCTAttachment(string: "\(issue.detailedDescription)\n\(String(describing: issue.element))")
            description.name = "reading-clipped-text"
            description.lifetime = .keepAlways
            self.add(description)
            self.captureReadingState(app, name: "reading-audit-issue-\(contentSize)")
            return false
        }
    }

    @MainActor
    private func scrollIntoReadingArea(_ element: XCUIElement, in app: XCUIApplication) {
        let top = app.navigationBars.firstMatch.exists
            ? app.navigationBars.firstMatch.frame.maxY : app.frame.minY + 62
        let bottom = app.tabBars.firstMatch.frame.minY
        for _ in 0..<24 {
            if element.exists && element.isHittable && element.frame.minY >= top && element.frame.maxY <= bottom {
                return
            }
            let moveDown = element.exists && element.frame.minY < top
            // Bound each drag instead of flinging past the target and bouncing
            // between two positions on a several-screen Dynamic Type card.
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: moveDown ? 0.4 : 0.7))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: moveDown ? 0.7 : 0.4))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
        }
        XCTFail("Reading control cannot be fully reached: \(element)\n\(app.debugDescription)")
    }

    @MainActor
    private func captureReadingState(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility"
        tree.lifetime = .keepAlways
        add(tree)
    }

    @MainActor
    func testFeedbackControlsScrollFullyAboveFloatingTabBar() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"
        ]
        app.launch()

        XCTAssertTrue(app.staticTexts["扫帚刷毛做成斜扇形，是为了更贴近墙角"].waitForExistence(timeout: 8))

        let feedback = app.buttons["有意思"]
        XCTAssertTrue(feedback.waitForExistence(timeout: 5))
        let tabBar = app.tabBars.firstMatch
        for _ in 0..<4 where !feedback.isHittable || feedback.frame.maxY > tabBar.frame.minY {
            app.swipeUp()
        }

        XCTAssertTrue(feedback.isHittable, "Feedback controls never became tappable.")
        XCTAssertTrue(tabBar.exists)
        XCTAssertLessThanOrEqual(
            feedback.frame.maxY,
            tabBar.frame.minY,
            "The floating tab bar still covers the feedback controls."
        )

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "feedback-controls-above-tab-bar"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testSwapKeepsPreviousCardInHistoryAndWidePhotoInsideCard() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"
        ]
        app.launch()

        let firstTitle = "扫帚刷毛做成斜扇形，是为了更贴近墙角"
        let secondTitle = "斜切刷毛不只贴地更稳，也会磨得更均匀"
        XCTAssertTrue(app.staticTexts[firstTitle].waitForExistence(timeout: 8))
        assertPhotoRegionIsContained(in: app, title: firstTitle)

        let swap = app.buttons["daily-swap-card"]
        for _ in 0..<5 where !swap.isHittable { app.swipeUp() }
        XCTAssertTrue(swap.waitForExistence(timeout: 5))
        swap.tap()

        XCTAssertTrue(app.staticTexts[secondTitle].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["今天出现过"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[firstTitle].exists)
        XCTAssertTrue(app.buttons["撤销刚才的换卡"].exists)

        let closeNotice = app.buttons["关闭提示"]
        if closeNotice.isHittable { closeNotice.tap() }
        for _ in 0..<4 { app.swipeDown() }
        assertPhotoRegionIsContained(in: app, title: secondTitle)

        let dailyAttachment = XCTAttachment(screenshot: app.screenshot())
        dailyAttachment.name = "wide-photo-contained-in-daily-card"
        dailyAttachment.lifetime = .keepAlways
        add(dailyAttachment)

        app.buttons["回顾"].tap()
        XCTAssertTrue(app.navigationBars["回顾"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["已换一条，30 秒内可以撤销。"].exists)
        XCTAssertTrue(app.staticTexts["今天"].exists)
        XCTAssertTrue(app.staticTexts["当前"].exists)
        XCTAssertTrue(app.staticTexts["今天出现过"].exists)
        XCTAssertTrue(app.staticTexts[firstTitle].exists)
        XCTAssertTrue(app.staticTexts[secondTitle].exists)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "swap-history-wide-photo-contained"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func assertPhotoRegionIsContained(in app: XCUIApplication, title: String) {
        let photos = app.descendants(matching: .any).matching(identifier: "knowledge-card-photo")
        XCTAssertEqual(photos.count, 1, "The photo should expose one bounded accessibility element. \(app.debugDescription)")
        let photo = photos.firstMatch
        XCTAssertFalse(photo.label.isEmpty)
        XCTAssertTrue((photo.value as? String)?.contains("识别") == true)
        if abs(photo.frame.height - 250) > 1 {
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "photo-focus-frame-mismatch"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertEqual(photo.frame.height, 250, accuracy: 1,
                       "The photo focus frame must follow the clipped card, not the source image size.")
        XCTAssertGreaterThanOrEqual(photo.frame.minX, app.frame.minX)
        XCTAssertLessThanOrEqual(photo.frame.maxX, app.frame.maxX)
        XCTAssertGreaterThanOrEqual(photo.frame.minY, app.staticTexts["见微"].frame.maxY)
        XCTAssertLessThanOrEqual(photo.frame.maxY, app.staticTexts[title].frame.minY)
    }

    @MainActor
    func testSeededDailyCardRendersAndWidgetCanBeAdded() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo"]
        app.launch()

        XCTAssertTrue(app.staticTexts["扫帚刷毛做成斜扇形，是为了更贴近墙角"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["附有参考来源"].exists)
        let dailyCardAttachment = XCTAttachment(screenshot: app.screenshot())
        dailyCardAttachment.name = "daily-card"
        dailyCardAttachment.lifetime = XCTAttachment.Lifetime.keepAlways
        add(dailyCardAttachment)

        // The widget must work from its shared cache without the app process.
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 5))
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))

        let emptyArea = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.52, dy: 0.46))
        useDefaultHomeAppearance(in: springboard, emptyArea: emptyArea)
        emptyArea.press(forDuration: 1.8)

        let editHome = firstButton(
            in: springboard,
            labels: ["Edit", "编辑", "Edit Home Screen", "编辑主屏幕", "编辑主画面"]
        )
        if editHome.waitForExistence(timeout: 2) {
            editHome.tap()
        }

        guard openWidgetGallery(in: springboard) else {
            XCTFail("Could not enter Home Screen edit mode. \(springboard.debugDescription)")
            return
        }

        let search = springboard.searchFields.firstMatch
        guard search.waitForExistence(timeout: 6) else {
            XCTFail("Widget gallery search did not appear. \(springboard.debugDescription)")
            return
        }
        search.tap()
        search.typeText("见微")

        try openJianweiWidgetPreview(in: springboard, name: "small")
        try addPreviewedWidget(in: springboard)

        let done = firstButton(in: springboard, labels: ["Done", "完成"])
        if done.waitForExistence(timeout: 3) { done.tap() }

        let cardTitle = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "扫帚刷毛做成斜扇形，是为了更贴近墙角"))
            .firstMatch
        captureSystemState(springboard, name: "small-widget-after-add")
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

        XCTAssertTrue(openWidgetGallery(in: springboard))

        let secondSearch = springboard.searchFields.firstMatch
        XCTAssertTrue(secondSearch.waitForExistence(timeout: 6))
        secondSearch.tap()
        secondSearch.typeText("见微")
        try openJianweiWidgetPreview(in: springboard, name: "medium")

        let previewStart = springboard.coordinate(
            withNormalizedOffset: CGVector(dx: 0.78, dy: 0.52)
        )
        let previewEnd = springboard.coordinate(
            withNormalizedOffset: CGVector(dx: 0.22, dy: 0.52)
        )
        previewStart.press(forDuration: 0.1, thenDragTo: previewEnd)
        try addPreviewedWidget(in: springboard)

        let doneAgain = firstButton(in: springboard, labels: ["Done", "完成"])
        if doneAgain.waitForExistence(timeout: 3) { doneAgain.tap() }

        XCTAssertTrue(springboard.staticTexts["Google Patents"].waitForExistence(timeout: 8))
        XCTAssertTrue(
            springboard.staticTexts[
                "有些扫帚把刷毛做成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。"
            ].exists
        )

        let switchButton = springboard.buttons
            .matching(NSPredicate(format: "label CONTAINS %@", "换一条"))
            .firstMatch
        XCTAssertTrue(switchButton.waitForExistence(timeout: 5))
        switchButton.tap()

        let nextTitle = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "斜切刷毛不只贴地更稳，也会磨得更均匀"))
            .firstMatch
        XCTAssertTrue(nextTitle.waitForExistence(timeout: 20))
        XCTAssertEqual(app.state, .notRunning, "A cached widget swap must not launch the app.")

        let secondSwitch = springboard.buttons
            .matching(NSPredicate(format: "label CONTAINS %@", "换一条"))
            .firstMatch
        XCTAssertTrue(secondSwitch.waitForExistence(timeout: 5))
        secondSwitch.tap()

        let thirdTitle = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "有些扫帚让软毛扫地，硬毛专攻墙角"))
            .firstMatch
        XCTAssertTrue(thirdTitle.waitForExistence(timeout: 20))
        XCTAssertEqual(app.state, .notRunning)
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
        XCTAssertTrue(app.staticTexts["有些扫帚让软毛扫地，硬毛专攻墙角"].exists)

        let returnAttachment = XCTAttachment(screenshot: app.screenshot())
        returnAttachment.name = "app-returned-from-medium-widget"
        returnAttachment.lifetime = .keepAlways
        add(returnAttachment)

        app.buttons["完成"].tap()
        XCTAssertTrue(app.staticTexts["有些扫帚让软毛扫地，硬毛专攻墙角"].waitForExistence(timeout: 8))
        app.tabBars.buttons["回顾"].tap()
        XCTAssertTrue(app.staticTexts["有些扫帚让软毛扫地，硬毛专攻墙角"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["斜切刷毛不只贴地更稳，也会磨得更均匀"].exists)
        XCTAssertTrue(app.staticTexts["扫帚刷毛做成斜扇形，是为了更贴近墙角"].exists)

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))

        if #available(iOS 18.0, *) {
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

            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.18)).tap()
            let finishAppearance = firstButton(in: springboard, labels: ["Done", "完成"])
            if finishAppearance.waitForExistence(timeout: 2) { finishAppearance.tap() }
        }
        // A cleared cache has to lead back to automatic discovery, even if the
        // app was last on Settings. This also verifies the real widget URL.
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo", "-JianweiSeedEmpty"]
        app.launch()
        XCTAssertTrue(app.buttons["preparation-recovery"].waitForExistence(timeout: 8))
        app.tabBars.buttons["设置"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5))
        XCUIDevice.shared.press(.home)
        let emptyWidget = springboard.staticTexts["开启自动发现"].firstMatch
        // Relaunching from the app icon may return to a different Home page.
        for _ in 0..<6 where !emptyWidget.waitForExistence(timeout: 3) {
            springboard.swipeRight()
        }
        XCTAssertTrue(emptyWidget.waitForExistence(timeout: 20), springboard.debugDescription)
        XCTAssertFalse(springboard.staticTexts["选择照片"].exists)
        let emptyAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        emptyAttachment.name = "empty-widget-automatic-discovery"
        emptyAttachment.lifetime = .keepAlways
        add(emptyAttachment)
        emptyWidget.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 8))
        let returnedHome = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"),
                                                     object: app.tabBars.buttons["今天"])
        XCTAssertEqual(XCTWaiter.wait(for: [returnedHome], timeout: 5), .completed,
                       "The empty widget must not reopen an unrelated tab.")
        XCTAssertTrue(app.buttons["preparation-recovery"].exists)
    }

    @MainActor
    private func openJianweiWidgetPreview(in springboard: XCUIApplication, name: String) throws {
        // Search results can move while the keyboard dismisses. Tap the actual
        // result cell, not a label whose cached frame belonged to another sheet.
        let result = springboard.cells.matching(NSPredicate(format: "label == %@", "见微")).firstMatch
        let hittable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: result)
        XCTAssertEqual(XCTWaiter.wait(for: [hittable], timeout: 8), .completed)
        captureSystemState(springboard, name: "\(name)-gallery-search")
        result.tap()
        let preview = springboard.staticTexts["见微 · 每日一知"].firstMatch
        let opened = preview.waitForExistence(timeout: 8)
        captureSystemState(springboard, name: "\(name)-gallery-preview")
        _ = try XCTUnwrap(opened ? preview : nil, "The Jianwei preview must open before adding any widget.")
    }

    @MainActor
    private func addPreviewedWidget(in springboard: XCUIApplication) throws {
        XCTAssertTrue(springboard.staticTexts["见微 · 每日一知"].firstMatch.exists)
        let labels = ["Add Widget", "添加小组件", "加入小工具"]
        // iOS 17 and 26 prefix the sheet CTA with a space. The Home Screen action
        // behind it has the same wording but is not hittable while presented.
        let add = springboard.buttons.allElementsBoundByIndex.first {
            labels.contains($0.label.trimmingCharacters(in: .whitespacesAndNewlines)) && $0.isHittable
        }
        if add == nil {
            captureSystemState(springboard, name: "missing-add-widget-control")
        }
        try XCTUnwrap(add, "The preview did not expose Add Widget. \(springboard.debugDescription)").tap()
    }

    @MainActor
    private func captureSystemState(_ springboard: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = XCTAttachment(string: springboard.debugDescription)
        hierarchy.name = "\(name)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
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

    @MainActor
    private func openWidgetGallery(in springboard: XCUIApplication) -> Bool {
        let labels = ["Add", "添加", "Add Widget", "添加小组件", "加入小工具"]
        let addButton = firstButton(in: springboard, labels: labels)
        if !addButton.waitForExistence(timeout: 2) {
            // iOS 26 first enters jiggle mode with a top-left Edit button.
            // Tapping it reveals Add Widget as a second-level action.
            let editMenu = firstButton(in: springboard, labels: ["Edit", "编辑"])
            guard editMenu.waitForExistence(timeout: 3) else { return false }
            editMenu.tap()
        }
        guard addButton.waitForExistence(timeout: 5) else { return false }
        addButton.tap()
        return true
    }

    @MainActor
    private func useDefaultHomeAppearance(
        in springboard: XCUIApplication,
        emptyArea: XCUICoordinate
    ) {
        emptyArea.press(forDuration: 1.8)

        let editHome = firstButton(
            in: springboard,
            labels: ["Edit", "编辑", "Edit Home Screen", "编辑主屏幕", "编辑主画面"]
        )
        if editHome.waitForExistence(timeout: 2) { editHome.tap() }

        let customize = firstElement(
            in: springboard,
            labels: ["Customize", "自定", "自定义", "个性化"]
        )
        guard customize.waitForExistence(timeout: 3) else { return }
        customize.tap()

        let defaultAppearance = firstElement(in: springboard, labels: ["Default", "默认"])
        if defaultAppearance.waitForExistence(timeout: 3), !defaultAppearance.isSelected {
            defaultAppearance.tap()
        }

        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.18)).tap()
        let done = firstButton(in: springboard, labels: ["Done", "完成"])
        if done.waitForExistence(timeout: 3) { done.tap() }
    }

}
