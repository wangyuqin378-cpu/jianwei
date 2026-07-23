package cn.jianwei.data.local

import androidx.room.TypeConverter
import org.json.JSONArray

class Converters {
    @TypeConverter
    fun stringsToJson(value: List<String>): String = JSONArray(value).toString()

    @TypeConverter
    fun jsonToStrings(value: String): List<String> {
        val array = JSONArray(value)
        return List(array.length()) { array.getString(it) }
    }

    @TypeConverter
    fun stringSetToJson(value: Set<String>): String = JSONArray(value.toList()).toString()

    @TypeConverter
    fun jsonToStringSet(value: String): Set<String> = jsonToStrings(value).toSet()
}
