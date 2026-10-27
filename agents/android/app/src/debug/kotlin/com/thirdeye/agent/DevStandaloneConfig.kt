package com.thirdeye.agent

import android.content.Context
import java.io.File

// android-agent-spec.md §2 / dev-standalone-mode-spec.md §3: this file
// lives under src/debug/ — the Gradle build-variant equivalent of the
// Windows agent's `#if DEBUG` guard (agents/windows/DevStandaloneConfig.cs).
// It is not part of the `release` build variant's compiled sources at
// all, by construction, not merely disabled at runtime. STORY-08's CI
// must still verify this file is absent from a release APK's compiled
// classes, same as dev-standalone-mode-spec.md §1's hard rule demands —
// "it's in a different source set" is the mechanism, not a substitute
// for verifying it.
object DevStandaloneConfig {
    // dev-standalone-mode-spec.md §3: a config asset pushed via `adb push`
    // to a known app-private path for emulator/debug-build testing.
    private fun configFile(context: Context): File =
        File(context.getExternalFilesDir(null), "3rdeye-dev-config.txt")

    fun tryLoad(context: Context): LocalConfig? {
        val file = configFile(context)
        if (!file.exists()) return null

        val values = mutableMapOf<String, String>()
        file.readLines().forEach { line ->
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("#")) return@forEach
            val idx = trimmed.indexOf('=')
            if (idx < 0) return@forEach
            values[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1).trim()
        }

        return LocalConfig(
            deviceId = values["device_id"] ?: "dev-device",
            backendUrl = values["backend_url"] ?: "", // blank by design — never synced in standalone mode
        )
    }
}
