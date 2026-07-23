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
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.edit
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import cn.jianwei.app.widget.DailyWidget
import cn.jianwei.app.widget.DailyWidgetReceiver
import cn.jianwei.data.photos.decodeBoundedThumbnail
import androidx.glance.appwidget.updateAll
import cn.jianwei.domain.card.cardRecognitionPresentation
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.TrackedItem
import cn.jianwei.domain.model.normalizedSafeKnowledgeSourceUrl
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import java.io.IOException
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()
    @Inject lateinit var betaMetrics: BetaMetricsStore
    private var photoAccess by mutableStateOf(PhotoAccess.PICKER_ONLY)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        viewModel.focusCard(intent.getStringExtra(EXTRA_CARD_ID))
        photoAccess = currentPhotoAccess(this)
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
                var pendingReminderCardTitle by rememberSaveable { mutableStateOf<String?>(null) }
                var pendingReminderStartedOn by rememberSaveable { mutableLongStateOf(Long.MIN_VALUE) }
                var pendingReminderDays by rememberSaveable { mutableIntStateOf(0) }
                val completeOnboarding = {
                    preferences.edit { putBoolean("completed", true) }
                    onboarded = true
                    betaMetrics.markOnboardingCompleted()
                }
                val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                    val cardId = pendingReminderCardId
                    val title = pendingReminderCardTitle
                    val startedOn = pendingReminderStartedOn
                        .takeIf { it != Long.MIN_VALUE }
                        ?.let(LocalDate::ofEpochDay)
                    val reminderDays = pendingReminderDays
                    pendingReminderCardId = null
                    pendingReminderCardTitle = null
                    pendingReminderStartedOn = Long.MIN_VALUE
                    pendingReminderDays = 0
                    if (
                        granted &&
                        cardId != null &&
                        title != null &&
                        startedOn != null &&
                        NotificationManagerCompat.from(context).areNotificationsEnabled()
                    ) {
                        viewModel.track(cardId, title, startedOn, reminderDays)
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
                val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
                    completeOnboarding()
                    photoAccess = currentPhotoAccess(context)
                    viewModel.startDiscovery(photoAccess)
                }
                val choosePhotos = {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
                val addWidget = { requestPinDailyWidget(context) }
                val submitReminder: (ItemReminderSubmission) -> Unit = { submission ->
                    val permissionGranted = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) == PackageManager.PERMISSION_GRANTED
                    if (!permissionGranted) {
                        pendingReminderCardId = submission.cardId
                        pendingReminderCardTitle = submission.cardTitle
                        pendingReminderStartedOn = submission.startedOn.toEpochDay()
                        pendingReminderDays = submission.reminderDays
                        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                        Toast.makeText(context, "请先在系统设置中开启见微通知，再建立物品提醒", Toast.LENGTH_LONG).show()
                    } else {
                        viewModel.track(
                            submission.cardId,
                            submission.cardTitle,
                            submission.startedOn,
                            submission.reminderDays
                        )
                    }
                }
                val saveInterests: (Set<String>) -> Unit = { interests ->
                    preferences.edit { putStringSet("interests", interests) }
                }

                if (!onboarded) {
                    Onboarding(
                        onAutomatic = { interests ->
                            saveInterests(interests)
                            permission.launch(requiredPhotoPermissions())
                        },
                        onPick = { interests ->
                            saveInterests(interests)
                            completeOnboarding()
                            choosePhotos()
                        }
                    )
                } else {
                    LaunchedEffect(Unit) {
                        betaMetrics.markOnboardingCompleted()
                        viewModel.ensureDailyRefresh(photoAccess)
                        if (state.cards.isNotEmpty()) betaMetrics.markFirstCardObserved()
                    }
                    LaunchedEffect(state.cards.isNotEmpty()) {
                        if (state.cards.isNotEmpty()) betaMetrics.markFirstCardObserved()
                    }
                    HomeScreen(
                        state = state,
                        access = photoAccess,
                        onPick = choosePhotos,
                        onAddWidget = addWidget,
                        onFeedback = viewModel::feedback,
                        onSetSaved = viewModel::setSaved,
                        onNeverAnalyze = viewModel::neverAnalyze,
                        onTrack = submitReminder,
                        onCancelReminder = viewModel::cancelReminder,
                        onEngagement = betaMetrics::markEngaged,
                        onPause = viewModel::pauseAnalysis,
                        onResume = { viewModel.resume(photoAccess) },
                        onRetry = { viewModel.retry(photoAccess) },
                        onClearIndex = viewModel::clearLocalIndex,
                        onDeleteCloud = viewModel::deleteCloudData,
                        onExportMetrics = ::shareBetaMetrics,
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
        viewModel.focusCard(intent.getStringExtra(EXTRA_CARD_ID))
    }

    override fun onResume() {
        super.onResume()
        photoAccess = currentPhotoAccess(this)
        viewModel.refreshCurrentDay()
        if (getSharedPreferences("onboarding", MODE_PRIVATE).getBoolean("completed", false)) {
            viewModel.reconcilePhotoAccess(photoAccess)
        }
        if (::betaMetrics.isInitialized && hasDailyWidget()) betaMetrics.markWidgetObserved()
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
    }
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

@Composable
private fun Onboarding(onAutomatic: (Set<String>) -> Unit, onPick: (Set<String>) -> Unit) {
    var step by remember { mutableIntStateOf(0) }
    val pages = listOf(
        "让日常照片重新开口" to "见微会从你授权的照片中，挑一件普通物品，讲一个值得今天知道的细节。",
        "先在手机里筛选" to "人脸、截图、证件、高文字图片和模糊照片会先在端侧尝试过滤；候选副本会去除 EXIF。",
        "你随时拥有控制权" to "原图不建立云端照片库。关闭系统相册权限只会停止自动发现；你逐次选择或分享导入的照片仍按当时同意处理。“暂停分析”会停止全部待处理任务。"
    )
    val interests = remember { mutableStateOf(setOf("生活设计", "物件历史", "科学原理")) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            Column {
                Text(
                    "见微",
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
                Text("照片里的日常知识", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(28.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pages.indices.forEach { index ->
                        Box(
                            Modifier.weight(1f).height(4.dp).background(
                                color = if (index <= step) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(20.dp)
                            )
                        )
                    }
                }
                Spacer(Modifier.height(28.dp))
                Text(pages[step].first, style = MaterialTheme.typography.headlineMedium)
                Spacer(Modifier.height(16.dp))
                Text(pages[step].second, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (step == 2) {
                    Spacer(Modifier.height(24.dp))
                    Text("先选 3 个兴趣", fontWeight = FontWeight.SemiBold)
                    listOf("生活设计", "物件历史", "科学原理", "实用技巧", "制造工艺").forEach { interest ->
                        val selected = interest in interests.value
                        Row(
                            Modifier.fillMaxWidth().toggleable(
                                value = selected,
                                role = Role.Checkbox,
                                onValueChange = { checked ->
                                    interests.value = if (checked && interests.value.size < 3) interests.value + interest
                                    else if (!checked) interests.value - interest else interests.value
                                }
                            ).padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Checkbox(
                                checked = selected,
                                onCheckedChange = null,
                                // The whole labelled row is the single checkbox target.
                                modifier = Modifier.clearAndSetSemantics { }
                            )
                            Text(interest)
                        }
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (step < 2) Button(onClick = { step++ }, modifier = Modifier.fillMaxWidth()) { Text("继续") }
                else {
                    Button(onClick = { onAutomatic(interests.value) }, modifier = Modifier.fillMaxWidth(), enabled = interests.value.size == 3) {
                        Text("自动发现（推荐）")
                    }
                    OutlinedButton(onClick = { onPick(interests.value) }, modifier = Modifier.fillMaxWidth(), enabled = interests.value.size == 3) {
                        Text("仅选择照片")
                    }
                }
                Text("${step + 1} / 3", modifier = Modifier.align(Alignment.CenterHorizontally))
            }
        }
    }
}

@Composable
private fun HomeScreen(
    state: MainUiState,
    access: PhotoAccess,
    onPick: () -> Unit,
    onAddWidget: () -> Unit,
    onFeedback: (String, FeedbackAction) -> Unit,
    onSetSaved: (String, Boolean) -> Unit,
    onNeverAnalyze: (String) -> Unit,
    onTrack: (ItemReminderSubmission) -> Unit,
    onCancelReminder: (String) -> Unit,
    onEngagement: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onRetry: () -> Unit,
    onClearIndex: () -> Unit,
    onDeleteCloud: () -> Unit,
    onExportMetrics: () -> Unit,
    onMessageShown: () -> Unit
) {
    val snackbar = remember { SnackbarHostState() }
    val fontScale = LocalDensity.current.fontScale
    var showSavedCards by rememberSaveable { mutableStateOf(false) }
    val visibleCards = if (showSavedCards) state.savedCards else state.cards
    val savedCardIds = state.savedCards.mapTo(remember(state.savedCards) { mutableSetOf() }) { it.cardId }
    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); onMessageShown() }
    }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("见微", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("照片权限：${accessLabel(access)}", style = MaterialTheme.typography.labelMedium)
                }
                if (state.busy || isAnalysisActive(state.analysisProgress)) {
                    CircularProgressIndicator(
                        Modifier.size(24.dp).semantics {
                            contentDescription = "照片分析"
                            stateDescription = "正在处理"
                            liveRegion = LiveRegionMode.Polite
                        },
                        strokeWidth = 2.dp
                    )
                }
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                BoxWithConstraints {
                    val compactLabels = shouldUseCompactTabLabels(maxWidth.value, fontScale)
                    val dailyTabLabel = if (compactLabels) "每日" else "每日卡片"
                    val savedTabLabel = "收藏 ${state.savedCards.size}"
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (showSavedCards) {
                            OutlinedButton(
                                onClick = { showSavedCards = false },
                                modifier = Modifier.weight(1f).semantics {
                                    role = Role.Tab
                                    selected = false
                                    contentDescription = "每日卡片"
                                }
                            ) { Text(dailyTabLabel) }
                            Button(
                                onClick = { },
                                modifier = Modifier.weight(1f).semantics {
                                    role = Role.Tab
                                    selected = true
                                    contentDescription = savedTabLabel
                                }
                            ) { Text(savedTabLabel) }
                        } else {
                            Button(
                                onClick = { },
                                modifier = Modifier.weight(1f).semantics {
                                    role = Role.Tab
                                    selected = true
                                    contentDescription = "每日卡片"
                                }
                            ) { Text(dailyTabLabel) }
                            OutlinedButton(
                                onClick = { showSavedCards = true },
                                modifier = Modifier.weight(1f).semantics {
                                    role = Role.Tab
                                    selected = false
                                    contentDescription = savedTabLabel
                                }
                            ) { Text(savedTabLabel) }
                        }
                    }
                }
            }
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
            item {
                if (!showSavedCards && state.cards.isEmpty()) EmptyState(state.paused, access, state.analysisProgress, onPick, onResume, onRetry)
                if (showSavedCards && state.savedCards.isEmpty()) {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("还没有收藏", style = MaterialTheme.typography.titleLarge)
                            Text("看到想留住的知识卡时，点击“收藏这张知识卡”。")
                        }
                    }
                }
            }
            itemsIndexed(visibleCards, key = { _, card -> card.cardId }) { index, card ->
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    KnowledgeCardView(
                        card,
                        state.trackedItems[card.cardId],
                        card.cardId in savedCardIds,
                        onFeedback,
                        onSetSaved,
                        onNeverAnalyze,
                        onTrack,
                        onCancelReminder,
                        onEngagement
                    )
                    if (shouldShowWidgetCallToAction(showSavedCards, index)) {
                        WidgetCallToAction(onAddWidget)
                    }
                }
            }
            item {
                PrivacyCenter(state.paused, onPick, onAddWidget, onPause, onResume, onClearIndex, onDeleteCloud, onExportMetrics)
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
                        Text("添加桌面组件")
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
                        Text("添加桌面组件")
                    }
                }
            }
        }
    }
}

