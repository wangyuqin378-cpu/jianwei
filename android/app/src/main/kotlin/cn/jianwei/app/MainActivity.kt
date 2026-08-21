package cn.jianwei.app

import android.Manifest
import android.app.DatePickerDialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.appwidget.AppWidgetManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.edit
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import cn.jianwei.app.widget.DailyWidget
import cn.jianwei.app.widget.DailyWidgetReceiver
import cn.jianwei.data.photos.decodeBoundedThumbnail
import androidx.glance.appwidget.updateAll
import cn.jianwei.domain.card.cardBodyForDisplay
import cn.jianwei.domain.card.cardRecognitionPresentation
import cn.jianwei.domain.card.AutomaticCardMode
import cn.jianwei.domain.card.cardDatePresentation
import cn.jianwei.domain.card.CardDatePresentation
import cn.jianwei.domain.card.CardDateSection
import cn.jianwei.domain.card.FocusedCardStatus
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.TrackedItem
import cn.jianwei.domain.model.normalizedSafeKnowledgeSourceUrl
import cn.jianwei.domain.preferences.DEFAULT_INTEREST_SELECTION
import cn.jianwei.domain.preferences.INTEREST_OPTIONS
import cn.jianwei.domain.preferences.REQUIRED_INTEREST_COUNT
import cn.jianwei.domain.preferences.isValidInterestSelection
import cn.jianwei.domain.preferences.updatedInterestSelection
import cn.jianwei.domain.time.ChinaCalendar
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()
    @Inject lateinit var betaMetrics: BetaMetricsStore
    private var photoAccess by mutableStateOf(PhotoAccess.PICKER_ONLY)
    private var dailyWidgetInstalled by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        consumeNavigationIntent(intent)
        photoAccess = currentPhotoAccess(this)
        dailyWidgetInstalled = hasDailyWidget()
        viewModel.refreshCurrentDay()
        if (getSharedPreferences("onboarding", MODE_PRIVATE).getBoolean("completed", false)) {
            betaMetrics.markOnboardingCompleted()
        }
        setContent {
            JianweiTheme {
                val preferences = remember { getSharedPreferences("onboarding", MODE_PRIVATE) }
                var onboarded by remember { mutableStateOf(preferences.getBoolean("completed", false)) }
                val state by viewModel.uiState.collectAsStateWithLifecycle()
                val context = LocalContext.current
                var pendingReminderCardId by rememberSaveable { mutableStateOf<String?>(null) }
                var pendingReminderStartedOn by rememberSaveable { mutableLongStateOf(Long.MIN_VALUE) }
                var pendingReminderDays by rememberSaveable { mutableIntStateOf(0) }
                val completeOnboarding = {
                    preferences.edit { putBoolean("completed", true) }
                    onboarded = true
                    betaMetrics.markOnboardingCompleted()
                }
                val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                    val cardId = pendingReminderCardId
                    val startedOn = pendingReminderStartedOn
                        .takeIf { it != Long.MIN_VALUE }
                        ?.let(LocalDate::ofEpochDay)
                    val reminderDays = pendingReminderDays
                    pendingReminderCardId = null
                    pendingReminderStartedOn = Long.MIN_VALUE
                    pendingReminderDays = 0
                    ensureItemReminderChannel(context)
                    if (
                        granted &&
                        cardId != null &&
                        startedOn != null &&
                        canPostItemReminder(context)
                    ) {
                        viewModel.track(cardId, startedOn, reminderDays)
                    } else {
                        Toast.makeText(context, "未开启通知，因此没有建立物品提醒", Toast.LENGTH_LONG).show()
                    }
                }
                val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(20)) { uris ->
                    uris.forEach { uri ->
                        runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                    }
                    viewModel.importUris(uris.map(Uri::toString))
                }
                val photoPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
                    if (!onboarded) completeOnboarding()
                    photoAccess = currentPhotoAccess(context)
                    viewModel.startDiscovery(photoAccess)
                }
                val requestAutomaticDiscovery: (Boolean) -> Unit = { adjustExistingAccess ->
                    val currentAccess = currentPhotoAccess(context)
                    photoAccess = currentAccess
                    if (currentAccess != PhotoAccess.PICKER_ONLY && !adjustExistingAccess) {
                        viewModel.startDiscovery(currentAccess)
                    } else {
                        val requestCount = preferences.getInt(PHOTO_PERMISSION_REQUEST_COUNT, 0)
                        val shouldShowRationale = requiredPhotoPermissions().any { permission ->
                            ActivityCompat.shouldShowRequestPermissionRationale(this@MainActivity, permission)
                        }
                        if (shouldOpenPhotoPermissionSettings(currentAccess, requestCount, shouldShowRationale)) {
                            Toast.makeText(
                                context,
                                "系统已不再弹出照片授权，请在应用设置中开启照片访问",
                                Toast.LENGTH_LONG
                            ).show()
                            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                data = Uri.fromParts("package", packageName, null)
                            })
                        } else {
                            preferences.edit {
                                putInt(PHOTO_PERMISSION_REQUEST_COUNT, requestCount + 1)
                            }
                            photoPermission.launch(requiredPhotoPermissions())
                        }
                    }
                }
                val choosePhotos = {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
                val addWidget = { requestPinDailyWidget(context) }
                val submitReminder: (ItemReminderSubmission) -> Unit = { submission ->
                    ensureItemReminderChannel(context)
                    val permissionGranted = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) == PackageManager.PERMISSION_GRANTED
                    if (!permissionGranted) {
                        pendingReminderCardId = submission.cardId
                        pendingReminderStartedOn = submission.startedOn.toEpochDay()
                        pendingReminderDays = submission.reminderDays
                        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else if (!canPostItemReminder(context)) {
                        Toast.makeText(context, "请先在系统设置中开启见微的“物品提醒”通知，再建立提醒", Toast.LENGTH_LONG).show()
                    } else {
                        viewModel.track(
                            submission.cardId,
                            submission.startedOn,
                            submission.reminderDays
                        )
                    }
                }

                if (!onboarded) {
                    Onboarding(
                        onAutomatic = { interests, automaticMode ->
                            if (viewModel.saveOnboardingPreferences(interests, automaticMode, true)) {
                                requestAutomaticDiscovery(false)
                            } else {
                                Toast.makeText(context, "首次设置保存失败，请重试", Toast.LENGTH_LONG).show()
                            }
                        },
                        onPick = { interests, automaticMode ->
                            if (viewModel.saveOnboardingPreferences(interests, automaticMode, false)) {
                                viewModel.disableAutomaticDiscovery()
                                completeOnboarding()
                                choosePhotos()
                            } else {
                                Toast.makeText(context, "首次设置保存失败，请重试", Toast.LENGTH_LONG).show()
                            }
                        }
                    )
                } else {
                    LaunchedEffect(Unit) {
                        betaMetrics.markOnboardingCompleted()
                        viewModel.ensureDailyRefresh(photoAccess)
                    }
                    LaunchedEffect(state.currentDay) {
                        delay(millisUntilNextChinaDay(Instant.now()))
                        viewModel.refreshCurrentDay()
                    }
                    LaunchedEffect(state.focusedCard?.cardId) {
                        if (state.focusedCard != null) betaMetrics.markEngaged()
                    }
                    HomeScreen(
                        state = state,
                        access = photoAccess,
                        widgetInstalled = dailyWidgetInstalled,
                        onPick = choosePhotos,
                        onManageAutomaticDiscovery = {
                            requestAutomaticDiscovery(state.automaticDiscoveryEnabled)
                        },
                        onDisableAutomaticDiscovery = viewModel::disableAutomaticDiscovery,
                        onAddWidget = addWidget,
                        onFeedback = viewModel::feedback,
                        onSetSaved = viewModel::setSaved,
                        onTrack = submitReminder,
                        onCancelReminder = viewModel::cancelReminder,
                        onEngagement = betaMetrics::markEngaged,
                        onPause = viewModel::pauseAnalysis,
                        onResume = { viewModel.resume(photoAccess) },
                        onRetry = { viewModel.retry(photoAccess) },
                        onRetryImportedPhoto = viewModel::retryImportedPhoto,
                        onClearIndex = viewModel::clearLocalIndex,
                        onDeleteCloud = viewModel::deleteCloudData,
                        onExportMetrics = ::shareBetaMetrics,
                        onUpdateInterests = { viewModel.updateInterests(it) },
                        onUpdateAutomaticCardMode = { mode ->
                            viewModel.updateAutomaticCardMode(mode, photoAccess)
                        },
                        onCloseFocusedCard = { viewModel.focusCard(null) },
                        onDismissImportedPhotoResult = viewModel::clearImportedPhotoResultNotice,
                        onMessageShown = viewModel::clearMessage
                    )
                    LaunchedEffect(state.cards) { DailyWidget().updateAll(context) }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeNavigationIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        photoAccess = currentPhotoAccess(this)
        viewModel.refreshCurrentDay()
        if (getSharedPreferences("onboarding", MODE_PRIVATE).getBoolean("completed", false)) {
            viewModel.reconcilePhotoAccess(photoAccess)
        }
        refreshDailyWidgetInstallation()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) refreshDailyWidgetInstallation()
    }

    private fun refreshDailyWidgetInstallation() {
        dailyWidgetInstalled = hasDailyWidget()
        if (::betaMetrics.isInitialized && dailyWidgetInstalled) betaMetrics.markWidgetObserved()
    }

    private fun consumeNavigationIntent(intent: Intent) {
        if (intent.hasExtra(EXTRA_CARD_ID)) {
            viewModel.focusCard(intent.getStringExtra(EXTRA_CARD_ID))
            intent.removeExtra(EXTRA_CARD_ID)
        }
        viewModel.trackSharedImportResults(
            intent.getStringArrayListExtra(EXTRA_SHARED_IMPORT_CANDIDATE_TOKENS)
        )
        sharedImportNotice(
            intent.getStringExtra(EXTRA_SHARED_IMPORT_DISPOSITION),
            intent.getIntExtra(EXTRA_SHARED_IMPORT_COUNT, -1)
        )?.let(viewModel::announceMessage)
        intent.removeExtra(EXTRA_SHARED_IMPORT_DISPOSITION)
        intent.removeExtra(EXTRA_SHARED_IMPORT_COUNT)
        intent.removeExtra(EXTRA_SHARED_IMPORT_CANDIDATE_TOKENS)
    }

    private fun hasDailyWidget(): Boolean = AppWidgetManager.getInstance(this)
        .getAppWidgetIds(ComponentName(this, DailyWidgetReceiver::class.java))
        .isNotEmpty()

    private fun shareBetaMetrics() {
        lifecycleScope.launch {
            val report = runCatching {
                withContext(Dispatchers.IO) { betaMetrics.exportJson() }
            }.getOrElse {
                Toast.makeText(this@MainActivity, "内测报告生成失败，请重试", Toast.LENGTH_LONG).show()
                return@launch
            }
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_SUBJECT, "见微内测报告")
                putExtra(Intent.EXTRA_TEXT, report)
            }
            startActivity(Intent.createChooser(intent, "导出见微内测报告"))
        }
    }

    companion object {
        const val EXTRA_CARD_ID = "cn.jianwei.app.extra.CARD_ID"
        const val PHOTO_PERMISSION_REQUEST_COUNT = "photo_permission_request_count"
        const val EXTRA_SHARED_IMPORT_DISPOSITION = "cn.jianwei.app.extra.SHARED_IMPORT_DISPOSITION"
        const val EXTRA_SHARED_IMPORT_COUNT = "cn.jianwei.app.extra.SHARED_IMPORT_COUNT"
        const val EXTRA_SHARED_IMPORT_CANDIDATE_TOKENS =
            "cn.jianwei.app.extra.SHARED_IMPORT_CANDIDATE_TOKENS"
    }
}

