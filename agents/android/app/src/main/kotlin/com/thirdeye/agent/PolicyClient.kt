package com.thirdeye.agent

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

// Same shape as the Windows agent's Policy record (agents/windows/PolicyClient.cs).
// STORY-12: appAllowlist/appControlMode added, same fix already applied on
// Windows (STORY-11) — the backend's policy.ts now actually returns these
// (it didn't, until that story's review caught it), flattened to a plain
// array of app_id strings (Android's app_id is the exact package name, no
// heuristic name-matching needed the way Windows' registry DisplayName
// required).
data class GeofenceRule(
    val id: String,
    val name: String,
    val lat: Double,
    val lon: Double,
    val radiusMeters: Double,
)

data class Policy(
    val deviceId: String,
    val version: Int,
    val dailyLimitMinutes: Int,
    val bedtimeStart: String?,
    val bedtimeEnd: String?,
    val contentFilterCategories: List<String>,
    val appControlMode: String?,
    val appAllowlist: List<String>,
    // STORY-13: full objects, not flattened like appAllowlist — the agent
    // needs the name (for the alert message) and the math inputs, not
    // just an id.
    val geofenceRules: List<GeofenceRule>,
) {
    companion object {
        fun fromJson(json: String): Policy {
            val o = JSONObject(json)
            val categories = mutableListOf<String>()
            val catArr = o.getJSONArray("content_filter_categories")
            for (i in 0 until catArr.length()) categories.add(catArr.getString(i))

            val allowlist = mutableListOf<String>()
            val allowArr = o.optJSONArray("app_allowlist")
            if (allowArr != null) {
                for (i in 0 until allowArr.length()) allowlist.add(allowArr.getString(i))
            }

            val geofences = mutableListOf<GeofenceRule>()
            val geofenceArr = o.optJSONArray("geofence_rules")
            if (geofenceArr != null) {
                for (i in 0 until geofenceArr.length()) {
                    val g = geofenceArr.getJSONObject(i)
                    geofences.add(GeofenceRule(
                        id = g.getString("id"),
                        name = g.getString("name"),
                        lat = g.getDouble("lat"),
                        lon = g.getDouble("lon"),
                        radiusMeters = g.getDouble("radius_meters"),
                    ))
                }
            }

            return Policy(
                deviceId = o.getString("device_id"),
                version = o.getInt("version"),
                dailyLimitMinutes = o.getInt("daily_limit_minutes"),
                bedtimeStart = o.optString("bedtime_start", null),
                bedtimeEnd = o.optString("bedtime_end", null),
                contentFilterCategories = categories,
                appControlMode = o.optString("app_control_mode", null),
                appAllowlist = allowlist,
                geofenceRules = geofences,
            )
        }

        fun toJson(p: Policy): String {
            val o = JSONObject()
            o.put("device_id", p.deviceId)
            o.put("version", p.version)
            o.put("daily_limit_minutes", p.dailyLimitMinutes)
            o.put("bedtime_start", p.bedtimeStart)
            o.put("bedtime_end", p.bedtimeEnd)
            o.put("content_filter_categories", p.contentFilterCategories)
            o.put("app_control_mode", p.appControlMode)
            o.put("app_allowlist", p.appAllowlist)
            o.put("geofence_rules", p.geofenceRules.map {
                mapOf("id" to it.id, "name" to it.name, "lat" to it.lat, "lon" to it.lon, "radius_meters" to it.radiusMeters)
            })
            return o.toString()
        }
    }
}

// offline-sync-spec.md §4: fetch, cache, enforce from the cache either way
// — a fetch failure (offline) is the normal case, not an error path. Same
// contract as agents/windows/PolicyClient.cs; EncryptedSharedPreferences
// instead of a JSON file is the only real difference, per android-agent-
// spec.md §2's "platform idiom, not a literal port" call.
class PolicyClient(private val context: Context, private val backendUrl: String, private val deviceId: String) {
    private val http = OkHttpClient()
    private val prefs = LocalConfigStore
    private val cacheKey = "policy_cache"

    fun syncAndGetPolicy(): Policy? {
        try {
            val request = Request.Builder().url("$backendUrl/api/devices/$deviceId/policy").build()
            http.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: return getCachedPolicy()
                    cachePrefs().edit().putString(cacheKey, body).apply()
                    return Policy.fromJson(body)
                }
            }
        } catch (e: IOException) {
            // No connectivity — fall through to the local cache below.
        }
        return getCachedPolicy()
    }

    fun getCachedPolicy(): Policy? {
        val json = cachePrefs().getString(cacheKey, null) ?: return null
        return Policy.fromJson(json)
    }

    private fun cachePrefs() = context.getSharedPreferences("thirdeye_policy_cache", Context.MODE_PRIVATE)
}
