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
import androidx.glance.appwidget.updateAll
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
import cn.jianwei.domain.card.cardBodyForDisplay
import cn.jianwei.domain.card.cardRecognitionPresentation
import cn.jianwei.domain.model.NormalizedBoundingBox
import cn.jianwei.domain.photo.objectAwareCropRect
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
                ?.let { uri -> decodeWidgetThumbnails(context, uri, card.normalizedObjectBounds()) }
                ?.let { bitmap -> card.cardId to bitmap }
        }.toMap()
        val fontScale = context.resources.configuration.fontScale

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
            WidgetCard(
                card,
                card?.cardId?.let(thumbnails::get),
                openApp,
                cacheDepleted,
                switchAffordance,
                fontScale
            )
        }
    }
}

class DailyWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DailyWidget()
}

@androidx.compose.runtime.Composable
private fun WidgetCard(
    card: CardEntity?,
    thumbnails: WidgetThumbnails?,
    openApp: Action,
    cacheDepleted: Boolean,
    switchAffordance: WidgetSwitchAffordance,
    fontScale: Float
) {
    val wide = LocalSize.current.width >= 240.dp
    val largeText = fontScale >= LARGE_WIDGET_FONT_SCALE
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
    val textLines = widgetKnowledgeTextLines(card.title, wide, largeText)
    val brandLabel = if (shouldShowWidgetRecognitionLabel(card.title, recognition.compactLabel)) {
        recognition.compactLabel
    } else {
        "今日"
    }
    if (wide) {
        Row(modifier) {
            Photo(
                thumbnails?.wide,
                "${card.title}的原照片缩略图",
                GlanceModifier.width(104.dp).fillMaxHeight().cornerRadius(16.dp)
            )
            Spacer(GlanceModifier.width(12.dp))
            Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
                Text("见微 · $brandLabel", style = brandStyle(), maxLines = 1)
                Spacer(GlanceModifier.height(2.dp))
                Text(card.title, style = titleStyle(), maxLines = textLines.titleMaxLines)
                Spacer(GlanceModifier.height(if (largeText) 2.dp else 4.dp))
                if (textLines.bodyMaxLines > 0) {
                    Text(
                        cardBodyForDisplay(card.title, card.body),
                        style = bodyStyle(),
                        maxLines = textLines.bodyMaxLines
                    )
                }
                sourcesFromJson(card.sources).firstOrNull()?.let { source ->
                    Text("来源 · " + source.publisher, style = sourceStyle(), maxLines = 1)
                }
                Spacer(GlanceModifier.defaultWeight())
                val footer = wideWidgetFooter(cacheDepleted, switchAffordance)
                if (footer.canSwitch) {
                    SwitchControl(footer.label)
                } else {
                    Text(footer.label, style = footerStyle(), maxLines = 1)
                }
            }
        }
    } else {
        Column(modifier) {
            Text("见微 · $brandLabel", style = brandStyle(), maxLines = 1)
            Spacer(GlanceModifier.height(if (largeText) 2.dp else 6.dp))
            Box(GlanceModifier.fillMaxWidth().height(if (largeText) 32.dp else 88.dp)) {
                Photo(thumbnails?.compact, "${card.title}的原照片缩略图", GlanceModifier.fillMaxSize().cornerRadius(14.dp))
            }
            Spacer(GlanceModifier.height(if (largeText) 2.dp else 6.dp))
            Text(card.title, style = titleStyle(), maxLines = textLines.titleMaxLines)
            if (textLines.bodyMaxLines > 0) {
                Text(
                    cardBodyForDisplay(card.title, card.body),
                    style = bodyStyle(),
                    maxLines = if (cacheDepleted) 1 else textLines.bodyMaxLines
                )
            }
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
        val advance = widgetStateStore(context).tryAdvance(
            today = today,
            orderedCardIds = scheduled.map(CardEntity::cardId),
            preferredCardId = scheduled.firstOrNull()?.cardId
        )
        if (advance.switched) {
            advance.state.currentCardId?.let { cardId ->
                database.cards().consumeFutureCardForWidget(cardId, today)
            }
        }
        database.close()
        DailyWidget().updateAll(context)
    }
}

