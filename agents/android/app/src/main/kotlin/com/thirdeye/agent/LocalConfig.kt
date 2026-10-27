package com.thirdeye.agent

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

// android-agent-spec.md §2: EncryptedSharedPreferences, not a plain JSON
// file — the platform's own standard primitive for exactly this, not a
// literal port of the Windows agent's LocalConfig.cs approach.
data class LocalConfig(
    val deviceId: String,
    val backendUrl: String,
)

object LocalConfigStore {
    private const val PREFS_NAME = "thirdeye_config"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_BACKEND_URL = "backend_url"

    private fun prefs(context: Context) = EncryptedSharedPreferences.create(
        PREFS_NAME,
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun load(context: Context): LocalConfig? {
        val p = prefs(context)
        val deviceId = p.getString(KEY_DEVICE_ID, null) ?: return null
        val backendUrl = p.getString(KEY_BACKEND_URL, null) ?: return null
        return LocalConfig(deviceId, backendUrl)
    }

    fun save(context: Context, config: LocalConfig) {
        prefs(context).edit()
            .putString(KEY_DEVICE_ID, config.deviceId)
            .putString(KEY_BACKEND_URL, config.backendUrl)
            .apply()
    }
}
