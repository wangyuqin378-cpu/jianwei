package cn.jianwei.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.domain.model.PhotoAccess
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Test

class AutomaticDiscoveryControlInstrumentedTest {
    @Test
    fun pickerOnlyUserCanRequestAutomaticDiscoveryAfterOnboarding() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val schedulerPreferences = context.getSharedPreferences("analysis_scheduler", Context.MODE_PRIVATE)
        val pendingImportResults = PendingImportResultStore(context)
        val previousPendingImport = pendingImportResults.snapshot()
        val wasOnboarded = preferences.getBoolean("completed", false)
        val previousMode = schedulerPreferences.getString(AUTOMATIC_CARD_MODE_KEY, null)
        val hadDiscoveryPreference = schedulerPreferences.contains(AUTOMATIC_DISCOVERY_ENABLED_KEY)
        val previousDiscoveryEnabled = schedulerPreferences.getBoolean(
            AUTOMATIC_DISCOVERY_ENABLED_KEY,
            false
        )
        assumeTrue(
            "System permission prompt evidence requires a picker-only installation",
            currentPhotoAccess(context) == PhotoAccess.PICKER_ONLY
        )
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            pendingImportResults.clearAll()
            preferences.edit().putBoolean("completed", true).commit()
            schedulerPreferences.edit()
                .putString(AUTOMATIC_CARD_MODE_KEY, "DAILY_ONE")
                .putBoolean(AUTOMATIC_DISCOVERY_ENABLED_KEY, false)
                .commit()

            scenario = ActivityScenario.launch(MainActivity::class.java)
            clickNode(instrumentation, "设置与隐私")
            assertThat(awaitNodeWithScroll(instrumentation, "管理隐私与数据")).isNotNull()
            clickNode(instrumentation, "管理隐私与数据")
            val enableNode = awaitNodesInReadingOrder(
                instrumentation,
                listOf(
                    "照片发现方式",
                    "目前只处理你主动选择或分享的照片。开启后每个自然日最多上传分析 1 张；没有可靠命中时不会凑数。",
                    "开启自动发现"
                )
            )

            val output = File(context.getExternalFilesDir(null), SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)

            if (context.resources.configuration.fontScale >= 1.5f) {
                val clickable = clickableAncestor(enableNode)
                assertThat(clickable).isNotNull()
                assertThat(clickable!!.isEnabled).isTrue()
            } else {
                val clickable = clickableAncestor(enableNode)
                assertThat(clickable).isNotNull()
                assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
                awaitPermissionController(instrumentation)
            }
        } finally {
            instrumentation.uiAutomation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            scenario?.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
            schedulerPreferences.edit().apply {
                if (previousMode == null) remove(AUTOMATIC_CARD_MODE_KEY)
                else putString(AUTOMATIC_CARD_MODE_KEY, previousMode)
                if (hadDiscoveryPreference) {
                    putBoolean(AUTOMATIC_DISCOVERY_ENABLED_KEY, previousDiscoveryEnabled)
                } else {
                    remove(AUTOMATIC_DISCOVERY_ENABLED_KEY)
                }
            }.commit()
            restorePendingImport(pendingImportResults, previousPendingImport)
        }
    }

    private fun restorePendingImport(
        store: PendingImportResultStore,
        snapshot: PendingImportResultSnapshot
    ) {
        store.clearAll()
        if (snapshot.candidateTokens.isNotEmpty()) {
            store.remember(snapshot.candidateTokens)
        } else {
            store.complete(
                snapshot.focusedCardId,
                snapshot.notice,
                snapshot.retryCandidateTokens
            )
        }
    }

    private fun clickNode(instrumentation: android.app.Instrumentation, text: String) {
        val node = awaitNodeWithScroll(instrumentation, text)
        val clickable = clickableAncestor(node)
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun clickableAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? =
        generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            findTextNode(root, text)?.let { return it }
            swipeForward(instrumentation)
            SystemClock.sleep(250)
        }
        val root = instrumentation.uiAutomation.rootInActiveWindow
        error(
            "Timed out waiting for accessibility node: $text; " +
                "package=${root?.packageName}; visible=${visibleText(root)}"
        )
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (
            root.isVisibleToUser &&
            (root.text?.toString() == text || root.contentDescription?.toString() == text)
        ) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private fun awaitNodesInReadingOrder(
        instrumentation: android.app.Instrumentation,
        texts: List<String>,
        timeoutMillis: Long = 20_000
    ): AccessibilityNodeInfo {
        require(texts.isNotEmpty())
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        var nextIndex = 0
        while (SystemClock.uptimeMillis() < deadline) {
            instrumentation.uiAutomation.clearCache()
            val root = instrumentation.uiAutomation.rootInActiveWindow
            val node = findTextNode(root, texts[nextIndex])
            if (node != null) {
                nextIndex += 1
                if (nextIndex == texts.size) return node
                continue
            }
            val laterNodeIsVisible = texts
                .drop(nextIndex + 1)
                .any { laterText -> findTextNode(root, laterText) != null }
            if (laterNodeIsVisible) {
                swipeBackwardSmall(instrumentation)
            } else {
                swipeForwardSmall(instrumentation)
            }
            SystemClock.sleep(200)
        }
        val root = instrumentation.uiAutomation.rootInActiveWindow
        error(
            "Timed out reading accessibility nodes in order at: ${texts[nextIndex]}; " +
                "package=${root?.packageName}; visible=${visibleText(root)}"
        )
    }

    private fun swipeForward(instrumentation: android.app.Instrumentation) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * 0.78f).toInt()} " +
                "$centerX ${(metrics.heightPixels * 0.32f).toInt()} 250"
        ).close()
    }

    private fun swipeForwardSmall(instrumentation: android.app.Instrumentation) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * 0.64f).toInt()} " +
                "$centerX ${(metrics.heightPixels * 0.50f).toInt()} 180"
        ).close()
    }

    private fun swipeBackwardSmall(instrumentation: android.app.Instrumentation) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * 0.50f).toInt()} " +
                "$centerX ${(metrics.heightPixels * 0.64f).toInt()} 180"
        ).close()
    }

    private fun visibleText(root: AccessibilityNodeInfo?): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 50) return
            node.text?.toString()?.takeIf(String::isNotBlank)?.let(::add)
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private fun awaitPermissionController(
        instrumentation: android.app.Instrumentation,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val packageName = instrumentation.uiAutomation.rootInActiveWindow
                ?.packageName
                ?.toString()
            if (packageName?.contains("permissioncontroller") == true) return
            SystemClock.sleep(100)
        }
        error("System photo permission UI did not appear")
    }

    private companion object {
        const val SCREENSHOT_NAME = "automatic-discovery-control.png"
        const val AUTOMATIC_CARD_MODE_KEY = "automatic_card_mode"
        const val AUTOMATIC_DISCOVERY_ENABLED_KEY = "automatic_discovery_enabled"
    }
}
