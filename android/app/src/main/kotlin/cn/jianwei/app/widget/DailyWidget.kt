package cn.jianwei.app.widget

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import cn.jianwei.app.MainActivity
import cn.jianwei.app.PHOTO_THUMBNAIL_UNAVAILABLE_LABEL
import cn.jianwei.data.local.CardDao
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesFromJson
import cn.jianwei.data.photos.decodeBoundedThumbnail
import cn.jianwei.data.widget.MAX_DAILY_WIDGET_SWITCHES
import cn.jianwei.data.widget.widgetStateStore
import cn.jianwei.domain.card.cardRecognitionPresentation
import cn.jianwei.domain.time.ChinaCalendar

class DailyWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(
        setOf(DpSize(120.dp, 120.dp), DpSize(280.dp, 120.dp))
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val database = widgetDatabase(context)
        val today = ChinaCalendar.today().toString()
        val scheduled = database.cards().cardsForWidget(today)
        database.close()
        val preferredCardId = scheduled.firstOrNull()?.cardId
        val store = widgetStateStore(context)
        val initialState = store.selectForDisplay(
            today = today,
            orderedCardIds = scheduled.map(CardEntity::cardId),
            preferredCardId = preferredCardId
        )
        val orderedCardIds = scheduled.map(CardEntity::cardId)
        val thumbnails = scheduled.mapNotNull { card ->
            card.photoUri.takeIf(String::isNotBlank)
                ?.let { uri -> decodeThumbnail(context, uri) }
                ?.let { bitmap -> card.cardId to bitmap }
        }.toMap()

        provideContent {
            val state by store.observe().collectAsState(initialState)
            val card = scheduled.firstOrNull { it.cardId == state.currentCardId }
            val openApp = actionStartActivity(
                Intent(context, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_CARD_ID, card?.cardId)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            )
            val cacheDepleted = isWidgetCacheDepleted(today, card?.scheduledDate)
            val switchAffordance = widgetSwitchAffordance(state.switchCount, orderedCardIds, state.currentCardId)
            WidgetCard(card, card?.cardId?.let(thumbnails::get), openApp, cacheDepleted, switchAffordance)
        }
    }
}

class DailyWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DailyWidget()
}