internal fun millisUntilNextChinaDay(now: Instant): Long {
    val nextDay = ChinaCalendar.dateOf(now).plusDays(1)
        .atStartOfDay(ChinaCalendar.zone)
        .toInstant()
    return Duration.between(now, nextDay).toMillis().coerceAtLeast(1_000L) + 250L
}

@Composable
private fun JianweiTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = androidx.compose.material3.lightColorScheme(
            primary = androidx.compose.ui.graphics.Color(0xFF28543F),
            onPrimary = androidx.compose.ui.graphics.Color(0xFFFFFFFF),
            primaryContainer = androidx.compose.ui.graphics.Color(0xFFD9EADD),
            onPrimaryContainer = androidx.compose.ui.graphics.Color(0xFF102C20),
            secondary = androidx.compose.ui.graphics.Color(0xFF85543D),
            onSecondary = androidx.compose.ui.graphics.Color(0xFFFFFFFF),
            secondaryContainer = androidx.compose.ui.graphics.Color(0xFFF1DFD5),
            onSecondaryContainer = androidx.compose.ui.graphics.Color(0xFF351A0F),
            background = androidx.compose.ui.graphics.Color(0xFFF4F0E7),
            surface = androidx.compose.ui.graphics.Color(0xFFFFFCF5),
            surfaceVariant = androidx.compose.ui.graphics.Color(0xFFE8E3DA),
            onSurface = androidx.compose.ui.graphics.Color(0xFF1D211E),
            onSurfaceVariant = androidx.compose.ui.graphics.Color(0xFF454B46),
            outline = androidx.compose.ui.graphics.Color(0xFF747A74)
        ),
        content = content
    )
}

private enum class OnboardingStartMode {
    AUTOMATIC,
    PICKER_ONLY
}