internal fun isWidgetCacheDepleted(today: String, scheduledDate: String?): Boolean =
    scheduledDate != null && scheduledDate < today

internal fun shouldShowWidgetRecognitionLabel(cardTitle: String, compactRecognitionLabel: String): Boolean =
    cardTitle.trim().replace(Regex("\\s+"), " ") != compactRecognitionLabel.trim().replace(Regex("\\s+"), " ")

internal data class WidgetKnowledgeTextLines(
    val titleMaxLines: Int,
    val bodyMaxLines: Int
)

internal fun widgetKnowledgeTextLines(
    title: String,
    wide: Boolean,
    largeText: Boolean = false
): WidgetKnowledgeTextLines {
    val normalizedTitle = title.trim().replace(Regex("\\s+"), " ")
    val codePointCount = normalizedTitle.codePointCount(0, normalizedTitle.length)
    val longTitleThreshold = if (wide) 14 else 12
    if (largeText) {
        return if (codePointCount > longTitleThreshold) {
            WidgetKnowledgeTextLines(titleMaxLines = if (wide) 3 else 4, bodyMaxLines = 0)
        } else {
            WidgetKnowledgeTextLines(titleMaxLines = 2, bodyMaxLines = 1)
        }
    }
    return if (codePointCount > longTitleThreshold) {
        WidgetKnowledgeTextLines(titleMaxLines = if (wide) 2 else 3, bodyMaxLines = 1)
    } else {
        WidgetKnowledgeTextLines(titleMaxLines = 1, bodyMaxLines = 2)
    }
}

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

private fun sourceStyle() = TextStyle(color = ColorProvider(Color(0xFF606761)), fontSize = 11.sp)

private fun footerStyle() = TextStyle(
    color = ColorProvider(Color(0xFF28543F)),
    fontSize = 11.sp,
    fontWeight = FontWeight.Bold
)

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

private data class WidgetThumbnails(val wide: Bitmap, val compact: Bitmap)

private fun decodeWidgetThumbnails(
    context: Context,
    uriValue: String,
    objectBounds: NormalizedBoundingBox?
): WidgetThumbnails? = runCatching {
    val source = decodeBoundedThumbnail(
        context.contentResolver,
        Uri.parse(uriValue),
        WIDGET_THUMBNAIL_MAX_SIDE_PX
    ) ?: return@runCatching null
    WidgetThumbnails(
        wide = source.objectAwareCrop(WIDE_WIDGET_PHOTO_ASPECT_RATIO, objectBounds),
        compact = source.objectAwareCrop(COMPACT_WIDGET_PHOTO_ASPECT_RATIO, objectBounds)
    )
}.getOrNull()

private fun Bitmap.objectAwareCrop(
    targetAspectRatio: Double,
    objectBounds: NormalizedBoundingBox?
): Bitmap {
    val crop = objectAwareCropRect(width, height, targetAspectRatio, objectBounds) ?: return this
    if (crop.left == 0 && crop.top == 0 && crop.width == width && crop.height == height) return this
    return Bitmap.createBitmap(this, crop.left, crop.top, crop.width, crop.height)
}

private fun CardEntity.normalizedObjectBounds(): NormalizedBoundingBox? {
    val x = objectBoxX ?: return null
    val y = objectBoxY ?: return null
    val width = objectBoxWidth ?: return null
    val height = objectBoxHeight ?: return null
    return NormalizedBoundingBox(x, y, width, height)
}

private suspend fun CardDao.cardsForWidget(today: String): List<CardEntity> {
    val current = currentForWidget(today)
    val alreadyShownToday = scheduledForWidgetDay(today)
    val future = futureForWidget(today, MAX_DAILY_WIDGET_SWITCHES)
    return (listOfNotNull(current) + alreadyShownToday + future).distinctBy(CardEntity::cardId)
}

internal const val MAX_DAILY_SWITCHES = MAX_DAILY_WIDGET_SWITCHES
internal const val WIDGET_THUMBNAIL_MAX_SIDE_PX = 320
internal const val WIDE_WIDGET_PHOTO_ASPECT_RATIO = 0.72
internal const val COMPACT_WIDGET_PHOTO_ASPECT_RATIO = 1.25
internal const val LARGE_WIDGET_FONT_SCALE = 1.3f