@androidx.compose.runtime.Composable
private fun WidgetCard(
    card: CardEntity?,
    bitmap: Bitmap?,
    openApp: Action,
    cacheDepleted: Boolean,
    switchAffordance: WidgetSwitchAffordance
) {
    val wide = LocalSize.current.width >= 240.dp
    val modifier = GlanceModifier
        .fillMaxSize()
        .appWidgetBackground()
        .background(widgetSurface())
        .cornerRadius(22.dp)
        .clickable(openApp)
        .padding(12.dp)

    if (card == null) {
        Column(modifier) {
            Text("见微 · 照片里的日常知识", style = brandStyle(), maxLines = 1)
            Spacer(GlanceModifier.height(10.dp))
            Text("让普通照片，带来一个今天值得知道的细节。", style = titleStyle(), maxLines = 3)
            Spacer(GlanceModifier.defaultWeight())
            Text("打开 App 选择照片", style = sourceStyle(), maxLines = 1)
        }
        return
    }

    val recognition = cardRecognitionPresentation(card.title, card.detectedObjectName, card.confidence)
    if (wide) {
        Row(modifier) {
            Photo(
                bitmap,
                "${card.title}的原照片缩略图",
                GlanceModifier.width(104.dp).fillMaxHeight().cornerRadius(16.dp)
            )
            Spacer(GlanceModifier.width(12.dp))
            Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
                Text("见微 · 今日", style = brandStyle(), maxLines = 1)
                Spacer(GlanceModifier.height(2.dp))
                Text(card.title, style = titleStyle(), maxLines = 1)
                if (shouldShowWidgetRecognitionLabel(card.title, recognition.compactLabel)) {
                    Text(recognition.compactLabel, style = objectStyle(), maxLines = 1)
                }
                Spacer(GlanceModifier.height(4.dp))
                Text(card.body, style = bodyStyle(), maxLines = 2)
                if (cacheDepleted) {
                    Text("新卡缓存已用完 · 打开 App 更新", style = sourceStyle(), maxLines = 1)
                } else {
                    sourcesFromJson(card.sources).firstOrNull()?.let { source ->
                        Text("来源 · " + source.publisher, style = sourceStyle(), maxLines = 1)
                    }
                }
                Spacer(GlanceModifier.defaultWeight())
                if (switchAffordance.canSwitch) {
                    SwitchControl(switchAffordance.label)
                } else {
                    Text(switchAffordance.label, style = sourceStyle(), maxLines = 1)
                }
            }
        }
    } else {
        Column(modifier) {
            val brandLabel = if (shouldShowWidgetRecognitionLabel(card.title, recognition.compactLabel)) {
                recognition.compactLabel
            } else {
                "今日"
            }
            Text("见微 · $brandLabel", style = brandStyle(), maxLines = 1)
            Spacer(GlanceModifier.height(6.dp))
            Box(GlanceModifier.fillMaxWidth().height(88.dp)) {
                Photo(bitmap, "${card.title}的原照片缩略图", GlanceModifier.fillMaxSize().cornerRadius(14.dp))
            }
            Spacer(GlanceModifier.height(6.dp))
            Text(card.title, style = titleStyle(), maxLines = 1)
            Text(card.body, style = bodyStyle(), maxLines = if (cacheDepleted) 1 else 2)
            if (cacheDepleted) {
                Text("新卡缓存已用完", style = sourceStyle(), maxLines = 1)
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun SwitchControl(label: String) {
    Box(
        GlanceModifier
            .fillMaxWidth()
            .background(widgetPrimary())
            .cornerRadius(12.dp)
            .clickable(actionRunCallback<NextCardAction>())
            .padding(horizontal = 10.dp, vertical = 7.dp)
    ) {
        Text(
            label,
            modifier = GlanceModifier.fillMaxWidth(),
            style = switchStyle(),
            maxLines = 1
        )
    }
}

@androidx.compose.runtime.Composable
private fun Photo(bitmap: Bitmap?, contentDescription: String, modifier: GlanceModifier) {
    if (bitmap != null) {
        Image(ImageProvider(bitmap), contentDescription, modifier, contentScale = ContentScale.Crop)
    } else {
        Box(modifier.background(widgetPrimaryContainer())) {
            Text(PHOTO_THUMBNAIL_UNAVAILABLE_LABEL, style = objectStyle())
        }
    }
}

class NextCardAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val today = ChinaCalendar.today().toString()
        val database = widgetDatabase(context)
        val scheduled = database.cards().cardsForWidget(today)
        database.close()
        widgetStateStore(context).tryAdvance(
            today = today,
            orderedCardIds = scheduled.map(CardEntity::cardId),
            preferredCardId = scheduled.firstOrNull()?.cardId
        )
        DailyWidget().update(context, glanceId)
    }
}

internal fun isWidgetCacheDepleted(today: String, scheduledDate: String?): Boolean =
    scheduledDate != null && scheduledDate < today

internal fun shouldShowWidgetRecognitionLabel(cardTitle: String, compactRecognitionLabel: String): Boolean =
    cardTitle.trim().replace(Regex("\\s+"), " ") != compactRecognitionLabel.trim().replace(Regex("\\s+"), " ")

private fun titleStyle() = TextStyle(
    color = ColorProvider(Color(0xFF1D211E)),
    fontSize = 15.sp,
    fontWeight = FontWeight.Bold
)

private fun bodyStyle() = TextStyle(color = ColorProvider(Color(0xFF343A35)), fontSize = 12.sp)

private fun brandStyle() = TextStyle(
    color = ColorProvider(Color(0xFF85543D)),
    fontSize = 10.sp,
    fontWeight = FontWeight.Bold
)

private fun objectStyle() = TextStyle(
    color = ColorProvider(Color(0xFF28543F)),
    fontSize = 10.sp,
    fontWeight = FontWeight.Bold
)

private fun sourceStyle() = TextStyle(color = ColorProvider(Color(0xFF606761)), fontSize = 10.sp)

private fun switchStyle() = TextStyle(
    color = ColorProvider(Color.White),
    fontSize = 11.sp,
    fontWeight = FontWeight.Bold,
    textAlign = TextAlign.Center
)

private fun widgetSurface() = ColorProvider(Color(0xFFFFFCF5))
private fun widgetPrimary() = ColorProvider(Color(0xFF28543F))
private fun widgetPrimaryContainer() = ColorProvider(Color(0xFFD9EADD))

private fun widgetDatabase(context: Context) = buildJianweiDatabase(context)

private fun decodeThumbnail(context: Context, uriValue: String): Bitmap? = runCatching {
    decodeBoundedThumbnail(context.contentResolver, Uri.parse(uriValue), WIDGET_THUMBNAIL_MAX_SIDE_PX)
}.getOrNull()

private suspend fun CardDao.cardsForWidget(today: String): List<CardEntity> {
    val current = currentForWidget(today)
    val future = futureForWidget(today, MAX_DAILY_WIDGET_SWITCHES)
    return (listOfNotNull(current) + future).distinctBy(CardEntity::cardId)
}

internal const val MAX_DAILY_SWITCHES = MAX_DAILY_WIDGET_SWITCHES
internal const val WIDGET_THUMBNAIL_MAX_SIDE_PX = 320
