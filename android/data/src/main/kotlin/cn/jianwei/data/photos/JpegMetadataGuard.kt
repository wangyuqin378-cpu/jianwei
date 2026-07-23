package cn.jianwei.data.photos

internal object JpegMetadataGuard {
    fun requireNoEmbeddedMetadata(bytes: ByteArray) {
        require(bytes.size >= 4 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()) {
            "Upload payload is not a valid JPEG"
        }
        require(bytes[bytes.lastIndex - 1] == 0xFF.toByte() && bytes.last() == 0xD9.toByte()) {
            "Upload JPEG must end exactly at EOI"
        }
        requireNoMetadataSegments(bytes)
    }

    private fun requireNoMetadataSegments(bytes: ByteArray) {
        var offset = 2
        var inEntropyData = false
        while (offset < bytes.size) {
            if (inEntropyData) {
                while (offset < bytes.size) {
                    if (bytes[offset].toInt() and 0xFF != 0xFF) {
                        offset += 1
                        continue
                    }
                    val markerStart = offset
                    while (offset < bytes.size && bytes[offset].toInt() and 0xFF == 0xFF) offset += 1
                    require(offset < bytes.size) { "Truncated JPEG entropy marker" }
                    val marker = bytes[offset].toInt() and 0xFF
                    offset += 1
                    if (marker == 0x00 || marker in 0xD0..0xD7) continue
                    offset = markerStart
                    inEntropyData = false
                    break
                }
                if (inEntropyData) error("JPEG entropy data ended without EOI")
                continue
            }

            require(bytes[offset].toInt() and 0xFF == 0xFF) { "Malformed JPEG marker" }
            while (offset < bytes.size && bytes[offset].toInt() and 0xFF == 0xFF) offset += 1
            require(offset < bytes.size) { "Truncated JPEG marker" }

            val marker = bytes[offset].toInt() and 0xFF
            offset += 1
            if (marker == 0xD9) {
                require(offset == bytes.size) { "Upload JPEG has trailing data" }
                return
            }
            if (marker == 0xD8 || marker == 0x01 || marker in 0xD0..0xD7) continue

            require(offset + 1 < bytes.size) { "Truncated JPEG segment length" }
            val segmentLength = ((bytes[offset].toInt() and 0xFF) shl 8) or
                (bytes[offset + 1].toInt() and 0xFF)
            require(segmentLength >= 2 && offset + segmentLength <= bytes.size) { "Invalid JPEG segment length" }
            require(marker !in 0xE0..0xEF && marker != 0xFE) {
                "Upload JPEG contains a metadata segment"
            }
            offset += segmentLength
            if (marker == 0xDA) inEntropyData = true
        }
    }
}
