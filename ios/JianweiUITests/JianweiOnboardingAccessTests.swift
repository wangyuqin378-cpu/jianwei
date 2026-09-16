import XCTest

final class JianweiOnboardingAccessTests: XCTestCase {
    @MainActor
    func testBackgroundRefreshNoticeKeepsPausedStateAndExistingCard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo",
                               "-JianweiBackgroundRefreshDenied"]
        app.launch()
        let title = "扫帚刷毛做成斜扇形，是为了更贴近墙角"
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["background-preparation-notice"].exists, "The demo is deliberately paused")
        app.tabBars.buttons["设置"].tap()
        let status = app.staticTexts["后台 App 刷新已关闭"]
        for _ in 0..<5 where !status.isHittable { app.swipeUp() }
        XCTAssertTrue(status.isHittable)
        XCTAssertTrue(app.buttons["打开系统设置"].isHittable)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "打开见微可继续补充")).firstMatch.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "background-refresh-disabled-explanation"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.tabBars.buttons["今天"].tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 5))
        app.tabBars.buttons["回顾"].tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 5))
        app.terminate()
    }

    @MainActor
    func testAuthorizeIsolatedPhotoKitLibraryAndLeaveAnalysisPaused() throws {
        guard ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]?.hasPrefix("Jianwei PhotoKit ") == true else {
            throw XCTSkip("Preparation helper only for an isolated PhotoKit simulator")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo", "-JianweiSeedEmpty"]
        app.resetAuthorizationStatus(for: .photos)
        app.launch()
        XCTAssertTrue(app.staticTexts["需要照片权限才能自动准备"].waitForExistence(timeout: 15))
        app.buttons["preparation-recovery"].tap()
        let inAppAllow = app.buttons["允许完全访问"]
        let systemAllow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["允许完全访问"]
        let allow = inAppAllow.waitForExistence(timeout: 3) ? inAppAllow : systemAllow
        XCTAssertTrue(allow.waitForExistence(timeout: 5), app.debugDescription)
        allow.tap()
        XCTAssertTrue(app.staticTexts["添加 Key，开始每日发现"].waitForExistence(timeout: 10))
        app.tabBars.buttons["设置"].tap()
        let toggle = app.buttons["automatic-discovery-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        if toggle.value as? String == "开启" { toggle.tap() }
        XCTAssertEqual(toggle.value as? String, "关闭")
        app.terminate()
    }

    /// Offline host: no managed endpoint and no real API key. These journeys
    /// exercise actual controls and Keychain writes, never AI generation.
    @MainActor
    func testUnconfiguredBetaOffersBYOKWithoutClaimingServiceReady() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiOnboardingPage", "2"]
        app.launch()
        XCTAssertTrue(app.staticTexts["每天替你选出一条"].waitForExistence(timeout: 15))
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "offline-onboarding-service-state"
        before.lifetime = .keepAlways
        add(before)
        XCTAssertFalse(app.buttons["授权并开始自动发现"].isEnabled,
                       "A Beta flag is not a configured AI service")
        XCTAssertFalse(app.staticTexts["现有 AI 已配置，无需填写内容或 Key"].exists)
        let key = app.secureTextFields["粘贴百炼 Qwen API Key"]
        for _ in 0..<5 where !key.isHittable { app.swipeUp() }
        XCTAssertTrue(key.isHittable, "The user must be able to set up their own Key")
        key.tap()
        key.typeText("sk-ui_offline_synthetic_1234567890")
        app.keyboards.buttons["Done"].tap()
        let save = app.buttons["保存并使用自己的 Key"]
        for _ in 0..<3 where !save.isHittable { app.swipeUp() }
        save.tap()
        XCTAssertTrue(app.staticTexts["本机 Qwen Key 已配置"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["授权并开始自动发现"].isEnabled)
    }

    @MainActor
    func testBYOKSettingsRemainReachableInBetaAndKeepCurrentCard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo"]
        app.launch()
        let title = "扫帚刷毛做成斜扇形，是为了更贴近墙角"
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["当前真机构建没有配置 AI 服务地址，请重新安装正确的体验包。"].exists)
        app.tabBars.buttons["设置"].tap()
        let key = app.secureTextFields["粘贴百炼 Qwen API Key"]
        for _ in 0..<5 where !key.isHittable { app.swipeUp() }
        XCTAssertTrue(key.isHittable)
        key.tap()
        key.typeText("sk-ui_offline_synthetic_1234567890")
        app.keyboards.buttons["Done"].tap()
        let save = app.buttons["保存并使用自己的 Key"]
        for _ in 0..<3 where !save.isHittable { app.swipeUp() }
        save.tap()
        XCTAssertTrue(app.staticTexts["本机 Key, 已安全保存"].waitForExistence(timeout: 8))
        app.tabBars.buttons["今天"].tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 8))
        app.tabBars.buttons["回顾"].tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 8))
    }

    @MainActor
    func testBYOKPrivacyControlsDoNotPresentManagedHealthAsItsConnection() throws {
        let app = XCUIApplication()
        // The storefront preview exposes both UI modes, while OfflineUITest
        // removes the real gateway and blocks all direct-provider traffic.
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiStorefrontPreview",
                               "-JianweiResetOnboarding", "-JianweiSeedDemo"]
        app.launch()
        let title = "扫帚刷毛做成斜扇形，是为了更贴近墙角"
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 15))
        app.tabBars.buttons["设置"].tap()
        let key = app.secureTextFields["粘贴百炼 Qwen API Key"]
        let expand = app.buttons["使用自己的 Qwen Key"]
        for _ in 0..<6 where !key.isHittable && !expand.isHittable { app.swipeUp() }
        if expand.isHittable { expand.tap() }
        for _ in 0..<4 where !key.isHittable { app.swipeUp() }
        XCTAssertTrue(key.isHittable)
        key.tap()
        key.typeText("sk-ui_offline_synthetic_1234567890")
        app.keyboards.buttons["Done"].tap()
        let save = app.buttons["保存并使用自己的 Key"]
        for _ in 0..<3 where !save.isHittable { app.swipeUp() }
        save.tap()
        XCTAssertTrue(app.staticTexts["本机 Key, 已安全保存"].waitForExistence(timeout: 8))
        let clear = app.buttons["清除本机索引、卡片与缩略图"]
        for _ in 0..<8 where !clear.isHittable { app.swipeUp() }
        XCTAssertTrue(clear.isHittable)
        XCTAssertFalse(app.buttons["serviceConnectionCheck"].exists)
        XCTAssertTrue(app.staticTexts["已保存在本机"].exists)
        let privacy = XCTAttachment(screenshot: app.screenshot())
        privacy.name = "byok-privacy-no-managed-health"
        privacy.lifetime = .keepAlways
        add(privacy)
        clear.tap()
        XCTAssertTrue(app.buttons["清除本机索引和卡片"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@",
            "不会删除系统相册原图或本机 Qwen Key，也不会取消订阅")).firstMatch.exists)
        let confirmation = XCTAttachment(screenshot: app.screenshot())
        confirmation.name = "local-deletion-scope-confirmation"
        confirmation.lifetime = .keepAlways
        add(confirmation)
        XCTAssertTrue(app.alerts.buttons["取消"].isHittable)
        app.alerts.buttons["取消"].tap()
        let cloudClear = app.buttons["删除见微云端与本机数据"]
        for _ in 0..<3 where !cloudClear.isHittable { app.swipeUp() }
        cloudClear.tap()
        XCTAssertTrue(app.alerts.buttons["删除云端与本机数据"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.alerts.staticTexts.matching(NSPredicate(format: "label CONTAINS %@",
            "云端删除需要联网确认")).firstMatch.exists)
        XCTAssertTrue(app.alerts.buttons["取消"].isHittable)
        let cloudConfirmation = XCTAttachment(screenshot: app.screenshot())
        cloudConfirmation.name = "cloud-deletion-scope-confirmation"
        cloudConfirmation.lifetime = .keepAlways
        add(cloudConfirmation)
        app.alerts.buttons["取消"].tap()
        app.tabBars.buttons["今天"].tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 8))
        app.tabBars.buttons["回顾"].tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 8))
        app.terminate()
    }

    @MainActor
    func testEmptyHomeRecoversFromMissingKeyAndPauseWithoutInventingPreviousCard() throws {
        // The empty photo source is explicit; permission and Keychain are real.
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo", "-JianweiSeedEmpty"]
        app.resetAuthorizationStatus(for: .photos)
        app.launch()
        if app.staticTexts["需要照片权限才能自动准备"].waitForExistence(timeout: 5) {
            app.buttons["preparation-recovery"].tap()
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let allow = springboard.buttons["允许完全访问"]
            XCTAssertTrue(allow.waitForExistence(timeout: 8), springboard.debugDescription)
            allow.tap()
        }
        XCTAssertTrue(app.staticTexts["添加 Key，开始每日发现"].waitForExistence(timeout: 12))
        XCTAssertFalse(app.staticTexts["正在替你找今天的一条"].exists)
        app.buttons["preparation-recovery"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5))
        let discovery = app.buttons["automatic-discovery-toggle"]
        if discovery.value as? String == "开启" { discovery.tap() }
        let key = app.secureTextFields["粘贴百炼 Qwen API Key"]
        for _ in 0..<5 where !key.isHittable { app.swipeUp() }
        XCTAssertTrue(key.isHittable)
        key.tap()
        key.typeText("sk-ui_offline_synthetic_1234567890")
        app.keyboards.buttons["Done"].tap()
        let save = app.buttons["保存并使用自己的 Key"]
        for _ in 0..<3 where !save.isHittable { app.swipeUp() }
        save.tap()
        XCTAssertTrue(app.staticTexts["本机 Key, 已安全保存"].waitForExistence(timeout: 8))
        app.tabBars.buttons["今天"].tap()
        XCTAssertTrue(app.staticTexts["自动发现已暂停"].waitForExistence(timeout: 5))
        let paused = XCTAttachment(screenshot: app.screenshot())
        paused.name = "empty-home-paused"
        paused.lifetime = .keepAlways
        add(paused)
        app.buttons["preparation-recovery"].tap()
        XCTAssertTrue(app.staticTexts["还没有合适的照片"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["正在替你找今天的一条"].exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "继续展示上一条")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "已有卡片仍会保留")).firstMatch.exists)
        let empty = XCTAttachment(screenshot: app.screenshot())
        empty.name = "empty-home-waiting-for-photos"
        empty.lifetime = .keepAlways
        add(empty)
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testFirstAuthorizationCompletesOnboardingAndStartsPreparation() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedEmpty", "-JianweiOnboardingPage", "2"]
        app.resetAuthorizationStatus(for: .photos)
        app.launch()
        XCTAssertTrue(app.staticTexts["每天替你选出一条"].waitForExistence(timeout: 10))
        let key = app.secureTextFields["粘贴百炼 Qwen API Key"]
        for _ in 0..<5 where !key.isHittable { app.swipeUp() }
        key.tap()
        key.typeText("sk-ui_offline_synthetic_1234567890")
        app.keyboards.buttons["Done"].tap()
        app.buttons["保存并使用自己的 Key"].tap()
        XCTAssertTrue(app.staticTexts["本机 Qwen Key 已配置"].waitForExistence(timeout: 8))
        app.buttons["授权并开始自动发现"].tap()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["允许完全访问"]
        XCTAssertTrue(allow.waitForExistence(timeout: 8))
        allow.tap()
        XCTAssertTrue(app.tabBars.buttons["今天"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["还没有合适的照片"].waitForExistence(timeout: 10),
                      "The first authorized run must actually inspect the empty source")
        XCTAssertFalse(app.staticTexts["自动发现已暂停"].exists)
        app.tabBars.buttons["设置"].tap()
        XCTAssertEqual(app.buttons["automatic-discovery-toggle"].value as? String, "开启")
    }

    @MainActor
    func testDeniedPhotosShowsSettingsRecoveryWithoutClaimingPreparation() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiOfflineUITest", "-JianweiResetOnboarding", "-JianweiSeedDemo", "-JianweiSeedEmpty"]
        app.resetAuthorizationStatus(for: .photos)
        app.launch()
        XCTAssertTrue(app.staticTexts["需要照片权限才能自动准备"].waitForExistence(timeout: 10))
        app.buttons["preparation-recovery"].tap()
        let deny = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["不允许"]
        XCTAssertTrue(deny.waitForExistence(timeout: 8))
        deny.tap()
        XCTAssertTrue(app.buttons["设置照片权限"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts["正在替你找今天的一条"].exists)
        app.buttons["preparation-recovery"].tap()
        XCTAssertTrue(app.buttons["在系统设置中管理照片权限"].waitForExistence(timeout: 8))
        XCTAssertEqual(app.buttons["automatic-discovery-toggle"].value as? String, "关闭")
    }

    @MainActor
    func testDeviceBetaExperienceIsUsableWithoutAKey() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiSeedDemo"]
        app.launch()

        let automaticStatus = app.staticTexts["扫帚刷毛做成斜扇形，是为了更贴近墙角"]
        XCTAssertTrue(
            automaticStatus.waitForExistence(timeout: 30),
            "The seeded automatic preparation did not expose a ready day. \(app.debugDescription)"
        )
        XCTAssertFalse(app.buttons["直接使用现有 AI 选择一张照片"].exists)
        XCTAssertFalse(app.staticTexts["网络暂时不可用"].exists)

        XCTAssertFalse(
            app.descendants(matching: .any)["扫帚的原照片"].exists,
            "The decorative scaled photo must not cover the no-key AI control in the accessibility layout."
        )

        let todayAttachment = XCTAttachment(screenshot: app.screenshot())
        todayAttachment.name = "device-beta-current-today"
        todayAttachment.lifetime = .keepAlways
        add(todayAttachment)

        let settingsTab = app.tabBars.buttons["设置"]
        XCTAssertTrue(settingsTab.waitForExistence(timeout: 10))
        settingsTab.tap()
        let managed = app.buttons["使用见微体验服务"]
        for _ in 0..<4 where managed.exists && !managed.isHittable { app.swipeUp() }
        if managed.exists { managed.tap() }
        XCTAssertTrue(
            app.staticTexts["真机体验服务已配置，无需填写 Key"].waitForExistence(timeout: 10),
            "The device beta settings did not report the managed AI service. \(app.debugDescription)"
        )
        XCTAssertFalse(app.secureTextFields["粘贴百炼 Qwen API Key"].exists)
        let serviceConnectionCheck = app.buttons["serviceConnectionCheck"]
        for _ in 0..<5 where !serviceConnectionCheck.exists {
            app.swipeUp()
        }
        XCTAssertTrue(
            serviceConnectionCheck.waitForExistence(timeout: 10),
            "The device beta settings did not expose a read-only service connection check."
        )
        // A BYOK launch intentionally skips managed health checks. Switching
        // modes must not pretend a probe already ran: exercise the real button.
        serviceConnectionCheck.tap()
        let connected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "检测服务连接，已连接"),
            object: serviceConnectionCheck
        )
        XCTAssertEqual(XCTWaiter.wait(for: [connected], timeout: 15), .completed)

        let settingsAttachment = XCTAttachment(screenshot: app.screenshot())
        settingsAttachment.name = "device-beta-current-settings"
        settingsAttachment.lifetime = .keepAlways
        add(settingsAttachment)

        app.tabBars.buttons["今天"].tap()
        XCTAssertTrue(automaticStatus.waitForExistence(timeout: 10))
    }

    @MainActor
    func testManagedExperienceCanStartWithoutUserKey() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-JianweiResetOnboarding", "-JianweiOnboardingPage", "2"]
        app.launch()

        let title = app.staticTexts["每天替你选出一条"]
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        // Earlier BYOK journeys must not dictate this managed-mode fixture.
        // Do not change production reset/delete behavior to erase the choice.
        let managed = app.buttons["使用见微体验服务"]
        if managed.exists { managed.tap() }
        XCTAssertTrue(app.staticTexts["现有 AI 已配置，无需填写内容或 Key"].waitForExistence(timeout: 8))

        let startButton = app.buttons["授权并开始自动发现"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 10))
        XCTAssertTrue(startButton.isEnabled)
        XCTAssertTrue(app.staticTexts["现有 AI 已配置，无需填写内容或 Key"].exists)
        XCTAssertFalse(app.secureTextFields["粘贴百炼 Qwen API Key"].exists)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "onboarding-managed-access-ready"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