@Composable
private fun Onboarding(
    onAutomatic: (Set<String>, AutomaticCardMode) -> Unit,
    onPick: (Set<String>, AutomaticCardMode) -> Unit
) {
    var step by rememberSaveable { mutableIntStateOf(0) }
    var encodedInterests by rememberSaveable {
        mutableStateOf(encodeInterestSelection(DEFAULT_INTEREST_SELECTION))
    }
    var automaticModeName by rememberSaveable {
        mutableStateOf(AutomaticCardMode.PREPARED_POOL.name)
    }
    var startModeName by rememberSaveable {
        mutableStateOf(OnboardingStartMode.AUTOMATIC.name)
    }
    val interests = decodeInterestSelection(encodedInterests)
    val automaticMode = runCatching { AutomaticCardMode.valueOf(automaticModeName) }
        .getOrDefault(AutomaticCardMode.PREPARED_POOL)
    val startMode = runCatching { OnboardingStartMode.valueOf(startModeName) }
        .getOrDefault(OnboardingStartMode.AUTOMATIC)
    val scrollState = rememberScrollState()
    val focusManager = LocalFocusManager.current
    LaunchedEffect(step) {
        focusManager.clearFocus(force = true)
        withFrameNanos { }
        scrollState.scrollTo(0)
    }
    val pages = listOf(
        "让日常照片重新开口" to "从你授权的照片里，挑一件普通物品，讲一个今天值得知道的细节。",
        "先在手机里筛选，再寻找知识" to "大多数照片不会离开手机；只有通过隐私和质量筛选的少量候选，才会进入可靠知识匹配。",
        "选择你的开始方式" to "先决定照片怎样进入见微，再选 3 个兴趣。两种方式都能完整使用，以后也能在设置里改。"
    )
    BackHandler(enabled = step > 0) {
        focusManager.clearFocus(force = true)
        step--
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(scrollState)
                    .padding(horizontal = 20.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "见微",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Text("照片里的日常知识", style = MaterialTheme.typography.labelMedium)
                    }
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Text(
                            "${step + 1} / 3",
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pages.indices.forEach { index ->
                        Box(
                            Modifier.weight(1f).height(5.dp).background(
                                color = if (index <= step) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(20.dp)
                            )
                        )
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(pages[step].first, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        pages[step].second,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                when (step) {
                    0 -> OnboardingValuePreview()
                    1 -> OnboardingPrivacyPreview()
                    else -> {
                        OnboardingStartModeSelector(
                            selectedMode = startMode,
                            onSelect = { startModeName = it.name }
                        )
                        OnboardingPreferences(
                            interests = interests,
                            onInterestChanged = { interest, checked ->
                                encodedInterests = encodeInterestSelection(
                                    updatedInterestSelection(interests, interest, checked)
                                )
                            }
                        )
                        if (startMode == OnboardingStartMode.AUTOMATIC) {
                            Card(
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                shape = RoundedCornerShape(20.dp)
                            ) {
                                Column(
                                    Modifier.padding(16.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text(
                                        "每天怎样准备卡片",
                                        style = MaterialTheme.typography.labelLarge,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    AutomaticCardModeOption(
                                        title = "提前备好一周（推荐）",
                                        body = "联网时准备 7–14 张；之后即使断网，组件也能每天换新。",
                                        selected = automaticMode == AutomaticCardMode.PREPARED_POOL,
                                        enabled = true,
                                        onClick = {
                                            automaticModeName = AutomaticCardMode.PREPARED_POOL.name
                                        }
                                    )
                                    AutomaticCardModeOption(
                                        title = "当天只理解一张",
                                        body = "每天最多上传分析 1 张；没有可靠知识时，今天继续显示上一张。",
                                        selected = automaticMode == AutomaticCardMode.DAILY_ONE,
                                        enabled = true,
                                        onClick = {
                                            automaticModeName = AutomaticCardMode.DAILY_ONE.name
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }
            Surface(color = MaterialTheme.colorScheme.background, shadowElevation = 6.dp) {
                Column(
                    Modifier
                        .navigationBarsPadding()
                        .padding(horizontal = 20.dp, vertical = 12.dp)
                ) {
                    if (step == 0) {
                        Button(onClick = { step++ }, modifier = Modifier.fillMaxWidth()) {
                            Text("继续")
                        }
                    } else {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(onClick = { step-- }, modifier = Modifier.weight(0.72f)) {
                                Text("返回")
                            }
                            Button(
                                onClick = {
                                    if (step == 1) {
                                        step++
                                    } else if (startMode == OnboardingStartMode.AUTOMATIC) {
                                        onAutomatic(interests, automaticMode)
                                    } else {
                                        onPick(interests, automaticMode)
                                    }
                                },
                                modifier = Modifier.weight(1.28f),
                                enabled = step < 2 || interests.size == 3
                            ) {
                                Text(
                                    when {
                                        step == 1 -> "继续"
                                        startMode == OnboardingStartMode.AUTOMATIC -> "开启自动发现"
                                        else -> "选择一张照片"
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OnboardingStartModeSelector(
    selectedMode: OnboardingStartMode,
    onSelect: (OnboardingStartMode) -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(24.dp)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "照片怎么进入见微",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            OnboardingStartModeOption(
                title = "自动发现",
                body = "授权后在本机筛选，只有少量候选会上传。",
                badge = "推荐",
                selected = selectedMode == OnboardingStartMode.AUTOMATIC,
                onClick = { onSelect(OnboardingStartMode.AUTOMATIC) }
            )
            OnboardingStartModeOption(
                title = "仅选择照片",
                body = "不开放相册；每次由你挑选，也可从其他 App 分享。",
                selected = selectedMode == OnboardingStartMode.PICKER_ONLY,
                onClick = { onSelect(OnboardingStartMode.PICKER_ONLY) }
            )
        }
    }
}

@Composable
private fun OnboardingStartModeOption(
    title: String,
    body: String,
    selected: Boolean,
    onClick: () -> Unit,
    badge: String? = null
) {
    val shape = RoundedCornerShape(16.dp)
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(
                width = 1.dp,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                shape = shape
            )
            .selectable(
                selected = selected,
                role = Role.RadioButton,
                onClick = onClick
            )
            .clearAndSetSemantics {
                contentDescription = "开始方式：$title。$body"
                role = Role.RadioButton
                this.selected = selected
                stateDescription = if (selected) "已选择" else "未选择"
                onClick(label = "选择$title") {
                    onClick()
                    true
                }
            },
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = shape
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            RadioButton(selected = selected, onClick = null)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        title,
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                    badge?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun OnboardingValuePreview() {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val sourceDescription = stringResource(R.string.onboarding_example_source_description)
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(24.dp)
    ) {
        Column {
            Box(
                Modifier.fillMaxWidth().height(180.dp)
            ) {
                Image(
                    painter = painterResource(R.drawable.onboarding_broom_example),
                    contentDescription = stringResource(R.string.widget_preview_image_description),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
                Surface(
                    modifier = Modifier.align(Alignment.TopStart).padding(12.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                    shape = RoundedCornerShape(18.dp)
                ) {
                    Text(
                        "示例照片",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                Surface(
                    modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.94f),
                    shape = RoundedCornerShape(18.dp)
                ) {
                    Text(
                        "识别到 · 扫帚",
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "今天的见微 · 示例",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.secondary,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    stringResource(R.string.widget_preview_title),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    stringResource(R.string.onboarding_example_body),
                    style = MaterialTheme.typography.bodyLarge
                )
                TextButton(
                    onClick = {
                        val opened = runCatching {
                            uriHandler.openUri(ONBOARDING_BROOM_SOURCE_URL)
                        }.isSuccess
                        if (!opened) {
                            Toast.makeText(context, "示例来源暂不可用", Toast.LENGTH_SHORT).show()
                        }
                    },
                    contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.semantics {
                        contentDescription = sourceDescription
                    }
                ) {
                    Text(stringResource(R.string.onboarding_example_source))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OnboardingTag("原照片做上下文")
                    OnboardingTag("来源可查看")
                }
            }
        }
    }
}

@Composable
private fun OnboardingTag(label: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(18.dp)) {
        Text(label, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun OnboardingPrivacyPreview() {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(24.dp)
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            OnboardingPipelineStep(
                number = "1",
                title = "本机先筛选",
                body = "人脸、截图、证件、高文字和模糊照片会先被排除。"
            )
            HorizontalDivider()
            OnboardingPipelineStep(
                number = "2",
                title = "只上传少量候选",
                body = "长边缩至 1280 px，并清除位置、设备、文件名和其他 EXIF。"
            )
            HorizontalDivider()
            OnboardingPipelineStep(
                number = "3",
                title = "可靠命中才生成",
                body = "只匹配审核过的事实；没有可靠对象或来源时不勉强出卡。"
            )
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                shape = RoundedCornerShape(16.dp)
            ) {
                Text(
                    "随时可以暂停分析、清除本地索引或删除云端设备数据。",
                    modifier = Modifier.padding(14.dp),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}

@Composable
private fun OnboardingPipelineStep(number: String, title: String, body: String) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top
    ) {
        Surface(color = MaterialTheme.colorScheme.primary, shape = RoundedCornerShape(20.dp)) {
            Text(
                number,
                modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                color = MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.Bold
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun OnboardingPreferences(
    interests: Set<String>,
    onInterestChanged: (String, Boolean) -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(24.dp)
    ) {
        InterestSelectionPanel(
            interests = interests,
            onInterestChanged = onInterestChanged,
            supportingText = "正好选择 3 项；它们只用于本次安装的推荐排序。",
            modifier = Modifier.padding(16.dp)
        )
    }
}

@Composable
private fun InterestSelectionPanel(
    interests: Set<String>,
    onInterestChanged: (String, Boolean) -> Unit,
    supportingText: String,
    modifier: Modifier = Modifier
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("选择兴趣", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("已选 ${interests.size} / $REQUIRED_INTEREST_COUNT", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
        Text(supportingText, style = MaterialTheme.typography.bodySmall)
        BoxWithConstraints {
            val stacked = shouldStackOnboardingInterests(maxWidth.value, LocalDensity.current.fontScale)
            if (stacked) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    INTEREST_OPTIONS.map { it.label }.forEach { interest ->
                        OnboardingInterestChoice(
                            interest = interest,
                            selected = interest in interests,
                            onChecked = { onInterestChanged(interest, it) }
                        )
                    }
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    INTEREST_OPTIONS.map { it.label }.chunked(2).forEach { rowOptions ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            rowOptions.forEach { interest ->
                                OnboardingInterestChoice(
                                    interest = interest,
                                    selected = interest in interests,
                                    onChecked = { onInterestChanged(interest, it) },
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            if (rowOptions.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OnboardingInterestChoice(
    interest: String,
    selected: Boolean,
    onChecked: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.toggleable(value = selected, role = Role.Checkbox, onValueChange = onChecked),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = RoundedCornerShape(16.dp)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Checkbox(
                checked = selected,
                onCheckedChange = null,
                modifier = Modifier.clearAndSetSemantics { }
            )
            Text(interest, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun HomeScreen(
    state: MainUiState,
    access: PhotoAccess,
    widgetInstalled: Boolean,
    onPick: () -> Unit,
    onManageAutomaticDiscovery: () -> Unit,
    onDisableAutomaticDiscovery: () -> Unit,
    onAddWidget: () -> Unit,
    onFeedback: (String, FeedbackAction) -> Unit,
    onSetSaved: (String, Boolean) -> Unit,
    onTrack: (ItemReminderSubmission) -> Unit,
    onCancelReminder: (String) -> Unit,
    onEngagement: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onRetry: () -> Unit,
    onRetryImportedPhoto: () -> Unit,
    onClearIndex: () -> Unit,
    onDeleteCloud: () -> Unit,
    onExportMetrics: () -> Unit,
    onUpdateInterests: (Set<String>) -> Boolean,
    onUpdateAutomaticCardMode: (AutomaticCardMode) -> Unit,
    onCloseFocusedCard: () -> Unit,
    onDismissImportedPhotoResult: () -> Unit,
    onMessageShown: () -> Unit
) {
    val snackbar = remember { SnackbarHostState() }
    var homeSection by rememberSaveable { mutableStateOf(HomeSection.DAILY) }
    var openedSavedCardId by rememberSaveable { mutableStateOf<String?>(null) }
    var openedHistoryCardId by rememberSaveable { mutableStateOf<String?>(null) }
    val deletionActionEnabled = areUserMutationsEnabled(state.activeOperation)
    val actionsEnabled = areAnalysisMutationsEnabled(
        state.activeOperation,
        state.cloudDeletionUnresolved
    )
    val externalFocusedEntry = state.focusedCardStatus != FocusedCardStatus.NONE
    val openedSavedCard = state.savedCards.firstOrNull { it.cardId == openedSavedCardId }
    val openedHistoryCard = state.cards.firstOrNull { card ->
        card.cardId == openedHistoryCardId && card.scheduledDate.isBefore(state.currentDay)
    }
    val focusedEntry = externalFocusedEntry || openedSavedCard != null || openedHistoryCard != null
    val activityIndicator = homeActivityIndicator(
        activeOperation = state.activeOperation,
        progress = state.analysisProgress,
        analysisProgressShownInContent = !focusedEntry &&
            homeSection == HomeSection.DAILY &&
            state.pendingImportCount > 0
    )
    val dailyListState = rememberLazyListState()
    val savedListState = rememberLazyListState()
    val settingsListState = rememberLazyListState()
    val focusedListState = rememberLazyListState()
    val activeListState = when {
        focusedEntry -> focusedListState
        homeSection == HomeSection.SAVED -> savedListState
        homeSection == HomeSection.SETTINGS -> settingsListState
        else -> dailyListState
    }
    val visibleCards = when (homeSection) {
        HomeSection.DAILY -> state.cards
        HomeSection.SAVED -> state.savedCards
        HomeSection.SETTINGS -> emptyList()
    }
    val savedCardIds = state.savedCards.mapTo(remember(state.savedCards) { mutableSetOf() }) { it.cardId }
    BackHandler(enabled = externalFocusedEntry) { onCloseFocusedCard() }
    BackHandler(enabled = !externalFocusedEntry && openedSavedCard != null) {
        openedSavedCardId = null
    }
    BackHandler(
        enabled = !externalFocusedEntry && openedSavedCard == null && openedHistoryCard != null
    ) {
        openedHistoryCardId = null
    }
    BackHandler(enabled = !focusedEntry && homeSection != HomeSection.DAILY) {
        homeSection = HomeSection.DAILY
    }
    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); onMessageShown() }
    }
    LaunchedEffect(state.focusedCardId) {
        if (state.focusedCardId != null) {
            homeSection = HomeSection.DAILY
            openedSavedCardId = null
            openedHistoryCardId = null
            focusedListState.scrollToItem(0)
        }
    }
    LaunchedEffect(state.paused, state.cloudDeletionUnresolved) {
        if (state.paused || state.cloudDeletionUnresolved) {
            // A privacy stop is more important than preserving the old feed offset. It can be
            // triggered from Settings while the daily list is off-screen, so reveal its banner
            // before the user returns instead of anchoring the previous card above it.
            dailyListState.scrollToItem(0)
        }
    }
    LaunchedEffect(openedSavedCardId, openedSavedCard?.cardId) {
        if (openedSavedCardId != null && openedSavedCard == null) {
            openedSavedCardId = null
        } else if (openedSavedCard != null) {
            focusedListState.scrollToItem(0)
        }
    }
    LaunchedEffect(openedHistoryCardId, openedHistoryCard?.cardId) {
        if (openedHistoryCardId != null && openedHistoryCard == null) {
            openedHistoryCardId = null
        } else if (openedHistoryCard != null) {
            focusedListState.scrollToItem(0)
        }
    }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("见微", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                state.activeOperation?.let { operation ->
                    Text(
                        operation.progressLabel,
                        modifier = Modifier
                            .weight(1f, fill = false)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (activityIndicator != null) {
                    CircularProgressIndicator(
                        Modifier.size(24.dp).semantics {
                            contentDescription = activityIndicator.contentDescription
                            stateDescription = activityIndicator.stateDescription
                            liveRegion = LiveRegionMode.Polite
                        },
                        strokeWidth = 2.dp
                    )
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (!focusedEntry) {
                HomeSectionTabs(
                    selectedSection = homeSection,
                    savedCount = state.savedCards.size,
                    onSelect = { homeSection = it }
                )
            }
            LazyColumn(
                state = activeListState,
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = 8.dp,
                    end = 16.dp,
                    bottom = 96.dp
                ),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
            if (focusedEntry) {
                if (openedSavedCard != null) {
                    item {
                        SavedCardDetailHeader(onClose = { openedSavedCardId = null })
                    }
                    item(key = "saved-detail-${openedSavedCard.cardId}") {
                        KnowledgeCardView(
                            openedSavedCard,
                            state.currentDay,
                            state.trackedItems[openedSavedCard.cardId],
                            state.feedbackStates[openedSavedCard.cardId],
                            isSaved = true,
                            actionsEnabled,
                            onFeedback,
                            onSetSaved,
                            onTrack,
                            onCancelReminder,
                            onEngagement
                        )
                    }
                } else if (openedHistoryCard != null) {
                    item {
                        HistoryCardDetailHeader(onClose = { openedHistoryCardId = null })
                    }
                    item(key = "history-detail-${openedHistoryCard.cardId}") {
                        KnowledgeCardView(
                            openedHistoryCard,
                            state.currentDay,
                            state.trackedItems[openedHistoryCard.cardId],
                            state.feedbackStates[openedHistoryCard.cardId],
                            openedHistoryCard.cardId in savedCardIds,
                            actionsEnabled,
                            onFeedback,
                            onSetSaved,
                            onTrack,
                            onCancelReminder,
                            onEngagement
                        )
                    }
                } else {
                    state.focusedCard?.let { card ->
                        item {
                            FocusedCardEntryBar(
                                fromRecentImport = state.focusedCardFromRecentImport,
                                onClose = onCloseFocusedCard
                            )
                        }
                        item(key = "focused-${card.cardId}") {
                            KnowledgeCardView(
                                card,
                                state.currentDay,
                                state.trackedItems[card.cardId],
                                state.feedbackStates[card.cardId],
                                card.cardId in savedCardIds,
                                actionsEnabled,
                                onFeedback,
                                onSetSaved,
                                onTrack,
                                onCancelReminder,
                                onEngagement,
                                widgetInstallAction = if (
                                    shouldShowImportedResultWidgetCallToAction(
                                        fromRecentImport = state.focusedCardFromRecentImport,
                                        widgetInstalled = widgetInstalled
                                    )
                                ) onAddWidget else null
                            )
                        }
                    } ?: item {
                        FocusedCardUnavailable(onCloseFocusedCard)
                    }
                }
            } else {
                if (homeSection == HomeSection.DAILY) {
                    if (
                        shouldShowPausedAnalysisBanner(
                            state.paused,
                            state.cards.isNotEmpty() ||
                                state.savedCards.isNotEmpty() ||
                                state.pendingImportCount > 0 ||
                                state.importedPhotoResultNotice != null
                        )
                    ) {
                        item {
                            PausedAnalysisBanner(
                                cloudDeletionUnresolved = state.cloudDeletionUnresolved,
                                actionsEnabled = if (state.cloudDeletionUnresolved) {
                                    deletionActionEnabled
                                } else {
                                    actionsEnabled
                                },
                                onResume = onResume,
                                onContinueCloudDeletion = onDeleteCloud
                            )
                        }
                    }
                    if (state.pendingImportCount > 0) {
                        item {
                            ImportedPhotoProgressCard(
                                count = state.pendingImportCount,
                                paused = state.paused,
                                cloudDeletionUnresolved = state.cloudDeletionUnresolved,
                                phase = state.analysisProgress.phase
                            )
                        }
                    } else if (state.importedPhotoResultNotice != null) {
                        item {
                            ImportedPhotoResultCard(
                                result = state.importedPhotoResultNotice,
                                actionsEnabled = actionsEnabled,
                                onPick = onPick,
                                onRetry = onRetryImportedPhoto,
                                onDismiss = onDismissImportedPhotoResult
                            )
                        }
                    } else {
                        analysisStatusBanner(state.analysisProgress, state.cards.isNotEmpty())?.let { bannerMessage ->
                            item {
                                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                                    Text(
                                        bannerMessage,
                                        modifier = Modifier.padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite },
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                }
                            }
                        }
                    }
                }
                item {
                    if (
                        homeSection == HomeSection.DAILY &&
                        state.cards.isEmpty() &&
                        state.pendingImportCount == 0 &&
                        state.importedPhotoResultNotice == null
                    ) {
                        EmptyState(
                            state.paused,
                            access,
                            state.automaticCardMode,
                            state.analysisProgress,
                            state.cloudDeletionUnresolved,
                            actionsEnabled,
                            deletionActionEnabled,
                            onPick,
                            onResume,
                            onRetry,
                            onDeleteCloud
                        )
                    }
                    if (homeSection == HomeSection.SAVED && state.savedCards.isEmpty()) {
                        SavedEmptyState(onShowDaily = { homeSection = HomeSection.DAILY })
                    }
                }
                if (homeSection == HomeSection.SAVED && state.savedCards.isNotEmpty()) {
                    item {
                        SavedCollectionHeader(state.savedCards.size)
                    }
                }
                itemsIndexed(visibleCards, key = { _, card -> card.cardId }) { index, card ->
                    if (homeSection == HomeSection.SAVED) {
                        SavedKnowledgeCardPreview(
                            card = card,
                            currentDay = state.currentDay,
                            onOpen = { openedSavedCardId = card.cardId }
                        )
                    } else {
                        val datePresentation = cardDatePresentation(card.scheduledDate, state.currentDay)
                        val previousSection = visibleCards.getOrNull(index - 1)
                            ?.let { previous -> cardDatePresentation(previous.scheduledDate, state.currentDay).section }
                        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            if (datePresentation.section != previousSection) {
                                if (datePresentation.section == CardDateSection.HISTORY) {
                                    HistoryCollectionHeader(
                                        visibleCards.count { historyCard ->
                                            historyCard.scheduledDate.isBefore(state.currentDay)
                                        }
                                    )
                                } else if (datePresentation.section == CardDateSection.UPCOMING) {
                                    DailyCardSectionHeader(datePresentation.section)
                                }
                            }
                            if (datePresentation.section == CardDateSection.HISTORY) {
                                HistoricalKnowledgeCardPreview(
                                    card = card,
                                    currentDay = state.currentDay,
                                    onOpen = { openedHistoryCardId = card.cardId }
                                )
                            } else {
                                KnowledgeCardView(
                                    card,
                                    state.currentDay,
                                    state.trackedItems[card.cardId],
                                    state.feedbackStates[card.cardId],
                                    card.cardId in savedCardIds,
                                    actionsEnabled,
                                    onFeedback,
                                    onSetSaved,
                                    onTrack,
                                    onCancelReminder,
                                    onEngagement,
                                    widgetInstallAction = if (
                                        shouldShowWidgetCallToAction(
                                            showSavedCards = false,
                                            cardIndex = index,
                                            widgetInstalled = widgetInstalled
                                        )
                                    ) onAddWidget else null
                                )
                            }
                        }
                    }
                }
                if (homeSection == HomeSection.SETTINGS) {
                    item {
                        SettingsHeader()
                    }
                    item {
                        AutomaticCardModeCenter(
                            selectedMode = state.automaticCardMode,
                            actionsEnabled = actionsEnabled,
                            onSelect = onUpdateAutomaticCardMode
                        )
                    }
                    item {
                        InterestPreferenceCenter(
                            selectedInterests = state.selectedInterests,
                            learnedPreferences = state.learnedPreferences,
                            actionsEnabled = actionsEnabled,
                            onSave = onUpdateInterests
                        )
                    }
                    item {
                        PrivacyCenter(
                            access,
                            state.automaticCardMode,
                            state.automaticDiscoveryEnabled,
                            widgetInstalled,
                            state.paused,
                            state.cloudDeletionUnresolved,
                            actionsEnabled,
                            deletionActionEnabled,
                            onPick,
                            onManageAutomaticDiscovery,
                            onDisableAutomaticDiscovery,
                            onAddWidget,
                            onPause,
                            onResume,
                            onClearIndex,
                            onDeleteCloud,
                            onExportMetrics
                        )
                    }
                }
            }
            }
        }
    }
}

private enum class HomeSection {
    DAILY,
    SAVED,
    SETTINGS
}

@Composable
private fun HomeSectionTabs(
    selectedSection: HomeSection,
    savedCount: Int,
    onSelect: (HomeSection) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        HomeSectionTab(
            label = "每日",
            accessibilityLabel = "每日卡片",
            selected = selectedSection == HomeSection.DAILY,
            onSelect = { onSelect(HomeSection.DAILY) },
            modifier = Modifier.weight(1f)
        )
        HomeSectionTab(
            label = "收藏 $savedCount",
            accessibilityLabel = "收藏 $savedCount",
            selected = selectedSection == HomeSection.SAVED,
            onSelect = { onSelect(HomeSection.SAVED) },
            modifier = Modifier.weight(1f)
        )
        HomeSectionTab(
            label = "设置",
            accessibilityLabel = "设置与隐私",
            selected = selectedSection == HomeSection.SETTINGS,
            onSelect = { onSelect(HomeSection.SETTINGS) },
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun HomeSectionTab(
    label: String,
    accessibilityLabel: String,
    selected: Boolean,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier
) {
    val contentColor = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    Box(
        modifier = modifier
            .height(48.dp)
            .clickable(onClick = onSelect)
            .clearAndSetSemantics {
                role = Role.Tab
                this.selected = selected
                contentDescription = accessibilityLabel
                onClick(action = {
                    onSelect()
                    true
                })
            },
        contentAlignment = Alignment.Center
    ) {
        Text(
            label,
            color = contentColor,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            maxLines = 1
        )
        if (selected) {
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 2.dp)
                    .size(width = 28.dp, height = 3.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(MaterialTheme.colorScheme.primary)
            )
        }
    }
}

@Composable
private fun SettingsHeader() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Text(
            "设置与隐私",
            modifier = Modifier.semantics { heading() },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            "调整推荐兴趣、照片发现方式、桌面组件和数据管理。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun SavedCollectionHeader(count: Int) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Text(
            "收藏的知识",
            modifier = Modifier.semantics { heading() },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            "共 $count 张，按最近收藏排序。点开卡片查看来源、提醒和反馈。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun SavedKnowledgeCardPreview(
    card: KnowledgeCard,
    currentDay: LocalDate,
    onOpen: () -> Unit
) {
    CompactKnowledgeCardPreview(
        card = card,
        currentDay = currentDay,
        openDescription = "打开收藏的知识卡：${card.title}",
        onOpen = onOpen
    )
}

@Composable
private fun HistoricalKnowledgeCardPreview(
    card: KnowledgeCard,
    currentDay: LocalDate,
    onOpen: () -> Unit
) {
    CompactKnowledgeCardPreview(
        card = card,
        currentDay = currentDay,
        openDescription = "打开往日知识卡：${card.title}",
        onOpen = onOpen
    )
}

@Composable
private fun CompactKnowledgeCardPreview(
    card: KnowledgeCard,
    currentDay: LocalDate,
    openDescription: String,
    onOpen: () -> Unit
) {
    val datePresentation = cardDatePresentation(card.scheduledDate, currentDay)
    Card(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth().semantics {
            contentDescription = openDescription
        },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(20.dp)
    ) {
        BoxWithConstraints {
            val stacked = maxWidth.value < 300f || LocalDensity.current.fontScale >= 1.5f
            if (stacked) {
                Column(Modifier.fillMaxWidth()) {
                    PhotoThumbnail(
                        card.photoUri,
                        contentDescription = "${card.title}的原照片缩略图",
                        modifier = Modifier.fillMaxWidth().height(104.dp),
                        maxSidePx = SAVED_PREVIEW_THUMBNAIL_MAX_SIDE_PX
                    )
                    SavedKnowledgeCardPreviewText(
                        card = card,
                        datePresentation = datePresentation,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                        bodyMaxLines = 2
                    )
                }
            } else {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    PhotoThumbnail(
                        card.photoUri,
                        contentDescription = "${card.title}的原照片缩略图",
                        modifier = Modifier.size(112.dp),
                        maxSidePx = SAVED_PREVIEW_THUMBNAIL_MAX_SIDE_PX
                    )
                    SavedKnowledgeCardPreviewText(
                        card = card,
                        datePresentation = datePresentation,
                        modifier = Modifier.weight(1f).padding(horizontal = 14.dp, vertical = 12.dp),
                        bodyMaxLines = 3
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryCollectionHeader(count: Int) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Text(
            "往日一知",
            modifier = Modifier.semantics { heading() },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            "过去的 $count 张卡片收在这里。点开可查看来源、提醒和反馈。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun SavedKnowledgeCardPreviewText(
    card: KnowledgeCard,
    datePresentation: CardDatePresentation,
    modifier: Modifier,
    bodyMaxLines: Int
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            datePresentation.visibleLabel,
            modifier = Modifier.semantics {
                contentDescription = datePresentation.accessibilityLabel
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.secondary,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            card.title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            card.body,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = bodyMaxLines,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            "查看完整知识",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun SavedEmptyState(onShowDaily: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        shape = RoundedCornerShape(22.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "把想记住的知识留在这里",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                "在每日卡片上点“收藏”，它就会出现在这里，方便以后回来找。",
                style = MaterialTheme.typography.bodyMedium
            )
            Button(onClick = onShowDaily, modifier = Modifier.fillMaxWidth()) {
                Text("查看每日卡片")
            }
        }
    }
}

@Composable
private fun PausedAnalysisBanner(
    cloudDeletionUnresolved: Boolean,
    actionsEnabled: Boolean,
    onResume: () -> Unit,
    onContinueCloudDeletion: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (cloudDeletionUnresolved) "云端删除尚未完成" else "照片分析已暂停",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                if (cloudDeletionUnresolved) {
                    "已有本地卡片仍可查看；完成删除前不会恢复分析或接收新照片。"
                } else {
                    "已有卡片仍可查看；恢复后才会继续处理新照片。"
                },
                style = MaterialTheme.typography.bodySmall
            )
            TextButton(
                onClick = if (cloudDeletionUnresolved) onContinueCloudDeletion else onResume,
                enabled = actionsEnabled,
                modifier = Modifier.align(Alignment.End)
            ) {
                Text(if (cloudDeletionUnresolved) "继续删除云端数据" else "恢复分析")
            }
        }
    }
}

@Composable
private fun ImportedPhotoResultCard(
    result: ImportedPhotoResultNotice,
    actionsEnabled: Boolean,
    onPick: () -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit
) {
    val noMatch = result == ImportedPhotoResultNotice.NO_MATCH
    val cannotRetry = result == ImportedPhotoResultNotice.CANNOT_RETRY
    val noMatchPresentation = if (noMatch) importedPhotoNoMatchPresentation() else null
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (noMatch) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.secondaryContainer
            }
        )
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                when {
                    noMatch -> requireNotNull(noMatchPresentation).title
                    cannotRetry -> "这张照片需要重新选择"
                    else -> "分析暂时没有完成"
                },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                when {
                    noMatch -> requireNotNull(noMatchPresentation).body
                    cannotRetry ->
                        "照片读取权限可能已失效，或本机处理没有完成。为保护隐私，见微没有保留可继续分析的中间文件。"
                    else -> retryableImportedPhotoFailureBody()
                },
                style = MaterialTheme.typography.bodyMedium
            )
            noMatchPresentation?.let { presentation ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.78f),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            presentation.guidanceTitle,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(presentation.guidanceBody, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            Button(
                onClick = if (result == ImportedPhotoResultNotice.FAILED) onRetry else onPick,
                modifier = Modifier.fillMaxWidth(),
                enabled = actionsEnabled
            ) {
                Text(
                    when {
                        noMatch -> requireNotNull(noMatchPresentation).actionLabel
                        cannotRetry -> "重新选择照片"
                        else -> "立即重试"
                    }
                )
            }
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.End),
                enabled = actionsEnabled
            ) {
                Text("回到每日卡片")
            }
        }
    }
}

@Composable
private fun ImportedPhotoProgressCard(
    count: Int,
    paused: Boolean,
    cloudDeletionUnresolved: Boolean,
    phase: AnalysisPhase
) {
    val presentation = importedPhotoProgressPresentation(
        paused = paused,
        cloudDeletionUnresolved = cloudDeletionUnresolved,
        phase = phase
    )
    Card(
        modifier = Modifier.fillMaxWidth().semantics {
            liveRegion = LiveRegionMode.Polite
            contentDescription = buildString {
                append("正在分析刚选择的 $count 张照片。")
                presentation.stageLabel?.let { append(it).append('。') }
                append(presentation.detail)
            }
        },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            presentation.stageLabel?.let { label ->
                Text(
                    label,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold
                )
            }
            presentation.activeStage?.let { activeStage ->
                ImportedPhotoStageProgress(activeStage)
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (!paused && !cloudDeletionUnresolved) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        presentation.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(presentation.detail, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun ImportedPhotoStageProgress(activeStage: Int) {
    Row(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { },
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        repeat(3) { index ->
            Box(
                Modifier
                    .weight(1f)
                    .height(4.dp)
                    .background(
                        color = if (index < activeStage) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.surface.copy(alpha = 0.72f)
                        },
                        shape = RoundedCornerShape(10.dp)
                    )
            )
        }
    }
}

@Composable
private fun FocusedCardEntryBar(
    fromRecentImport: Boolean,
    onClose: () -> Unit
) {
    DetailEntryBar(
        label = if (fromRecentImport) "刚刚从照片生成" else "当前知识卡",
        actionLabel = "返回每日卡片",
        onClose = onClose
    )
}

@Composable
private fun SavedCardDetailHeader(onClose: () -> Unit) {
    DetailEntryBar(label = "从收藏打开", actionLabel = "返回收藏", onClose = onClose)
}

@Composable
private fun HistoryCardDetailHeader(onClose: () -> Unit) {
    DetailEntryBar(label = "从往日一知打开", actionLabel = "返回每日卡片", onClose = onClose)
}

@Composable
private fun DetailEntryBar(
    label: String,
    actionLabel: String,
    onClose: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = RoundedCornerShape(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                label,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            TextButton(onClick = onClose) {
                Text(actionLabel)
            }
        }
    }
}

@Composable
private fun FocusedCardUnavailable(onClose: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(22.dp)
    ) {
        Column(
            Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                "这张卡已不可用",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text("它可能已被删除、标记为太私人，或本机缓存已经清理。")
            Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) {
                Text("返回每日卡片")
            }
        }
    }
}

@Composable
private fun WidgetCallToAction(onAddWidget: () -> Unit) {
    val fontScale = LocalDensity.current.fontScale
    BoxWithConstraints {
        val stacked = shouldStackWidgetCallToAction(maxWidth.value, fontScale)
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = androidx.compose.ui.graphics.Color(0xFFE3ECE5))
        ) {
            if (stacked) {
                Column(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    WidgetCallToActionCopy()
                    OutlinedButton(onClick = onAddWidget, modifier = Modifier.fillMaxWidth()) {
                        Text("添加到桌面")
                    }
                }
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    WidgetCallToActionCopy(Modifier.weight(1f))
                    OutlinedButton(onClick = onAddWidget) {
                        Text("添加到桌面")
                    }
                }
            }
        }
    }
}

@Composable
private fun WidgetCallToActionCopy(modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text("每天在桌面看一张", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text("新卡会自动更新。$WIDGET_RESIZE_DISCOVERY_COPY", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun InterestPreferenceCenter(
    selectedInterests: Set<String>,
    learnedPreferences: LearnedPreferenceSummary,
    actionsEnabled: Boolean,
    onSave: (Set<String>) -> Boolean
) {
    var editing by rememberSaveable { mutableStateOf(false) }
    var draftEncoded by rememberSaveable(selectedInterests) {
        mutableStateOf(encodeInterestSelection(selectedInterests))
    }
    val draft = remember(draftEncoded) { decodeInterestSelection(draftEncoded) }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("你的推荐偏好", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    INTEREST_OPTIONS.map { it.label }.filter { it in selectedInterests }.joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    "兴趣决定新照片候选的优先顺序；卡片反馈会继续学习，但不会擅自改动你的显式选择。",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            if (editing) {
                HorizontalDivider()
                InterestSelectionPanel(
                    interests = draft,
                    onInterestChanged = { interest, checked ->
                        draftEncoded = encodeInterestSelection(
                            updatedInterestSelection(draft, interest, checked)
                        )
                    },
                    supportingText = "正好保留 3 项。保存后会影响下一次补充卡片的候选顺序。"
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            draftEncoded = encodeInterestSelection(selectedInterests)
                            editing = false
                        },
                        modifier = Modifier.weight(1f)
                    ) { Text("取消") }
                    Button(
                        onClick = {
                            if (onSave(draft)) editing = false
                        },
                        enabled = actionsEnabled && isValidInterestSelection(draft) && draft != selectedInterests,
                        modifier = Modifier.weight(1f)
                    ) { Text("保存偏好") }
                }
            } else {
                OutlinedButton(onClick = { editing = true }, modifier = Modifier.fillMaxWidth(), enabled = actionsEnabled) {
                    Text("调整推荐兴趣")
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            LearnedPreferenceSummaryView(learnedPreferences)
        }
    }
}

@Composable
private fun LearnedPreferenceSummaryView(summary: LearnedPreferenceSummary) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        Text("见微正在学习", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        if (summary.isEmpty) {
            Text(
                "还没有学习记录。给知识卡点“有意思”或“没意思”后，会在这里看到变化。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            if (summary.moreOften.isNotEmpty()) {
                Text(
                    "更常留意：${summary.moreOften.joinToString(" · ")}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Medium
                )
            }
            if (summary.lessOften.isNotEmpty()) {
                Text(
                    "减少推荐：${summary.lessOften.joinToString(" · ")}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Medium
                )
            }
            Text(
                "只显示仍保留卡片的物件名称和本机反馈，不显示照片内容。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun AutomaticCardModeCenter(
    selectedMode: AutomaticCardMode,
    actionsEnabled: Boolean,
    onSelect: (AutomaticCardMode) -> Unit
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("自动发现怎样准备卡片", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "两种方式都先在本地排除模糊、重复和私人内容，只改变何时上传候选、准备几张卡片。",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            AutomaticCardModeOption(
                title = "提前备好一周（推荐）",
                body = "联网时准备 7–14 张；之后即使断网，组件也能每天换新。",
                selected = selectedMode == AutomaticCardMode.PREPARED_POOL,
                enabled = actionsEnabled,
                onClick = { onSelect(AutomaticCardMode.PREPARED_POOL) }
            )
            AutomaticCardModeOption(
                title = "当天只理解一张",
                body = "每天最多上传分析 1 张；没有可靠知识时，今天继续显示上一张。",
                selected = selectedMode == AutomaticCardMode.DAILY_ONE,
                enabled = actionsEnabled,
                onClick = { onSelect(AutomaticCardMode.DAILY_ONE) }
            )
            Text(
                "切换不会删除已经生成的卡片；尚未上传的自动任务会按新方式重新安排。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun AutomaticCardModeOption(
    title: String,
    body: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(14.dp)
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(
                width = 1.dp,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                shape = shape
            )
            .selectable(
                selected = selected,
                enabled = enabled,
                role = Role.RadioButton,
                onClick = onClick
            )
            .clearAndSetSemantics {
                contentDescription = "$title。$body"
                role = Role.RadioButton
                this.selected = selected
                stateDescription = if (selected) "已选择" else "未选择"
                if (enabled) onClick(label = "选择$title") {
                    onClick()
                    true
                }
            },
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = shape
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            RadioButton(selected = selected, onClick = null, enabled = enabled)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(body, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun encodeInterestSelection(selection: Set<String>): String =
    INTEREST_OPTIONS.map { it.label }.filter { it in selection }.joinToString("|")

private fun decodeInterestSelection(encoded: String): Set<String> =
    encoded.split("|").filterTo(linkedSetOf()) { value ->
        INTEREST_OPTIONS.any { it.label == value }
    }

@Composable
private fun EmptyState(
    paused: Boolean,
    access: PhotoAccess,
    automaticMode: AutomaticCardMode,
    progress: cn.jianwei.domain.model.AnalysisProgress,
    cloudDeletionUnresolved: Boolean,
    actionsEnabled: Boolean,
    deletionActionEnabled: Boolean,
    onPick: () -> Unit,
    onResume: () -> Unit,
    onRetry: () -> Unit,
    onContinueCloudDeletion: () -> Unit
) {
    val copy = emptyDiscoveryCopy(
        paused,
        access,
        automaticMode,
        progress,
        cloudDeletionUnresolved
    )
    val isStarterState = copy.starterSuggestions.isNotEmpty()
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (isStarterState) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            }
        )
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(copy.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(copy.body, style = MaterialTheme.typography.bodyMedium)
            if (isStarterState) {
                Text(
                    "适合开始的照片",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.secondary,
                    fontWeight = FontWeight.SemiBold
                )
                BoxWithConstraints {
                    val stacked = shouldStackStarterSuggestions(maxWidth.value, LocalDensity.current.fontScale)
                    if (stacked) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            copy.starterSuggestions.forEach { suggestion ->
                                StarterSuggestion(suggestion, Modifier.fillMaxWidth())
                            }
                        }
                    } else {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            copy.starterSuggestions.forEach { suggestion ->
                                StarterSuggestion(suggestion, Modifier.weight(1f))
                            }
                        }
                    }
                }
            }
            Button(
                onClick = when (copy.action) {
                    EmptyDiscoveryAction.PICK -> onPick
                    EmptyDiscoveryAction.RESUME -> onResume
                    EmptyDiscoveryAction.RETRY -> onRetry
                    EmptyDiscoveryAction.CONTINUE_CLOUD_DELETION -> onContinueCloudDeletion
                },
                enabled = if (copy.action == EmptyDiscoveryAction.CONTINUE_CLOUD_DELETION) {
                    deletionActionEnabled
                } else {
                    actionsEnabled
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text(copy.actionLabel) }
            copy.footnote?.let { footnote ->
                Text(
                    footnote,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun StarterSuggestion(label: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.78f),
        shape = RoundedCornerShape(14.dp)
    ) {
        Text(
            label,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp),
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun DailyCardSectionHeader(section: CardDateSection) {
    val title = when (section) {
        CardDateSection.TODAY -> "今天"
        CardDateSection.HISTORY -> "往日"
        CardDateSection.UPCOMING -> "即将展示"
    }
    Text(
        title,
        modifier = Modifier.semantics { heading() },
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onBackground,
        fontWeight = FontWeight.SemiBold
    )
}

@Composable
private fun KnowledgeCardView(
    card: KnowledgeCard,
    currentDay: LocalDate,
    trackedItem: TrackedItem?,
    feedbackState: CardFeedbackState?,
    isSaved: Boolean,
    actionsEnabled: Boolean,
    onFeedback: (String, FeedbackAction) -> Unit,
    onSetSaved: (String, Boolean) -> Unit,
    onTrack: (ItemReminderSubmission) -> Unit,
    onCancelReminder: (String) -> Unit,
    onEngagement: () -> Unit,
    widgetInstallAction: (() -> Unit)? = null
) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val safeSources = remember(card.sources) {
        card.sources.mapNotNull { source ->
            normalizedSafeKnowledgeSourceUrl(source.url)?.let { source.copy(url = it) }
        }
    }
    var showReminderDialog by rememberSaveable(card.cardId) { mutableStateOf(false) }
    var showCancelReminderDialog by rememberSaveable(card.cardId) { mutableStateOf(false) }
    var showWrongObjectFeedbackDialog by rememberSaveable(card.cardId) { mutableStateOf(false) }
    var showPrivateFeedbackDialog by rememberSaveable(card.cardId) { mutableStateOf(false) }
    if (showReminderDialog) {
        ItemReminderDialog(
            card = card,
            existing = trackedItem,
            onDismiss = { showReminderDialog = false },
            actionsEnabled = actionsEnabled,
            onConfirm = {
                showReminderDialog = false
                onTrack(it)
            }
        )
    }
    if (showCancelReminderDialog) {
        AlertDialog(
            onDismissRequest = { showCancelReminderDialog = false },
            title = { Text("取消物品提醒？") },
            text = { Text("将取消「${card.title}」在本机的待提醒任务，并在联网且分析未暂停时撤销云端记录。") },
            confirmButton = {
                TextButton(onClick = {
                    showCancelReminderDialog = false
                    onCancelReminder(card.cardId)
                }, enabled = actionsEnabled) { Text("确认取消") }
            },
            dismissButton = {
                TextButton(onClick = { showCancelReminderDialog = false }) { Text("保留提醒") }
            }
        )
    }
    if (showPrivateFeedbackDialog) {
        AlertDialog(
            onDismissRequest = { showPrivateFeedbackDialog = false },
            title = { Text("将这张照片标记为太私人？") },
            text = {
                Text(
                    "确认后会立即删除这张知识卡、取消对应提醒，并在本次安装中停止分析这张照片。" +
                        "卸载应用或清除应用数据后，这项排除会被重置。"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showPrivateFeedbackDialog = false
                    onFeedback(card.cardId, FeedbackAction.TOO_PRIVATE)
                }, enabled = actionsEnabled) { Text("删除并停止分析") }
            },
            dismissButton = {
                TextButton(onClick = { showPrivateFeedbackDialog = false }) { Text("保留卡片") }
            }
        )
    }
    if (showWrongObjectFeedbackDialog) {
        AlertDialog(
            onDismissRequest = { showWrongObjectFeedbackDialog = false },
            title = { Text("确认这张卡识错了？") },
            text = {
                Text(
                    "确认后会隐藏这张卡、取消它的收藏和物品提醒，并把“识错了”同步给见微。" +
                        "这个判断不会作为兴趣信号。"
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showWrongObjectFeedbackDialog = false
                        onFeedback(card.cardId, FeedbackAction.WRONG_OBJECT)
                    },
                    enabled = actionsEnabled
                ) { Text("确认识错并隐藏") }
            },
            dismissButton = {
                TextButton(onClick = { showWrongObjectFeedbackDialog = false }) {
                    Text("保留卡片")
                }
            }
        )
    }
    Card(
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column {
            PhotoThumbnail(
                card.photoUri,
                contentDescription = "${card.title}的原照片缩略图",
                modifier = Modifier.fillMaxWidth(),
                availableHeight = 190.dp,
                unavailableHeight = 68.dp
            )
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val recognition = cardRecognitionPresentation(card.title, card.detectedObjectName, card.confidence)
                val datePresentation = cardDatePresentation(card.scheduledDate, currentDay)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            datePresentation.visibleLabel,
                            modifier = Modifier.semantics {
                                contentDescription = datePresentation.accessibilityLabel
                            },
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.secondary,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            card.title,
                            style = MaterialTheme.typography.headlineSmall.copy(lineBreak = LineBreak.Heading),
                            fontWeight = FontWeight.Bold
                        )
                    }
                    if (isSaved) {
                        Surface(
                            color = MaterialTheme.colorScheme.primaryContainer,
                            shape = RoundedCornerShape(20.dp)
                        ) {
                            Text(
                                "已收藏",
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                }
                Text(
                    cardBodyForDisplay(card.title, card.body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    recognition.visibleLabel,
                    modifier = Modifier.semantics {
                        contentDescription = recognition.accessibilityLabel
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Medium
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        "为什么推给你",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(card.personalContext, style = MaterialTheme.typography.bodySmall)
                    safeSources.forEachIndexed { index, source ->
                        val sourcePresentation = knowledgeSourcePresentation(
                            source = source,
                            index = index,
                            total = safeSources.size
                        )
                        TextButton(
                            onClick = {
                                val opened = runCatching { uriHandler.openUri(source.url) }.isSuccess
                                if (opened) {
                                    onEngagement()
                                } else {
                                    Toast.makeText(context, "来源链接暂不可用", Toast.LENGTH_SHORT).show()
                                }
                            },
                            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .semantics {
                                    contentDescription = sourcePresentation.accessibilityLabel
                                }
                        ) {
                            Column(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalAlignment = Alignment.Start,
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    sourcePresentation.eyebrow,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                                sourcePresentation.title?.let { title ->
                                    Text(
                                        title,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                    if (safeSources.isEmpty()) {
                        Text("来源链接暂不可用", style = MaterialTheme.typography.bodySmall)
                    }
                }
                widgetInstallAction?.let { WidgetCallToAction(it) }
                BoxWithConstraints {
                    val stacked = shouldStackKnowledgeCardActions(maxWidth.value, LocalDensity.current.fontScale)
                    if (stacked) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = { onSetSaved(card.cardId, !isSaved) },
                                enabled = actionsEnabled,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (isSaved) "取消收藏" else "收藏")
                            }
                            OutlinedButton(
                                onClick = { showReminderDialog = true },
                                enabled = actionsEnabled,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (trackedItem == null) "物品提醒" else "更新提醒")
                            }
                        }
                    } else {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(
                                onClick = { onSetSaved(card.cardId, !isSaved) },
                                enabled = actionsEnabled,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(if (isSaved) "取消收藏" else "收藏")
                            }
                            OutlinedButton(
                                onClick = { showReminderDialog = true },
                                enabled = actionsEnabled,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(if (trackedItem == null) "物品提醒" else "更新提醒")
                            }
                        }
                    }
                }
                trackedItem?.let { reminder ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("物品提醒已开启", fontWeight = FontWeight.SemiBold)
                            Text(
                                "开始使用：${reminder.startedOn.chineseDateLabel()}",
                                style = MaterialTheme.typography.bodySmall
                            )
                            Text(
                                "复查周期：${reminder.reminderDays} 天 · 预计 ${reminder.dueOn.chineseDateLabel()} 上午提醒",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
                if (trackedItem != null) {
                    TextButton(onClick = { showCancelReminderDialog = true }, modifier = Modifier.fillMaxWidth(), enabled = actionsEnabled) {
                        Text("取消物品提醒")
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                        Text(
                            if (feedbackState == null) "这条知识怎么样？" else "见微学到了什么",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold
                        )
                        if (shouldOfferOrdinaryFeedback(feedbackState)) {
                            Text(
                                "有意思/没意思会调准推荐；识错了会隐藏，太私人会删除并停止分析。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            BoxWithConstraints {
                                val stacked = shouldStackFeedbackChoices(
                                    maxWidth.value,
                                    LocalDensity.current.fontScale
                                )
                                if (stacked) {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        FeedbackChoiceButton(
                                            action = FeedbackAction.LIKE,
                                            enabled = actionsEnabled,
                                            modifier = Modifier.fillMaxWidth(),
                                            onSelect = { onFeedback(card.cardId, it) }
                                        )
                                        FeedbackChoiceButton(
                                            action = FeedbackAction.DISLIKE,
                                            enabled = actionsEnabled,
                                            modifier = Modifier.fillMaxWidth(),
                                            onSelect = { onFeedback(card.cardId, it) }
                                        )
                                        FeedbackChoiceButton(
                                            action = FeedbackAction.WRONG_OBJECT,
                                            enabled = actionsEnabled,
                                            modifier = Modifier.fillMaxWidth(),
                                            onSelect = { showWrongObjectFeedbackDialog = true }
                                        )
                                        FeedbackChoiceButton(
                                            action = FeedbackAction.TOO_PRIVATE,
                                            enabled = actionsEnabled,
                                            modifier = Modifier.fillMaxWidth(),
                                            onSelect = { showPrivateFeedbackDialog = true }
                                        )
                                    }
                                } else {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            FeedbackChoiceButton(
                                                action = FeedbackAction.LIKE,
                                                enabled = actionsEnabled,
                                                modifier = Modifier.weight(1f),
                                                onSelect = { onFeedback(card.cardId, it) }
                                            )
                                            FeedbackChoiceButton(
                                                action = FeedbackAction.DISLIKE,
                                                enabled = actionsEnabled,
                                                modifier = Modifier.weight(1f),
                                                onSelect = { onFeedback(card.cardId, it) }
                                            )
                                        }
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            FeedbackChoiceButton(
                                                action = FeedbackAction.WRONG_OBJECT,
                                                enabled = actionsEnabled,
                                                modifier = Modifier.weight(1f),
                                                onSelect = { showWrongObjectFeedbackDialog = true }
                                            )
                                            FeedbackChoiceButton(
                                                action = FeedbackAction.TOO_PRIVATE,
                                                enabled = actionsEnabled,
                                                modifier = Modifier.weight(1f),
                                                onSelect = { showPrivateFeedbackDialog = true }
                                            )
                                        }
                                    }
                                }
                            }
                        } else {
                            val learning = feedbackLearningPresentation(
                                action = requireNotNull(feedbackState).action,
                                detectedObjectName = card.detectedObjectName
                            )
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 6.dp)
                                    .semantics {
                                        stateDescription = "已反馈${feedbackState?.action?.userLabel().orEmpty()}"
                                    },
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    learning.title,
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    learning.body,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(
                                "如果对象不对，或这张照片不该继续保留，你仍可以纠正。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            BoxWithConstraints {
                                val stacked = shouldStackFeedbackChoices(
                                    maxWidth.value,
                                    LocalDensity.current.fontScale
                                )
                                if (stacked) {
                                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        TextButton(
                                            onClick = { showWrongObjectFeedbackDialog = true },
                                            enabled = actionsEnabled,
                                            modifier = Modifier.fillMaxWidth()
                                        ) { Text(FeedbackAction.WRONG_OBJECT.userLabel()) }
                                        TextButton(
                                            onClick = { showPrivateFeedbackDialog = true },
                                            enabled = actionsEnabled,
                                            modifier = Modifier.fillMaxWidth()
                                        ) { Text(FeedbackAction.TOO_PRIVATE.userLabel()) }
                                    }
                                } else {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        TextButton(
                                            onClick = { showWrongObjectFeedbackDialog = true },
                                            enabled = actionsEnabled,
                                            modifier = Modifier.weight(1f)
                                        ) { Text(FeedbackAction.WRONG_OBJECT.userLabel()) }
                                        TextButton(
                                            onClick = { showPrivateFeedbackDialog = true },
                                            enabled = actionsEnabled,
                                            modifier = Modifier.weight(1f)
                                        ) { Text(FeedbackAction.TOO_PRIVATE.userLabel()) }
                                    }
                                }
                            }
                        }
                }
            }
        }
    }
}

@Composable
private fun FeedbackChoiceButton(
    action: FeedbackAction,
    enabled: Boolean,
    modifier: Modifier,
    onSelect: (FeedbackAction) -> Unit
) {
    OutlinedButton(
        onClick = { onSelect(action) },
        enabled = enabled,
        modifier = modifier
    ) {
        Text(action.userLabel())
    }
}

internal data class ItemReminderSubmission(
    val cardId: String,
    val startedOn: LocalDate,
    val reminderDays: Int
)

@Composable
private fun ItemReminderDialog(
    card: KnowledgeCard,
    existing: TrackedItem?,
    onDismiss: () -> Unit,
    actionsEnabled: Boolean,
    onConfirm: (ItemReminderSubmission) -> Unit
) {
    val context = LocalContext.current
    val today = cn.jianwei.domain.time.ChinaCalendar.today()
    var startedOnEpochDay by rememberSaveable(card.cardId, existing?.startedOn) {
        mutableLongStateOf(existing?.startedOn?.toEpochDay() ?: today.toEpochDay())
    }
    var reminderDays by rememberSaveable(card.cardId, existing?.reminderDays) {
        mutableIntStateOf(existing?.reminderDays ?: 90)
    }
    var timingConfirmed by rememberSaveable(card.cardId, existing?.startedOn, existing?.reminderDays) {
        mutableStateOf(false)
    }
    val startedOn = LocalDate.ofEpochDay(startedOnEpochDay)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                if (existing == null) {
                    "为「${card.detectedObjectName}」设复查提醒"
                } else {
                    "更新「${card.detectedObjectName}」的复查提醒"
                }
            )
        },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("时间由你确认", fontWeight = FontWeight.SemiBold)
                        Text(
                            "见微不会从照片猜测这个物品用了多久，只会按你填写的日期提醒。",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
                Text("开始使用日", fontWeight = FontWeight.SemiBold)
                OutlinedButton(
                    onClick = {
                        DatePickerDialog(
                            context,
                            { _, year, month, day ->
                                startedOnEpochDay = LocalDate.of(year, month + 1, day).toEpochDay()
                                timingConfirmed = false
                            },
                            startedOn.year,
                            startedOn.monthValue - 1,
                            startedOn.dayOfMonth
                        ).apply {
                            datePicker.maxDate = System.currentTimeMillis()
                        }.show()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("${startedOn.chineseDateLabel()} · 点击修改") }
                Text("多久后复查", fontWeight = FontWeight.SemiBold)
                ITEM_REMINDER_DAY_OPTIONS.chunked(2).forEach { rowOptions ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        rowOptions.forEach { option ->
                            if (option == reminderDays) {
                                Button(
                                    onClick = {
                                        reminderDays = option
                                        timingConfirmed = false
                                    },
                                    modifier = Modifier.weight(1f)
                                ) { Text("$option 天") }
                            } else {
                                OutlinedButton(
                                    onClick = {
                                        reminderDays = option
                                        timingConfirmed = false
                                    },
                                    modifier = Modifier.weight(1f)
                                ) { Text("$option 天") }
                            }
                        }
                        if (rowOptions.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("预计复查日", style = MaterialTheme.typography.labelMedium)
                        Text(
                            startedOn.plusDays(reminderDays.toLong()).chineseDateLabel(),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            "当天上午 9:00 左右通知；系统省电可能造成延迟。",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .toggleable(
                                value = timingConfirmed,
                                role = Role.Checkbox,
                                onValueChange = { timingConfirmed = it }
                            )
                            .padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(checked = timingConfirmed, onCheckedChange = null)
                        Text("我确认以上开始使用日和复查周期", style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text(
                    "这是自定义复查提醒，不代表专业更换建议；请优先遵循产品说明或专业建议。若尚未授权，确认后再由系统请求通知权限。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onConfirm(ItemReminderSubmission(card.cardId, startedOn, reminderDays))
                },
                enabled = actionsEnabled &&
                    timingConfirmed &&
                    isValidItemReminderDraft(startedOn, reminderDays, today)
            ) { Text(if (existing == null) "确认并开启提醒" else "保存提醒") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

private fun LocalDate.chineseDateLabel(): String = "$year 年 $monthValue 月 $dayOfMonth 日"

@Composable
private fun PrivacyCenter(
    access: PhotoAccess,
    automaticMode: AutomaticCardMode,
    automaticDiscoveryEnabled: Boolean,
    widgetInstalled: Boolean,
    paused: Boolean,
    cloudDeletionUnresolved: Boolean,
    actionsEnabled: Boolean,
    deletionActionEnabled: Boolean,
    onPick: () -> Unit,
    onManageAutomaticDiscovery: () -> Unit,
    onDisableAutomaticDiscovery: () -> Unit,
    onAddWidget: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onClearIndex: () -> Unit,
    onDeleteCloud: () -> Unit,
    onExportMetrics: () -> Unit
) {
    val automaticControl = automaticDiscoveryControl(
        access,
        automaticMode,
        automaticDiscoveryEnabled
    )
    var showLocalIndexClearConfirmation by rememberSaveable { mutableStateOf(false) }
    var showCloudDeleteConfirmation by rememberSaveable { mutableStateOf(false) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    Card(
        modifier = Modifier.padding(vertical = 16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("你的数据与隐私", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    photoAccessSummary(access, automaticMode, automaticDiscoveryEnabled),
                    style = MaterialTheme.typography.bodySmall
                )
                if (cloudDeletionUnresolved) {
                    Text(
                        "云端删除尚未完成；分析保持暂停，完成前不会接收新照片",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                } else if (paused) {
                    Text(
                        "分析已暂停，不会继续扫描、上传或同步",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            OutlinedButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
                Text(if (expanded) "收起隐私与数据" else "管理隐私与数据")
            }
            if (expanded) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (cloudDeletionUnresolved) {
                        Text(
                            "见微保留了加密恢复信息，用来完成你已经确认的删除。此时不会恢复分析、创建新匿名身份或导入新照片。",
                            style = MaterialTheme.typography.bodySmall
                        )
                        Button(
                            onClick = onDeleteCloud,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = deletionActionEnabled
                        ) { Text("继续删除云端数据") }
                    } else if (automaticControl != null) {
                        Text(
                            "照片发现方式",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(automaticControl.explanation, style = MaterialTheme.typography.bodySmall)
                        if (automaticControl.emphasized) {
                            Button(
                                onClick = onManageAutomaticDiscovery,
                                modifier = Modifier.fillMaxWidth(),
                                enabled = actionsEnabled
                            ) { Text(automaticControl.actionLabel) }
                        } else {
                            OutlinedButton(
                                onClick = onManageAutomaticDiscovery,
                                modifier = Modifier.fillMaxWidth(),
                                enabled = actionsEnabled
                            ) { Text(automaticControl.actionLabel) }
                        }
                    }
                    if (!cloudDeletionUnresolved && automaticDiscoveryEnabled) {
                        OutlinedButton(
                            onClick = onDisableAutomaticDiscovery,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = actionsEnabled
                        ) { Text("关闭自动发现") }
                    }
                    if (!cloudDeletionUnresolved) {
                        OutlinedButton(onClick = onPick, modifier = Modifier.fillMaxWidth(), enabled = actionsEnabled) { Text("选择照片导入") }
                    }
                    OutlinedButton(
                        onClick = onAddWidget,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = if (cloudDeletionUnresolved) deletionActionEnabled else actionsEnabled
                    ) {
                        Text(widgetManagementActionLabel(widgetInstalled))
                    }
                    if (!cloudDeletionUnresolved) {
                        OutlinedButton(onClick = if (paused) onResume else onPause, modifier = Modifier.fillMaxWidth(), enabled = actionsEnabled) {
                            Text(if (paused) "恢复分析" else "暂停分析")
                        }
                        OutlinedButton(
                            onClick = { showLocalIndexClearConfirmation = true },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = actionsEnabled
                        ) { Text("清除本地照片索引") }
                        OutlinedButton(onClick = { showCloudDeleteConfirmation = true }, modifier = Modifier.fillMaxWidth(), enabled = actionsEnabled) { Text("删除云端数据") }
                    }
                    OutlinedButton(onClick = onExportMetrics, modifier = Modifier.fillMaxWidth()) { Text("导出内测报告") }
                    Text("系统相册权限只控制自动发现；你曾逐次选择或分享导入的照片是独立同意。如需终止所有待处理任务，请点“暂停分析”。", style = MaterialTheme.typography.bodySmall)
                    Text("暂停状态会跨重启保留，手动恢复前不再扫描、上传或同步卡片。清除本地索引会先暂停分析，并删除逐次导入的应用内副本和卡片照片引用；知识卡正文、收藏和提醒保留。删除云端数据也会暂停分析，并清除匿名设备身份、待处理任务和云端卡片；本地原照片不会被删除。", style = MaterialTheme.typography.bodySmall)
                    Text("内测报告由你主动导出，只含计数、时间、App 版本、机型、系统版本和系统构建指纹；不含照片、标签、位置、相册 ID、安装身份或设备令牌。", style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(
                "见微 ${BuildConfig.VERSION_NAME} · 内测版",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
    if (showLocalIndexClearConfirmation) {
        AlertDialog(
            onDismissRequest = { showLocalIndexClearConfirmation = false },
            title = { Text("确认清除本地照片索引？") },
            text = {
                Text(
                    "这会先暂停全部分析，再删除本机照片索引、逐次选择或分享后保存在应用内的副本，" +
                        "以及知识卡上的照片引用。知识正文、收藏和物品提醒会保留；系统相册与其他应用中的原图不会被删除。" +
                        "恢复分析后，见微才会重新建立索引。"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showLocalIndexClearConfirmation = false
                    onClearIndex()
                }, enabled = actionsEnabled) { Text("暂停并清除") }
            },
            dismissButton = {
                TextButton(onClick = { showLocalIndexClearConfirmation = false }) { Text("保留本地索引") }
            }
        )
    }
    if (showCloudDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showCloudDeleteConfirmation = false },
            title = { Text("确认删除云端数据？") },
            text = {
                Text(
                    "这会暂停分析，并永久删除当前匿名设备在服务端的卡片和未完成任务。" +
                        "若删除尚未确认，分析仍会保持暂停，并保留恢复信息供你联网后重试；" +
                        "本地原照片不会被删除。"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showCloudDeleteConfirmation = false
                    onDeleteCloud()
                }, enabled = deletionActionEnabled) { Text("确认删除") }
            },
            dismissButton = { TextButton(onClick = { showCloudDeleteConfirmation = false }) { Text("取消") } }
        )
    }
}

private data class PhotoThumbnailLoadState(
    val isLoading: Boolean,
    val bitmap: android.graphics.Bitmap?
)

@Composable
private fun PhotoThumbnail(
    uri: String,
    contentDescription: String,
    modifier: Modifier = Modifier,
    maxSidePx: Int = DETAIL_THUMBNAIL_MAX_SIDE_PX,
    availableHeight: Dp? = null,
    unavailableHeight: Dp? = null
) {
    val context = LocalContext.current
    val loadState by produceState(
        initialValue = PhotoThumbnailLoadState(isLoading = uri.isNotBlank(), bitmap = null),
        uri,
        maxSidePx
    ) {
        value = if (uri.isBlank()) {
            PhotoThumbnailLoadState(isLoading = false, bitmap = null)
        } else {
            val decoded = withContext(Dispatchers.IO) {
                runCatching {
                    decodeBoundedThumbnail(context.contentResolver, Uri.parse(uri), maxSidePx)
                }.getOrNull()
            }
            PhotoThumbnailLoadState(isLoading = false, bitmap = decoded)
        }
    }
    val displayBitmap = loadState.bitmap
    DisposableEffect(displayBitmap) {
        onDispose { displayBitmap?.takeUnless { it.isRecycled }?.recycle() }
    }
    val resolvedModifier = availableHeight?.let { fullHeight ->
        val height = if (!loadState.isLoading && displayBitmap == null) {
            unavailableHeight ?: fullHeight
        } else {
            fullHeight
        }
        modifier.height(height)
    } ?: modifier
    val accessibleModifier = if (!loadState.isLoading && displayBitmap == null) {
        resolvedModifier.clearAndSetSemantics {
            this.contentDescription = PHOTO_THUMBNAIL_UNAVAILABLE_LABEL
        }
    } else {
        resolvedModifier
    }
    Box(
        accessibleModifier.background(androidx.compose.ui.graphics.Color(0xFFDDE5DD)),
        contentAlignment = Alignment.Center
    ) {
        when {
            displayBitmap != null -> Image(
                displayBitmap.asImageBitmap(),
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
            loadState.isLoading -> CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.primary
            )
            else -> Text(
                PHOTO_THUMBNAIL_UNAVAILABLE_LABEL,
                modifier = Modifier
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .clearAndSetSemantics { },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

private const val DETAIL_THUMBNAIL_MAX_SIDE_PX = 1280
private const val SAVED_PREVIEW_THUMBNAIL_MAX_SIDE_PX = 320
private const val ONBOARDING_BROOM_SOURCE_URL =
    "https://patents.google.com/patent/US4756039A/en"

private fun requestPinDailyWidget(context: android.content.Context) {
    val manager = AppWidgetManager.getInstance(context)
    if (!manager.isRequestPinAppWidgetSupported) {
        Toast.makeText(context, "请长按桌面，从小组件列表添加见微", Toast.LENGTH_LONG).show()
        return
    }
    val accepted = manager.requestPinAppWidget(ComponentName(context, DailyWidgetReceiver::class.java), null, null)
    if (!accepted) Toast.makeText(context, "请在系统弹窗中确认添加组件", Toast.LENGTH_SHORT).show()
}