@Composable
private fun WidgetCallToActionCopy(modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text("每天在桌面遇见新知识", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text("添加组件后，无需打开 App 也能看到。", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun EmptyState(
    paused: Boolean,
    access: PhotoAccess,
    progress: cn.jianwei.domain.model.AnalysisProgress,
    onPick: () -> Unit,
    onResume: () -> Unit,
    onRetry: () -> Unit
) {
    val copy = emptyDiscoveryCopy(paused, access, progress)
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(copy.title, style = MaterialTheme.typography.titleLarge)
            Text(copy.body)
            Button(
                onClick = when (copy.action) {
                    EmptyDiscoveryAction.PICK -> onPick
                    EmptyDiscoveryAction.RESUME -> onResume
                    EmptyDiscoveryAction.RETRY -> onRetry
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text(copy.actionLabel) }
        }
    }
}

@Composable
private fun KnowledgeCardView(
    card: KnowledgeCard,
    trackedItem: TrackedItem?,
    isSaved: Boolean,
    onFeedback: (String, FeedbackAction) -> Unit,
    onSetSaved: (String, Boolean) -> Unit,
    onNeverAnalyze: (String) -> Unit,
    onTrack: (ItemReminderSubmission) -> Unit,
    onCancelReminder: (String) -> Unit,
    onEngagement: () -> Unit
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
    if (showReminderDialog) {
        ItemReminderDialog(
            card = card,
            existing = trackedItem,
            onDismiss = { showReminderDialog = false },
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
                }) { Text("确认取消") }
            },
            dismissButton = {
                TextButton(onClick = { showCancelReminderDialog = false }) { Text("保留提醒") }
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
                modifier = Modifier.fillMaxWidth().height(190.dp)
            )
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val recognition = cardRecognitionPresentation(card.title, card.detectedObjectName, card.confidence)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            "今日识物",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.secondary,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(card.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
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
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Text(
                        recognition.visibleLabel,
                        modifier = Modifier
                            .padding(horizontal = 12.dp, vertical = 7.dp)
                            .semantics { contentDescription = recognition.accessibilityLabel },
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
                Text(
                    card.body,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            "为什么是这张照片",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(card.personalContext, style = MaterialTheme.typography.bodySmall)
                        safeSources.forEach { source ->
                            TextButton(
                                onClick = {
                                    val opened = runCatching { uriHandler.openUri(source.url) }.isSuccess
                                    if (opened) {
                                        onEngagement()
                                    } else {
                                        Toast.makeText(context, "来源链接暂不可用", Toast.LENGTH_SHORT).show()
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("查看来源 · ${source.publisher} · ${source.title}")
                            }
                        }
                        if (safeSources.isEmpty()) {
                            Text("来源链接暂不可用", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                BoxWithConstraints {
                    val stacked = shouldStackKnowledgeCardActions(maxWidth.value, LocalDensity.current.fontScale)
                    if (stacked) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { onSetSaved(card.cardId, !isSaved) },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (isSaved) "已收藏 · 点击取消" else "收藏这张知识卡")
                            }
                            OutlinedButton(
                                onClick = { showReminderDialog = true },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (trackedItem == null) "设置物品提醒" else "更新物品提醒")
                            }
                        }
                    } else {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = { onSetSaved(card.cardId, !isSaved) },
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(if (isSaved) "已收藏 · 点击取消" else "收藏这张知识卡")
                            }
                            OutlinedButton(
                                onClick = { showReminderDialog = true },
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(if (trackedItem == null) "设置物品提醒" else "更新物品提醒")
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
                                "启用 ${reminder.startedOn} · ${reminder.reminderDays} 天 · 预计 ${reminder.dueOn} 复查",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
                if (trackedItem != null) {
                    TextButton(onClick = { showCancelReminderDialog = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("取消物品提醒")
                    }
                }
                HorizontalDivider()
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text("这张卡对你有用吗？", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Text("你的选择只用于改进本次安装的推荐。", style = MaterialTheme.typography.bodySmall)
                        FeedbackAction.entries.take(4).chunked(2).forEach { actions ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                actions.forEach { action ->
                                    OutlinedButton(
                                        onClick = { onFeedback(card.cardId, action) },
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Text(action.label())
                                    }
                                }
                            }
                        }
                    }
                }
                TextButton(onClick = { onNeverAnalyze(card.cardId) }, modifier = Modifier.fillMaxWidth()) {
                    Text("在本次安装中不再分析")
                }
            }
        }
    }
}

internal data class ItemReminderSubmission(
    val cardId: String,
    val cardTitle: String,
    val startedOn: LocalDate,
    val reminderDays: Int
)

@Composable
private fun ItemReminderDialog(
    card: KnowledgeCard,
    existing: TrackedItem?,
    onDismiss: () -> Unit,
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
    val startedOn = LocalDate.ofEpochDay(startedOnEpochDay)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "追踪「${card.title}」" else "更新「${card.title}」提醒") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("请确认这个物品开始使用或启用的日期。见微不会让 AI 猜测使用时长。")
                OutlinedButton(
                    onClick = {
                        DatePickerDialog(
                            context,
                            { _, year, month, day ->
                                startedOnEpochDay = LocalDate.of(year, month + 1, day).toEpochDay()
                            },
                            startedOn.year,
                            startedOn.monthValue - 1,
                            startedOn.dayOfMonth
                        ).apply {
                            datePicker.maxDate = System.currentTimeMillis()
                        }.show()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("启用日期：$startedOn（点击修改）") }
                Text("提醒周期", fontWeight = FontWeight.SemiBold)
                ITEM_REMINDER_DAY_OPTIONS.chunked(2).forEach { rowOptions ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        rowOptions.forEach { option ->
                            if (option == reminderDays) {
                                Button(
                                    onClick = { reminderDays = option },
                                    modifier = Modifier.weight(1f)
                                ) { Text("$option 天") }
                            } else {
                                OutlinedButton(
                                    onClick = { reminderDays = option },
                                    modifier = Modifier.weight(1f)
                                ) { Text("$option 天") }
                            }
                        }
                        if (rowOptions.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
                Text(
                    "预计 ${startedOn.plusDays(reminderDays.toLong())} 上午提醒。确认后才会请求通知权限；系统省电可能延迟送达，不承诺精确时间。",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onConfirm(ItemReminderSubmission(card.cardId, card.title, startedOn, reminderDays))
                },
                enabled = isValidItemReminderDraft(startedOn, reminderDays, today)
            ) { Text(if (existing == null) "确认并开启提醒" else "保存提醒") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
private fun PrivacyCenter(
    paused: Boolean,
    onPick: () -> Unit,
    onAddWidget: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onClearIndex: () -> Unit,
    onDeleteCloud: () -> Unit,
    onExportMetrics: () -> Unit
) {
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
                    if (paused) "分析已暂停，你仍可管理本地与云端数据" else "管理照片访问、分析状态与云端数据",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            OutlinedButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
                Text(if (expanded) "收起隐私与数据" else "管理隐私与数据")
            }
            if (expanded) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onPick, modifier = Modifier.fillMaxWidth()) { Text("选择照片导入") }
                    OutlinedButton(onClick = onAddWidget, modifier = Modifier.fillMaxWidth()) { Text("添加桌面组件") }
                    OutlinedButton(onClick = if (paused) onResume else onPause, modifier = Modifier.fillMaxWidth()) {
                        Text(if (paused) "恢复分析" else "暂停分析")
                    }
                    OutlinedButton(onClick = onClearIndex, modifier = Modifier.fillMaxWidth()) { Text("清除本地照片索引") }
                    OutlinedButton(onClick = { showCloudDeleteConfirmation = true }, modifier = Modifier.fillMaxWidth()) { Text("删除云端数据") }
                    OutlinedButton(onClick = onExportMetrics, modifier = Modifier.fillMaxWidth()) { Text("导出内测报告") }
                    Text("系统相册权限只控制自动发现；你曾逐次选择或分享导入的照片是独立同意。如需终止所有待处理任务，请点“暂停分析”。", style = MaterialTheme.typography.bodySmall)
                    Text("暂停状态会跨重启保留，手动恢复前不再扫描、上传或同步卡片。删除云端数据也会暂停分析，并清除匿名设备身份、待处理任务和云端卡片；本地原照片不会被删除。", style = MaterialTheme.typography.bodySmall)
                    Text("内测报告由你主动导出，只含计数、时间、App 版本、机型、系统版本和系统构建指纹；不含照片、标签、位置、相册 ID、安装身份或设备令牌。", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    if (showCloudDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showCloudDeleteConfirmation = false },
            title = { Text("确认删除云端数据？") },
            text = { Text("这会暂停分析，并永久删除当前匿名设备在服务端的卡片和未完成任务。若网络或身份校验失败，本地恢复凭据会保留，方便你重试；本地原照片不会被删除。") },
            confirmButton = {
                TextButton(onClick = {
                    showCloudDeleteConfirmation = false
                    onDeleteCloud()
                }) { Text("确认删除") }
            },
            dismissButton = { TextButton(onClick = { showCloudDeleteConfirmation = false }) { Text("取消") } }
        )
    }
}

@Composable
private fun PhotoThumbnail(uri: String, contentDescription: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val bitmap by produceState<android.graphics.Bitmap?>(null, uri) {
        value = if (uri.isBlank()) null else withContext(Dispatchers.IO) {
            runCatching {
                decodeBoundedThumbnail(context.contentResolver, Uri.parse(uri), DETAIL_THUMBNAIL_MAX_SIDE_PX)
            }.getOrNull()
        }
    }
    val displayBitmap = bitmap
    DisposableEffect(displayBitmap) {
        onDispose { displayBitmap?.takeUnless { it.isRecycled }?.recycle() }
    }
    Box(modifier.background(androidx.compose.ui.graphics.Color(0xFFDDE5DD)), contentAlignment = Alignment.Center) {
        if (displayBitmap != null) Image(displayBitmap.asImageBitmap(), contentDescription = contentDescription, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text("照片保留在本机")
    }
}

private fun FeedbackAction.label() = when (this) {
    FeedbackAction.LIKE -> "有意思"
    FeedbackAction.DISLIKE -> "没意思"
    FeedbackAction.WRONG_OBJECT -> "识错了"
    FeedbackAction.TOO_PRIVATE -> "太私人"
    FeedbackAction.SAVE -> "收藏"
}

private const val DETAIL_THUMBNAIL_MAX_SIDE_PX = 1280

private fun accessLabel(access: PhotoAccess) = when (access) {
    PhotoAccess.FULL -> "全部照片"
    PhotoAccess.PARTIAL -> "部分照片"
    PhotoAccess.PICKER_ONLY -> "仅手动选择"
}

private fun requestPinDailyWidget(context: android.content.Context) {
    val manager = AppWidgetManager.getInstance(context)
    if (!manager.isRequestPinAppWidgetSupported) {
        Toast.makeText(context, "请长按桌面，从小组件列表添加见微", Toast.LENGTH_LONG).show()
        return
    }
    val accepted = manager.requestPinAppWidget(ComponentName(context, DailyWidgetReceiver::class.java), null, null)
    if (!accepted) Toast.makeText(context, "请在系统弹窗中确认添加组件", Toast.LENGTH_SHORT).show()
}
