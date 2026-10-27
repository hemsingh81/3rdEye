package com.thirdeye.agent

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock

// android-agent-spec.md §3: this is the same UsageEvent/AlertEvent local-
// cache-then-sync shape implementation-plan.md §1.1 specs once — not
// redefined here, just ported. Carries over BOTH review fixes already
// found in the Windows agent (agents/windows/EventQueue.cs, commit
// history around d040b88 and the later concurrency fix): the atomic
// rename-to-snapshot before the network call (so an event appended
// mid-flush isn't lost), and a lock around every file operation (a
// background thread — here, the AccessibilityService's callback thread —
// can call Enqueue* concurrently with a flush, same as DnsFilter could on
// Windows).
class EventQueue(private val context: Context, private val backendUrl: String, private val deviceId: String) {
    private val http = OkHttpClient()
    private val lock = ReentrantLock()
    private val queueFile: File get() = File(context.filesDir, "events.jsonl")

    fun enqueueAlert(type: String, message: String) {
        append(JSONObject().apply {
            put("kind", "alert")
            put("client_event_id", UUID.randomUUID().toString())
            put("type", type)
            put("message", message)
            put("ts", isoNow())
        })
    }

    fun enqueueUsage(startTsIso: String, endTsIso: String) {
        append(JSONObject().apply {
            put("kind", "usage")
            put("client_event_id", UUID.randomUUID().toString())
            put("start_ts", startTsIso)
            put("end_ts", endTsIso)
        })
    }

    private fun append(evt: JSONObject) {
        lock.lock()
        try {
            queueFile.appendText(evt.toString() + "\n")
        } finally {
            lock.unlock()
        }
    }

    // Returns true if the flush succeeded (or there was nothing to flush).
    fun flush(): Boolean {
        val snapshotFile = File(context.filesDir, "events.jsonl.flushing")

        lock.lock()
        try {
            if (!queueFile.exists()) return true
            if (!queueFile.renameTo(snapshotFile)) return false // concurrent flush already in progress
        } finally {
            lock.unlock()
        }

        val lines = snapshotFile.readLines().filter { it.isNotBlank() }
        if (lines.isEmpty()) {
            snapshotFile.delete()
            return true
        }

        val usageEvents = JSONArray()
        val alertEvents = JSONArray()
        for (line in lines) {
            val evt = JSONObject(line)
            when (evt.getString("kind")) {
                "usage" -> usageEvents.put(JSONObject().apply {
                    put("client_event_id", evt.getString("client_event_id"))
                    put("start_ts", evt.getString("start_ts"))
                    put("end_ts", evt.getString("end_ts"))
                })
                "alert" -> alertEvents.put(JSONObject().apply {
                    put("client_event_id", evt.getString("client_event_id"))
                    put("type", evt.getString("type"))
                    put("message", evt.optString("message", null))
                    put("ts", evt.getString("ts"))
                })
            }
        }

        val body = JSONObject().apply {
            put("usage_events", usageEvents)
            put("alert_events", alertEvents)
        }.toString().toRequestBody("application/json".toMediaType())

        return try {
            val request = Request.Builder()
                .url("$backendUrl/api/devices/$deviceId/events")
                .post(body)
                .build()
            http.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    snapshotFile.delete()
                    true
                } else {
                    requeueSnapshot(snapshotFile)
                    false
                }
            }
        } catch (e: IOException) {
            requeueSnapshot(snapshotFile) // offline — put it back for the next sync attempt
            false
        }
    }

    private fun requeueSnapshot(snapshotFile: File) {
        lock.lock()
        try {
            val snapshotContent = snapshotFile.readText()
            val currentContent = if (queueFile.exists()) queueFile.readText() else ""
            queueFile.writeText(snapshotContent + currentContent)
            snapshotFile.delete()
        } finally {
            lock.unlock()
        }
    }

    private fun isoNow(): String = java.time.Instant.now().toString()
}
