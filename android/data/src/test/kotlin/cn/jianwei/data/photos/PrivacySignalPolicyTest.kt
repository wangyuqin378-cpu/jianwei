package cn.jianwei.data.photos

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PrivacySignalPolicyTest {
    @Test
    fun fullWidthAndSeparatedIdentityNumberIsBlocked() {
        val flags = sensitiveFlagsFromSignals(
            faceDetected = false,
            recognizedText = "公民身份号码 １１０１０５－１９４９ １２３１－００２Ｘ",
            textBlockCount = 1,
            labels = emptyList()
        )

        assertThat(flags).contains("id_card")
    }

    @Test
    fun identityLayoutMarkersRemainBlockedWhenOcrMissesNumber() {
        val flags = sensitiveFlagsFromSignals(
            faceDetected = false,
            recognizedText = "姓名 张三  性别 男  民族 汉  住址 北京市",
            textBlockCount = 4,
            labels = emptyList()
        )

        assertThat(flags).contains("id_card")
    }

    @Test
    fun fullWidthGroupedVisaNumberIsBlocked() {
        val flags = sensitiveFlagsFromSignals(
            faceDetected = false,
            recognizedText = "ＶＩＳＡ ６２２２－０２００－００００－００００",
            textBlockCount = 2,
            labels = emptyList()
        )

        assertThat(flags).contains("bank_card")
    }

    @Test
    fun groupedCardNumberIsBlockedEvenWhenLogoIsCroppedOut() {
        val flags = sensitiveFlagsFromSignals(
            faceDetected = false,
            recognizedText = "6222 0200 0000 0000",
            textBlockCount = 1,
            labels = emptyList()
        )

        assertThat(flags).contains("bank_card")
    }

    @Test
    fun unrelatedDatesAndPhoneNumberAreNotPromotedToCardOrIdentity() {
        val flags = sensitiveFlagsFromSignals(
            faceDetected = false,
            recognizedText = "活动日期 2026-07-23，联系电话 138 0013 8000",
            textBlockCount = 2,
            labels = listOf("Poster")
        )

        assertThat(flags).doesNotContain("bank_card")
        assertThat(flags).doesNotContain("id_card")
    }

    @Test
    fun facePersonReceiptAndTextDensitySignalsArePreserved() {
        val flags = sensitiveFlagsFromSignals(
            faceDetected = true,
            recognizedText = "发 票" + "内容".repeat(80),
            textBlockCount = 10,
            labels = listOf("Person")
        )

        assertThat(flags).containsAtLeast("face", "person", "receipt", "high_text_density", "document")
    }
}
