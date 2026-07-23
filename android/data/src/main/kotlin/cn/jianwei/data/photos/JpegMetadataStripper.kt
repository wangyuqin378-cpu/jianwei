package cn.jianwei.data.photos

import java.io.ByteArrayOutputStream

/** Removes application metadata emitted by the platform JPEG encoder before upload. */
internal object JpegMetadataStripper {
    fun strip(bytes: ByteArray): ByteArray {
        require(bytes.size >= 4 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()) {
            "Encoded image is not a JPEG"
        }
        require(bytes[bytes.lastIndex - 1] == 0xFF.toByte() && bytes.last() == 0xD9.toByte()) {
            "Encoded JPEG must end exactly at EOI"
        }

        val output = ByteArrayOutputStream(bytes.size)
        output.write(bytes, 0, 2)
        var offset = 2
        while (offset < bytes.size) {
            val markerStart = offset
            require(bytes[offset].toInt() and 0xFF == 0xFF) { "Malformed encoded JPEG marker" }
            while (offset < bytes.size && bytes[offset].toInt() and 0xFF == 0xFF) offset += 1
            require(offset < bytes.size) { "Truncated encoded JPEG marker" }
            val marker = bytes[offset].toInt() and 0xFF
            offset += 1

            if (marker == 0xD9) {
                require(offset == bytes.size) { "Encoded JPEG has trailing bytes" }
                output.write(bytes, markerStart, offset - markerStart)
                return output.toByteArray()
            }
            require(marker != 0xD8 && marker != 0x00) { "Unexpected encoded JPEG marker" }
            if (marker == 0x01 || marker in 0xD0..0xD7) {
                output.write(bytes, markerStart, offset - markerStart)
                continue
            }

            require(offset + 1 < bytes.size) { "Truncated encoded JPEG segment length" }
            val segmentLength = ((bytes[offset].toInt() and 0xFF) shl 8) or
                (bytes[offset + 1].toInt() and 0xFF)
            require(segmentLength >= 2 && offset + segmentLength <= bytes.size) {
                "Invalid encoded JPEG segment length"
            }
            val segmentEnd = offset + segmentLength
            if (marker == 0xDA) {
                output.write(bytes, markerStart, segmentEnd - markerStart)
                output.write(bytes, segmentEnd, bytes.size - segmentEnd)
                return output.toByteArray()
            }

            if (marker !in 0xE0..0xEF && marker != 0xFE) {
                output.write(bytes, markerStart, segmentEnd - markerStart)
            }
            offset = segmentEnd
        }
        error("Encoded JPEG ended without EOI")
    }
}
