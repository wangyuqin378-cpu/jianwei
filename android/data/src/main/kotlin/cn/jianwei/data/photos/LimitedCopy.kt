package cn.jianwei.data.photos

import java.io.InputStream
import java.io.OutputStream

internal fun copyWithLimit(input: InputStream, output: OutputStream, maximumBytes: Long): Long {
    require(maximumBytes > 0) { "Import byte budget is exhausted" }
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var copied = 0L
    while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        copied += read
        require(copied <= maximumBytes) { "Imported image exceeds the local byte limit" }
        output.write(buffer, 0, read)
    }
    require(copied > 0) { "Imported image is empty" }
    return copied
}
