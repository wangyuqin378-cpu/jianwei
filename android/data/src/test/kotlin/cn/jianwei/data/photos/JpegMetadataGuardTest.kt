package cn.jianwei.data.photos

import com.google.common.truth.Truth.assertThat
import kotlin.random.Random
import org.junit.Test

class JpegMetadataGuardTest {
    @Test
    fun `accepts a metadata free jpeg payload`() {
        JpegMetadataGuard.requireNoEmbeddedMetadata(
            byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte())
        )
    }

    @Test
    fun `rejects embedded exif payload`() {
        val bytes = byteArrayOf(0xFF.toByte(), 0xD8.toByte()) + "Exif\u0000\u0000GPSLatitude".toByteArray()

        val error = runCatching { JpegMetadataGuard.requireNoEmbeddedMetadata(bytes) }.exceptionOrNull()

        assertThat(error).isInstanceOf(IllegalArgumentException::class.java)
    }

    @Test
    fun `rejects app metadata even without a known signature`() {
        val bytes = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(),
            0xFF.toByte(), 0xE1.toByte(), 0x00, 0x04, 0x12, 0x34,
            0xFF.toByte(), 0xD9.toByte()
        )

        val error = runCatching { JpegMetadataGuard.requireNoEmbeddedMetadata(bytes) }.exceptionOrNull()

        assertThat(error).isInstanceOf(IllegalArgumentException::class.java)
    }

    @Test
    fun `final guard rejects even a thumbnail free jfif app zero segment`() {
        val bytes = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(),
            0xFF.toByte(), 0xE0.toByte(), 0x00, 0x10,
            0x4A, 0x46, 0x49, 0x46, 0x00,
            0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
            0xFF.toByte(), 0xD9.toByte()
        )

        val error = runCatching { JpegMetadataGuard.requireNoEmbeddedMetadata(bytes) }.exceptionOrNull()

        assertThat(error).isInstanceOf(IllegalArgumentException::class.java)
    }

    @Test
    fun `rejects an embedded jfif thumbnail`() {
        val bytes = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(),
            0xFF.toByte(), 0xE0.toByte(), 0x00, 0x13,
            0x4A, 0x46, 0x49, 0x46, 0x00,
            0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01,
            0x00, 0x00, 0x00,
            0xFF.toByte(), 0xD9.toByte()
        )

        val error = runCatching { JpegMetadataGuard.requireNoEmbeddedMetadata(bytes) }.exceptionOrNull()

        assertThat(error).isInstanceOf(IllegalArgumentException::class.java)
    }

    @Test
    fun `rejects malformed lengths and extended app zero payloads`() {
        val zeroLength = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(),
            0xFF.toByte(), 0xE1.toByte(), 0x00, 0x00,
            0xFF.toByte(), 0xD9.toByte()
        )
        val extendedAppZero = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(),
            0xFF.toByte(), 0xE0.toByte(), 0x00, 0x12,
            0x4A, 0x46, 0x49, 0x46, 0x00,
            0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
            0x12, 0x34,
            0xFF.toByte(), 0xD9.toByte()
        )

        assertThat(runCatching { JpegMetadataGuard.requireNoEmbeddedMetadata(zeroLength) }.exceptionOrNull())
            .isInstanceOf(IllegalArgumentException::class.java)
        assertThat(runCatching { JpegMetadataGuard.requireNoEmbeddedMetadata(extendedAppZero) }.exceptionOrNull())
            .isInstanceOf(IllegalArgumentException::class.java)
    }

    @Test
    fun `strips application metadata before validating the encoded jpeg`() {
        val encoded = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(),
            0xFF.toByte(), 0xE1.toByte(), 0x00, 0x04, 0x12, 0x34,
            0xFF.toByte(), 0xE2.toByte(), 0x00, 0x04, 0x56, 0x78,
            0xFF.toByte(), 0xD9.toByte()
        )

        val stripped = JpegMetadataStripper.strip(encoded)

        assertThat(stripped).isEqualTo(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte()))
        JpegMetadataGuard.requireNoEmbeddedMetadata(stripped)
    }

    @Test
    fun `production stripper removes app zero app thirteen and comments`() {
        val encoded = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(),
            0xFF.toByte(), 0xE0.toByte(), 0x00, 0x04, 0x01, 0x02,
            0xFF.toByte(), 0xED.toByte(), 0x00, 0x04, 0x03, 0x04,
            0xFF.toByte(), 0xFE.toByte(), 0x00, 0x04, 0x05, 0x06,
            0xFF.toByte(), 0xD9.toByte()
        )

        val stripped = JpegMetadataStripper.strip(encoded)

        assertThat(stripped).isEqualTo(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte()))
        JpegMetadataGuard.requireNoEmbeddedMetadata(stripped)
    }

    @Test
    fun `final guard rejects post scan comments and trailing payloads`() {
        val postScanComment = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(),
            0xFF.toByte(), 0xDA.toByte(), 0x00, 0x02,
            0x11,
            0xFF.toByte(), 0xFE.toByte(), 0x00, 0x02,
            0xFF.toByte(), 0xD9.toByte()
        )
        val trailing = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte(), 0x01
        )

        assertThat(runCatching {
            JpegMetadataGuard.requireNoEmbeddedMetadata(JpegMetadataStripper.strip(postScanComment))
        }.exceptionOrNull()).isInstanceOf(IllegalArgumentException::class.java)
        assertThat(runCatching { JpegMetadataStripper.strip(trailing) }.exceptionOrNull())
            .isInstanceOf(IllegalArgumentException::class.java)
    }

    @Test
    fun `deterministic malformed corpus fails closed without bounds errors`() {
        val random = Random(20260718)
        repeat(512) {
            val bytes = ByteArray(random.nextInt(4, 160)).also(random::nextBytes)
            bytes[0] = 0xFF.toByte()
            bytes[1] = 0xD8.toByte()
            bytes[bytes.lastIndex - 1] = 0xFF.toByte()
            bytes[bytes.lastIndex] = 0xD9.toByte()

            val error = runCatching {
                JpegMetadataGuard.requireNoEmbeddedMetadata(JpegMetadataStripper.strip(bytes))
            }.exceptionOrNull()

            assertThat(error).isNotInstanceOf(IndexOutOfBoundsException::class.java)
        }
    }
}
