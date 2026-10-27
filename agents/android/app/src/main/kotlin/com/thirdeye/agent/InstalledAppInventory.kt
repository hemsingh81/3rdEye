package com.thirdeye.agent

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

// STORY-12 (android-agent-spec.md's F3 extension): PackageManager is a
// disclosed, standard API — no extra permission walk needed beyond what's
// already granted, unlike UsageStatsManager/Accessibility. Android's
// package name is an exact, stable app_id — a genuine advantage over
// Windows' registry-DisplayName heuristic (agents/windows/
// InstalledAppInventory.cs's "known limitation" doesn't apply here.
class InstalledAppInventory(private val context: Context, private val backendUrl: String, private val deviceId: String) {
    private val http = OkHttpClient()

    // ThirdEyeAccessibilityService checks a foreground package against
    // this, not every package on the device — matches Windows'
    // LastKnownAppIds scoping, same reasoning: only enforce against apps
    // this agent actually reported, so a system/launcher package that was
    // never part of anyone's approval flow can't accidentally get blocked.
    var lastKnownAppIds: List<String> = emptyList()
        private set

    fun report() {
        val apps = context.packageManager
            .getInstalledApplications(PackageManager.GET_META_DATA)
            .filter { (it.flags and ApplicationInfo.FLAG_SYSTEM) == 0 } // skip system apps — same noise-reduction intent as Windows skipping no-DisplayName entries
            .map { it.packageName }

        lastKnownAppIds = apps
        if (apps.isEmpty()) return

        val appsJson = JSONArray()
        apps.forEach { pkg ->
            appsJson.put(JSONObject().apply {
                put("app_id", pkg)
                put("install_source", "android_package_manager")
            })
        }
        val body = JSONObject().put("apps", appsJson).toString().toRequestBody("application/json".toMediaType())

        try {
            val request = Request.Builder()
                .url("$backendUrl/api/devices/$deviceId/installed-apps")
                .post(body)
                .build()
            http.newCall(request).execute().close() // fire-and-check-status-only; same "no local diff needed, backend upsert is idempotent" call as Windows
        } catch (e: IOException) {
            // Offline — next report() re-enumerates and tries again; same
            // reasoning as the Windows agent, nothing to queue locally for
            // a point-in-time-irrelevant inventory snapshot.
        }
    }
}
