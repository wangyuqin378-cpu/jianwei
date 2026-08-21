package cn.jianwei.app

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.net.Uri
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.io.PlatformTestStorageRegistry
import cn.jianwei.app.widget.DailyWidgetReceiver
import cn.jianwei.app.widget.LARGE_WIDGET_FONT_SCALE
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test

class WidgetInstallCompletionInstrumentedTest {
    @Test
    fun realBroomPhotoAndReviewedFactRemainReadableAcrossWidgetSizes() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val manager = AppWidgetManager.getInstance(context)
        val provider = ComponentName(context, DailyWidgetReceiver::class.java)
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val database = buildJianweiDatabase(context)
        val photo = File(context.filesDir, REAL_PHOTO_FILE_NAME)
        var scenario: ActivityScenario<MainActivity>? = null
        assumeTrue("Reference launcher pinning is required", manager.isRequestPinAppWidgetSupported)
        ensureReferenceLauncherWidgetHostIsClean(instrumentation, manager, provider)

        try {
            context.resources.openRawResource(R.drawable.onboarding_broom_example).use { input ->
                photo.outputStream().use(input::copyTo)
            }
            database.cards().clear()
            preferences.edit().putBoolean("completed", true).commit()
            database.cards().upsertAll(listOf(realPhotoCard(Uri.fromFile(photo).toString())))

            scenario = ActivityScenario.launch(MainActivity::class.java)
            assertThat(awaitNode(instrumentation, REAL_PHOTO_CARD_TITLE)).isNotNull()
            clickNode(instrumentation, "添加到桌面")
            clickAnyNode(instrumentation, listOf("Add to home screen", "添加到主屏幕"))
            awaitCondition("real-photo widget binding") { manager.getAppWidgetIds(provider).isNotEmpty() }
            awaitCondition("return to app after real-photo widget pin") {
                instrumentation.uiAutomation.rootInActiveWindow?.packageName?.toString() == context.packageName
            }

            pressHomeAndWait(instrumentation)
            val compactHost = showWidgetPage(instrumentation)
            val compactPhoto = awaitContentDescriptionNode(instrumentation, REAL_PHOTO_DESCRIPTION)
            val compactTitle = awaitNode(instrumentation, REAL_PHOTO_CARD_TITLE)
            val compactRoot = instrumentation.uiAutomation.rootInActiveWindow
            assertThat(findTextNode(compactRoot, PHOTO_THUMBNAIL_UNAVAILABLE_LABEL)).isNull()
            val compactHostBounds = boundsInScreen(compactHost)
            val compactPhotoBounds = boundsInScreen(compactPhoto)
            assertThat(compactPhotoBounds.left).isAtLeast(compactHostBounds.left)
            assertThat(compactPhotoBounds.right).isAtMost(compactHostBounds.right)
            assertThat(boundsInScreen(compactTitle).bottom).isAtMost(compactHostBounds.bottom)
            val evidenceSuffix = if (context.resources.configuration.fontScale >= LARGE_WIDGET_FONT_SCALE) {
                "font-1.6"
            } else {
                "standard"
            }
            screenshot(instrumentation, "widget-real-photo-2x2-$evidenceSuffix.png")

            instrumentation.uiAutomation.executeShellCommand(
                "input swipe ${compactHostBounds.centerX()} ${compactHostBounds.centerY()} " +
                    "${compactHostBounds.centerX() + 1} ${compactHostBounds.centerY()} 700"
            ).close()
            val rightHandle = awaitResourceNode(
                instrumentation,
                "com.google.android.apps.nexuslauncher:id/widget_resize_right_handle"
            )
            val handleBounds = boundsInScreen(rightHandle)
            val screenBounds = boundsInScreen(instrumentation.uiAutomation.rootInActiveWindow)
            instrumentation.uiAutomation.executeShellCommand(
                "input swipe ${handleBounds.centerX()} ${handleBounds.centerY()} " +
                    "${screenBounds.right - 80} ${handleBounds.centerY()} 700"
            ).close()
            SystemClock.sleep(1_000)
            pressHomeAndWait(instrumentation)
            showWidgetPage(instrumentation)
            val wideHost = awaitWideWidgetHost(instrumentation)
            val widePhoto = awaitContentDescriptionNode(instrumentation, REAL_PHOTO_DESCRIPTION)
            val wideTitle = awaitNode(instrumentation, REAL_PHOTO_CARD_TITLE)
            val source = awaitNode(instrumentation, REAL_PHOTO_SOURCE_LABEL)
            val sourceAction = awaitNode(instrumentation, WIDE_SOURCE_ACTION)
            val wideHostBounds = boundsInScreen(wideHost)
            val widePhotoBounds = boundsInScreen(widePhoto)
            val wideTitleBounds = boundsInScreen(wideTitle)
            val sourceBounds = boundsInScreen(source)
            val sourceActionBounds = boundsInScreen(sourceAction)
            assertThat(findTextNode(instrumentation.uiAutomation.rootInActiveWindow, PHOTO_THUMBNAIL_UNAVAILABLE_LABEL)).isNull()
            assertThat(widePhotoBounds.left).isAtLeast(wideHostBounds.left)
            assertThat(widePhotoBounds.right).isAtMost(wideHostBounds.right)
            assertThat(sourceBounds.top).isAtLeast(wideTitleBounds.bottom)
            assertThat(sourceActionBounds.bottom).isAtMost(wideHostBounds.bottom)
            writeTextArtifact(
                "widget-real-photo-layout-$evidenceSuffix.json",
                JSONObject()
                    .put("schemaVersion", 1)
                    .put("releaseEvidence", false)
                    .put("fontScale", context.resources.configuration.fontScale.toDouble())
                    .put("title", REAL_PHOTO_CARD_TITLE)
                    .put("photoFixture", "bundled-no-person-broom")
                    .put("missingPhotoFallbackVisible", false)
                    .put("compactPhotoInsideWidget", compactPhotoBounds.left >= compactHostBounds.left && compactPhotoBounds.right <= compactHostBounds.right)
                    .put("compactTitleInsideWidget", boundsInScreen(compactTitle).bottom <= compactHostBounds.bottom)
                    .put("widePhotoInsideWidget", widePhotoBounds.left >= wideHostBounds.left && widePhotoBounds.right <= wideHostBounds.right)
                    .put("sourceAfterTitle", sourceBounds.top >= wideTitleBounds.bottom)
                    .put("sourceActionInsideWidget", sourceActionBounds.bottom <= wideHostBounds.bottom)
                    .toString(2)
            )
            screenshot(instrumentation, "widget-real-photo-4x2-$evidenceSuffix.png")
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
            photo.delete()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
            clearReferenceLauncherWidgetHost(instrumentation, manager, provider)
        }
    }

    @Test
    fun pinningWidgetClosesTheHomePromptAndKeepsARepeatManagementAction() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val manager = AppWidgetManager.getInstance(context)
        val provider = ComponentName(context, DailyWidgetReceiver::class.java)
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val database = buildJianweiDatabase(context)
        var scenario: ActivityScenario<MainActivity>? = null
        assumeTrue("Reference launcher pinning is required", manager.isRequestPinAppWidgetSupported)
        ensureReferenceLauncherWidgetHostIsClean(instrumentation, manager, provider)

        try {
            database.cards().clear()
            preferences.edit().putBoolean("completed", true).commit()
            database.cards().upsertAll(listOf(card()))

            scenario = ActivityScenario.launch(MainActivity::class.java)
            val cardBody = awaitNode(instrumentation, CARD_BODY)
            val ctaTitle = awaitNode(instrumentation, CTA_TITLE)
            val sourceContextTitle = awaitNode(instrumentation, SOURCE_CONTEXT_TITLE)
            val missingPhotoLabel = awaitNode(instrumentation, PHOTO_THUMBNAIL_UNAVAILABLE_LABEL)
            val rootBeforePin = instrumentation.uiAutomation.rootInActiveWindow
            assertThat(findTextNode(rootBeforePin, BRAND_PROMISE)).isNull()
            assertThat(findTextNode(rootBeforePin, "今天")).isNull()
            val cardBodyBounds = boundsInScreen(cardBody)
            val ctaBounds = boundsInScreen(ctaTitle)
            val sourceContextBounds = boundsInScreen(sourceContextTitle)
            val missingPhotoBounds = boundsInScreen(missingPhotoLabel)
            val windowBounds = boundsInScreen(instrumentation.uiAutomation.rootInActiveWindow)
            assertThat(ctaBounds.top).isAtLeast(cardBodyBounds.bottom)
            assertThat(ctaBounds.top).isAtLeast(sourceContextBounds.bottom)
            assertThat(ctaBounds.top).isLessThan(windowBounds.height())
            assertThat(missingPhotoBounds.height()).isLessThan(windowBounds.height() / 5)
            screenshot(instrumentation, VALUE_FIRST_SCREENSHOT_NAME)
            clickNode(instrumentation, "添加到桌面")
            clickAnyNode(instrumentation, listOf("Add to home screen", "添加到主屏幕"))

            awaitCondition("widget binding") { manager.getAppWidgetIds(provider).isNotEmpty() }
            awaitCondition("return to app") {
                instrumentation.uiAutomation.rootInActiveWindow?.packageName?.toString() == context.packageName
            }
            assertThat(awaitNodeWithScroll(instrumentation, SOURCE_CONTEXT_TITLE)).isNotNull()
            writeTextArtifact(
                VALUE_FIRST_AUDIT_NAME,
                JSONObject()
                    .put("schemaVersion", 1)
                    .put("releaseEvidence", false)
                    .put("windowHeightPx", windowBounds.height())
                    .put("cardBodyBottomPx", cardBodyBounds.bottom)
                    .put("widgetPromptTopPx", ctaBounds.top)
                    .put("widgetPromptBottomPx", ctaBounds.bottom)
                    .put("missingPhotoLabelTopPx", missingPhotoBounds.top)
                    .put("missingPhotoHeightPx", missingPhotoBounds.height())
                    .put("cardBodyTopPx", cardBodyBounds.top)
                    .put("promptVisibleWithoutScroll", ctaBounds.top < windowBounds.height())
                    .put("promptAfterCoreKnowledge", ctaBounds.top >= cardBodyBounds.bottom)
                    .put("compactMissingPhotoFallback", missingPhotoBounds.height() < windowBounds.height() / 5)
                    .put("brandPromiseRemovedFromRepeatVisit", findTextNode(rootBeforePin, BRAND_PROMISE) == null)
                    .put("redundantTodayHeaderRemoved", findTextNode(rootBeforePin, "今天") == null)
                    .put("sourceContextReachableAfterWidgetInstall", true)
                    .toString(2)
            )

            if (context.resources.configuration.fontScale < LARGE_WIDGET_FONT_SCALE) {
                expandPrivacyCenter(instrumentation)
                assertThat(awaitNodeWithScroll(instrumentation, "再添加一个桌面组件")).isNotNull()
            }

            PlatformTestStorageRegistry.getInstance().openOutputFile(SCREENSHOT_NAME).use { stream ->
                assertThat(instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)).isTrue()
            }

            pressHomeAndWait(instrumentation)
            val widgetHost = showWidgetPage(instrumentation)
            assertThat(awaitNode(instrumentation, COMPACT_BRAND)).isNotNull()
            assertThat(awaitNode(instrumentation, PHOTO_THUMBNAIL_UNAVAILABLE_LABEL)).isNotNull()
            assertThat(countTextNodes(instrumentation.uiAutomation.rootInActiveWindow, CARD_TITLE)).isEqualTo(1)
            val widgetBounds = boundsInScreen(widgetHost)
            val compactWindowBounds = boundsInScreen(instrumentation.uiAutomation.rootInActiveWindow)
            writeTextArtifact(
                COMPACT_WIDGET_AUDIT_NAME,
                JSONObject()
                    .put("schemaVersion", 1)
                    .put("releaseEvidence", false)
                    .put("widgetLeftPx", widgetBounds.left)
                    .put("widgetRightPx", widgetBounds.right)
                    .put("widgetTopPx", widgetBounds.top)
                    .put("widgetBottomPx", widgetBounds.bottom)
                    .put("windowLeftPx", compactWindowBounds.left)
                    .put("windowRightPx", compactWindowBounds.right)
                    .put("widgetInsideCurrentPage", widgetBounds.left >= compactWindowBounds.left && widgetBounds.right <= compactWindowBounds.right)
                    .toString(2)
            )
            PlatformTestStorageRegistry.getInstance().openOutputFile(WIDGET_SCREENSHOT_NAME).use { stream ->
                assertThat(instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)).isTrue()
            }

            instrumentation.uiAutomation.executeShellCommand(
                "input swipe ${widgetBounds.centerX()} ${widgetBounds.centerY()} " +
                    "${widgetBounds.centerX() + 1} ${widgetBounds.centerY()} 700"
            ).close()
            val rightHandle = awaitResourceNode(
                instrumentation,
                "com.google.android.apps.nexuslauncher:id/widget_resize_right_handle"
            )
            val handleBounds = boundsInScreen(rightHandle)
            val screenBounds = boundsInScreen(instrumentation.uiAutomation.rootInActiveWindow)
            instrumentation.uiAutomation.executeShellCommand(
                "input swipe ${handleBounds.centerX()} ${handleBounds.centerY()} " +
                    "${screenBounds.right - 80} ${handleBounds.centerY()} 700"
            ).close()
            SystemClock.sleep(1_000)
            pressHomeAndWait(instrumentation)
            showWidgetPage(instrumentation)
            val wideWidgetHost = awaitWideWidgetHost(instrumentation)
            val sourceAction = awaitNode(instrumentation, WIDE_SOURCE_ACTION)
            val largeWidgetText = context.resources.configuration.fontScale >= LARGE_WIDGET_FONT_SCALE
            val knowledgeAnchorLabel = if (largeWidgetText) CARD_TITLE else CARD_BODY
            val knowledgeAnchor = awaitNode(instrumentation, knowledgeAnchorLabel)
            val sourceActionBounds = boundsInScreen(sourceAction)
            val knowledgeAnchorBounds = boundsInScreen(knowledgeAnchor)
            val wideHostBounds = boundsInScreen(wideWidgetHost)
            val wideWindowBounds = boundsInScreen(instrumentation.uiAutomation.rootInActiveWindow)
            assertThat(wideHostBounds.width()).isGreaterThan(wideWindowBounds.width() / 2)
            assertThat(sourceActionBounds.top).isAtLeast(knowledgeAnchorBounds.bottom)
            assertThat(sourceActionBounds.bottom).isAtMost(wideHostBounds.bottom)
            writeTextArtifact(
                WIDE_WIDGET_AUDIT_NAME,
                JSONObject()
                    .put("schemaVersion", 1)
                    .put("releaseEvidence", false)
                    .put("wideHostWidthPx", wideHostBounds.width())
                    .put("windowWidthPx", wideWindowBounds.width())
                    .put("largeTextLayout", largeWidgetText)
                    .put("supportingBodyVisible", !largeWidgetText)
                    .put("knowledgeAnchor", if (largeWidgetText) "title" else "body")
                    .put("knowledgeBottomPx", knowledgeAnchorBounds.bottom)
                    .put("sourceActionTopPx", sourceActionBounds.top)
                    .put("sourceActionBottomPx", sourceActionBounds.bottom)
                    .put("wideHostBottomPx", wideHostBounds.bottom)
                    .put("sourceActionAfterKnowledge", sourceActionBounds.top >= knowledgeAnchorBounds.bottom)
                    .put("sourceActionInsideWidget", sourceActionBounds.bottom <= wideHostBounds.bottom)
                    .toString(2)
            )
            screenshot(instrumentation, WIDE_WIDGET_SCREENSHOT_NAME)
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
            clearReferenceLauncherWidgetHost(instrumentation, manager, provider)
        }
    }

    private fun card() = CardEntity(
        cardId = "card-widget-install-completion",
        candidateToken = "candidate-widget-install-completion",
        photoUri = "",
        topicId = "bicycle",
        factId = "bicycle-widget-install-completion",
        title = CARD_TITLE,
        detectedObjectName = "自行车",
        body = FULL_CARD_BODY,
        personalContext = "因为你最近拍过它",
        confidence = 0.95,
        sources = sourcesToJson(listOf(
            KnowledgeSource(
                sourceId = "bicycle-source",
                title = "Bicycle gearing",
                url = "https://en.wikipedia.org/wiki/Bicycle_gearing",
                publisher = "Wikipedia",
                authority = "reference"
            )
        )),
        status = "scheduled",
        scheduledDate = LocalDate.now().toString(),
        createdAtMillis = System.currentTimeMillis()
    )

    private fun realPhotoCard(photoUri: String) = CardEntity(
        cardId = "card-widget-real-photo",
        candidateToken = "candidate-widget-real-photo",
        photoUri = photoUri,
        topicId = "broom",
        factId = "broom-001",
        title = REAL_PHOTO_CARD_TITLE,
        detectedObjectName = "扫帚",
        body = "$REAL_PHOTO_CARD_TITLE，让边缘更容易贴近墙角和家具边缘。",
        personalContext = "因为你最近拍过它",
        confidence = 0.97,
        sources = sourcesToJson(listOf(
            KnowledgeSource(
                sourceId = "src-broom",
                title = "US4756039A: angled-cut bristle broom",
                url = "https://patents.google.com/patent/US4756039A/en",
                publisher = "Google Patents",
                authority = "reference"
            )
        )),
        status = "scheduled",
        scheduledDate = LocalDate.now().toString(),
        createdAtMillis = System.currentTimeMillis(),
        objectBoxX = 0.50,
        objectBoxY = 0.0,
        objectBoxWidth = 0.33,
        objectBoxHeight = 0.95
    )

    private fun clickNode(instrumentation: android.app.Instrumentation, text: String) {
        click(awaitNodeWithScroll(instrumentation, text))
    }

    private fun clickAnyNode(instrumentation: android.app.Instrumentation, texts: List<String>) {
        val deadline = SystemClock.uptimeMillis() + 10_000
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            texts.firstNotNullOfOrNull { findTextNode(root, it) }?.let {
                click(it)
                return
            }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for one of: $texts")
    }

    private fun expandPrivacyCenter(instrumentation: android.app.Instrumentation) {
        clickNode(instrumentation, "设置与隐私")
        repeat(3) {
            clickCurrentNodeWithScroll(instrumentation, "管理隐私与数据")
            val deadline = SystemClock.uptimeMillis() + 2_000
            while (SystemClock.uptimeMillis() < deadline) {
                if (findTextNode(
                        instrumentation.uiAutomation.rootInActiveWindow,
                        "收起隐私与数据"
                    ) != null
                ) return
                SystemClock.sleep(100)
            }
        }
        error(
            "Timed out expanding privacy center; visible=" +
                visibleText(instrumentation.uiAutomation.rootInActiveWindow)
        )
    }

    private fun clickCurrentNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            val node = findTextNode(root, text)
            val clickable = node?.let { current ->
                generateSequence(current) { ancestor -> ancestor.parent }
                    .firstOrNull { ancestor -> ancestor.isClickable }
            }
            if (clickable?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) return
            findScrollableNode(root)?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            instrumentation.uiAutomation
                .executeShellCommand("input swipe 540 1900 540 750 250")
                .close()
            SystemClock.sleep(250)
        }
        error("Timed out clicking current accessibility node: $text")
    }

    private fun click(node: AccessibilityNodeInfo) {
        val clickable = generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun boundsInScreen(node: AccessibilityNodeInfo): Rect =
        Rect().also(node::getBoundsInScreen)

    private fun screenshot(
        instrumentation: android.app.Instrumentation,
        name: String
    ) {
        PlatformTestStorageRegistry.getInstance().openOutputFile(name).use { stream ->
            assertThat(instrumentation.uiAutomation.takeScreenshot()
                .compress(Bitmap.CompressFormat.PNG, 100, stream)).isTrue()
        }
    }

    private fun pressHomeAndWait(instrumentation: android.app.Instrumentation) {
        instrumentation.uiAutomation
            .executeShellCommand("input keyevent KEYCODE_HOME")
            .close()
        SystemClock.sleep(1_000)
    }

    private fun showWidgetPage(instrumentation: android.app.Instrumentation): AccessibilityNodeInfo {
        repeat(3) {
            val host = awaitContentDescriptionNode(instrumentation, "见微")
            val hostBounds = boundsInScreen(host)
            val windowBounds = boundsInScreen(instrumentation.uiAutomation.rootInActiveWindow)
            if (hostBounds.width() > 0 && hostBounds.left >= windowBounds.left && hostBounds.right <= windowBounds.right) {
                return host
            }
            val swipe = if (hostBounds.centerX() < windowBounds.centerX()) {
                "input swipe 180 1000 900 1000 300"
            } else {
                "input swipe 900 1000 180 1000 300"
            }
            instrumentation.uiAutomation.executeShellCommand(swipe).close()
            SystemClock.sleep(1_000)
        }
        val bounds = boundsInScreen(awaitContentDescriptionNode(instrumentation, "见微"))
        error("Widget did not enter the current launcher page; bounds=$bounds")
    }

    private fun awaitWideWidgetHost(
        instrumentation: android.app.Instrumentation,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val host = awaitContentDescriptionNode(instrumentation, "见微")
            val hostBounds = boundsInScreen(host)
            val windowBounds = boundsInScreen(instrumentation.uiAutomation.rootInActiveWindow)
            if (hostBounds.width() > windowBounds.width() / 2) return host
            SystemClock.sleep(250)
        }
        error("Timed out waiting for a wide widget host")
    }

    private fun writeTextArtifact(name: String, content: String) {
        PlatformTestStorageRegistry.getInstance().openOutputFile(name).bufferedWriter().use { writer ->
            writer.write(content)
        }
    }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        var attempt = 0
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            findTextNode(root, text)?.let { return it }
            val forward = (attempt / 8) % 2 == 0
            findScrollableNode(root)?.performAction(
                if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            )
            instrumentation.uiAutomation
                .executeShellCommand(
                    if (forward) "input swipe 540 1900 540 750 250" else "input swipe 540 750 540 1900 250"
                )
                .close()
            SystemClock.sleep(250)
            attempt += 1
        }
        val root = instrumentation.uiAutomation.rootInActiveWindow
        error("Timed out waiting for accessibility node: $text; visible=${visibleText(root)}")
    }

    private fun awaitNode(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)?.let { return it }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for accessibility node: $text")
    }

    private fun awaitContentDescriptionNode(
        instrumentation: android.app.Instrumentation,
        description: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findContentDescriptionNode(
                instrumentation.uiAutomation.rootInActiveWindow,
                description
            )?.let { return it }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for content description: $description")
    }

    private fun awaitResourceNode(
        instrumentation: android.app.Instrumentation,
        resourceId: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findResourceNode(instrumentation.uiAutomation.rootInActiveWindow, resourceId)?.let {
                return it
            }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for resource node: $resourceId")
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text || root.contentDescription?.toString() == text) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private fun findContentDescriptionNode(
        root: AccessibilityNodeInfo?,
        description: String
    ): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.contentDescription?.toString() == description) return root
        for (index in 0 until root.childCount) {
            findContentDescriptionNode(root.getChild(index), description)?.let { return it }
        }
        return null
    }

    private fun findResourceNode(
        root: AccessibilityNodeInfo?,
        resourceId: String
    ): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.viewIdResourceName == resourceId) return root
        for (index in 0 until root.childCount) {
            findResourceNode(root.getChild(index), resourceId)?.let { return it }
        }
        return null
    }

    private fun findScrollableNode(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.isScrollable) return root
        for (index in 0 until root.childCount) {
            findScrollableNode(root.getChild(index))?.let { return it }
        }
        return null
    }

    private fun countTextNodes(root: AccessibilityNodeInfo?, text: String): Int {
        if (root == null) return 0
        var count = if (root.text?.toString() == text) 1 else 0
        for (index in 0 until root.childCount) count += countTextNodes(root.getChild(index), text)
        return count
    }

    private fun visibleText(root: AccessibilityNodeInfo?): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 50) return
            node.text?.toString()?.takeIf(String::isNotBlank)?.let(::add)
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private fun awaitCondition(label: String, timeoutMillis: Long = 10_000, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for $label")
    }

    private fun clearReferenceLauncherWidgetHost(
        instrumentation: android.app.Instrumentation,
        manager: AppWidgetManager,
        provider: ComponentName
    ) {
        instrumentation.uiAutomation
            .executeShellCommand("pm clear com.google.android.apps.nexuslauncher")
            .close()
        awaitCondition("reference launcher widget host cleanup") {
            manager.getAppWidgetIds(provider).isEmpty()
        }
    }

    private fun ensureReferenceLauncherWidgetHostIsClean(
        instrumentation: android.app.Instrumentation,
        manager: AppWidgetManager,
        provider: ComponentName
    ) {
        if (manager.getAppWidgetIds(provider).isNotEmpty()) {
            clearReferenceLauncherWidgetHost(instrumentation, manager, provider)
        }
    }

    private companion object {
        const val CARD_TITLE = "自行车链传动用前后不同大小的齿盘改变转速与扭矩"
        const val FULL_CARD_BODY = "$CARD_TITLE，让骑手在速度和省力之间选择。"
        const val CARD_BODY = "让骑手在速度和省力之间选择。"
        const val COMPACT_BRAND = "见微 · 自行车"
        const val CTA_TITLE = "每天在桌面看一张"
        const val SOURCE_CONTEXT_TITLE = "为什么推给你"
        const val BRAND_PROMISE = "从你的照片里，每天认识一件小事"
        const val VALUE_FIRST_SCREENSHOT_NAME = "widget-install-value-first.png"
        const val VALUE_FIRST_AUDIT_NAME = "widget-install-value-first-layout.json"
        const val SCREENSHOT_NAME = "widget-install-completion.png"
        const val WIDGET_SCREENSHOT_NAME = "widget-content-deduplicated.png"
        const val COMPACT_WIDGET_AUDIT_NAME = "widget-content-deduplicated-layout.json"
        const val WIDE_WIDGET_SCREENSHOT_NAME = "widget-wide-source-action.png"
        const val WIDE_WIDGET_AUDIT_NAME = "widget-wide-source-action-layout.json"
        const val WIDE_SOURCE_ACTION = "查看照片与来源 →"
        const val REAL_PHOTO_FILE_NAME = "widget-real-broom.webp"
        const val REAL_PHOTO_CARD_TITLE = "现代扫帚常把刷毛设计成略带角度的扇形"
        const val REAL_PHOTO_DESCRIPTION = "$REAL_PHOTO_CARD_TITLE\u7684原照片缩略图"
        const val REAL_PHOTO_SOURCE_LABEL = "来源 · Google Patents"
    }
}
