package com.vicious.assistant

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * One recorded intervention: the watcher noticed the foreground app stalled,
 * did something about it, and (when possible) diagnosed why.
 */
data class VixLogEntry(
    val id: String,
    val timestamp: Long,
    val packageName: String,
    val idleMs: Long,
    val typedReply: String?,
    val diagnosis: String?
)

/**
 * Simple JSON-file-backed log, capped at MAX_ENTRIES, shared in-process between
 * VixAccessibilityService (writer) and VixAccessibilityPlugin (reader, for the
 * Settings screen). No network, no external storage — internal app files dir only.
 */
object VixLogStore {
    private const val FILE_NAME = "vix_diagnostic_log.json"
    private const val MAX_ENTRIES = 200
    private val lock = Any()

    fun append(context: Context, entry: VixLogEntry) {
        synchronized(lock) {
            val entries = readAll(context).toMutableList()
            entries.add(0, entry)
            writeAll(context, entries.take(MAX_ENTRIES))
        }
    }

    fun getAll(context: Context): List<VixLogEntry> = synchronized(lock) { readAll(context) }

    fun clear(context: Context) {
        synchronized(lock) { writeAll(context, emptyList()) }
    }

    private fun file(context: Context): File = File(context.filesDir, FILE_NAME)

    private fun readAll(context: Context): List<VixLogEntry> {
        val f = file(context)
        if (!f.exists()) return emptyList()
        return try {
            val arr = JSONArray(f.readText())
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                VixLogEntry(
                    id = o.optString("id"),
                    timestamp = o.optLong("timestamp"),
                    packageName = o.optString("packageName"),
                    idleMs = o.optLong("idleMs"),
                    typedReply = o.optString("typedReply").ifEmpty { null },
                    diagnosis = o.optString("diagnosis").ifEmpty { null }
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun writeAll(context: Context, entries: List<VixLogEntry>) {
        val arr = JSONArray()
        entries.forEach { e ->
            val o = JSONObject()
            o.put("id", e.id)
            o.put("timestamp", e.timestamp)
            o.put("packageName", e.packageName)
            o.put("idleMs", e.idleMs)
            o.put("typedReply", e.typedReply ?: "")
            o.put("diagnosis", e.diagnosis ?: "")
            arr.put(o)
        }
        file(context).writeText(arr.toString())
    }
}
