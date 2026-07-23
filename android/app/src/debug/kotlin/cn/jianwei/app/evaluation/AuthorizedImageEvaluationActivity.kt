package cn.jianwei.app.evaluation

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AuthorizedImageEvaluationActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val runId = intent.getStringExtra(EXTRA_RUN_ID).orEmpty()
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) {
                    EvaluationScreen(runId)
                }
            }
        }
    }

    companion object {
        const val EXTRA_RUN_ID = "runId"
    }
}

private sealed interface PreparationState {
    data object Loading : PreparationState
    data class Ready(val evaluation: PreparedEvaluation) : PreparationState
    data class Failed(val reason: String) : PreparationState
}

@Composable
private fun EvaluationScreen(runId: String) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var preparation by remember(runId) { mutableStateOf<PreparationState>(PreparationState.Loading) }
    var reviewerId by rememberSaveable(runId) { mutableStateOf("") }
    var consentChecked by rememberSaveable(runId) { mutableStateOf(false) }
    var startError by remember(runId) { mutableStateOf<String?>(null) }
    val workManager = remember { WorkManager.getInstance(context) }
    val workInfos by remember(runId) {
        workManager.getWorkInfosForUniqueWorkFlow(AuthorizedImageEvaluationWorker.workName(runId))
    }.collectAsState(initial = emptyList())
    val workState = workInfos.lastOrNull()?.state
    val progress = remember(workInfos, preparation) { EvaluationArtifacts.progressSnapshot(context, runId) }

    LaunchedEffect(runId) {
        preparation = if (!Regex("^[A-Za-z0-9._-]{3,128}$").matches(runId)) {
            PreparationState.Failed("缺少有效 runId。请通过受控 ADB 脚本启动本页面。")
        } else {
            runCatching { withContext(Dispatchers.IO) { EvaluationArtifacts.prepare(context, runId) } }
                .fold(
                    onSuccess = { PreparationState.Ready(it) },
                    onFailure = { PreparationState.Failed(it.message ?: "评测输入预检失败") }
                )
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("授权图片真机评测", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("这是仅存在于 Debug APK 的受控工具。它使用与产品相同的端侧 ML Kit、去元数据和云端识别路径，结果不会自动成为 Beta 放行证据。")
        when (val state = preparation) {
            PreparationState.Loading -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator()
                Text("正在本地核对 300–500 张图片的 SHA-256；不会上传。")
            }
            is PreparationState.Failed -> Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("预检失败", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                    Text(state.reason)
                }
            }
            is PreparationState.Ready -> {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("输入已通过本地预检", fontWeight = FontWeight.Bold)
                        Text("运行：${state.evaluation.manifest.runId}")
                        Text("数据集：${state.evaluation.manifest.datasetId}")
                        Text("样本：${state.evaluation.samples.size}")
                        Text("App：${state.evaluation.manifest.appVersion}")
                        Text("模型：${state.evaluation.manifest.modelVersion}")
                        Text("目录：${state.evaluation.manifest.catalogVersion}")
                    }
                }
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("真人启动检查点", fontWeight = FontWeight.Bold)
                        Text("如果端侧过滤漏判，已获授权的敏感测试图会进入真实 HTTPS 云链路，以便准确计入漏传率并验证服务端拒绝与删除。不要使用授权范围不包含云端评测的私人照片。")
                        OutlinedTextField(
                            value = reviewerId,
                            onValueChange = { reviewerId = it.take(128) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("真人执行负责人 ID") },
                            singleLine = true
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = consentChecked, onCheckedChange = { consentChecked = it })
                            Text("我已核对授权记录，并确认本次使用物理设备和真实生产 HTTPS 端点。")
                        }
                        startError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        Button(
                            enabled = consentChecked && reviewerId.isNotBlank() && workState !in setOf(WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED),
                            onClick = {
                                startError = runCatching {
                                    EvaluationArtifacts.approve(context, state.evaluation, reviewerId.trim())
                                    AuthorizedImageEvaluationWorker.start(context, state.evaluation.manifest.runId)
                                }.exceptionOrNull()?.message
                            }
                        ) { Text("确认并开始评测") }
                    }
                }
            }
        }
        if (progress != null) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("运行状态", fontWeight = FontWeight.Bold)
                    Text("已完成 ${progress.first} / ${progress.second}")
                    Text("WorkManager：${workState?.name ?: "尚未入队"}")
                    if (workState == WorkInfo.State.FAILED) {
                        Text("任务已失败关闭。保留受控输入，检查网络、暂停分析状态和真实云配置后重新准备运行。", color = MaterialTheme.colorScheme.error)
                    }
                    if (progress.first == progress.second && progress.second > 0) {
                        Text("评测完成。请用主机脚本取回 image-results.json，再执行独立编译器。", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
