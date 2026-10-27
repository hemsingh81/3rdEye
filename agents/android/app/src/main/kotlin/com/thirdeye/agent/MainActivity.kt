package com.thirdeye.agent

import android.app.Activity
import android.app.AppOpsManager
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

// Android counterpart to agents/windows/Program.cs's enrollment branch +
// EnrollmentForm.cs — same flow: enroll, then consent, then (here) the
// explicit accessibility/usage-stats permission walk android-agent-
// spec.md §4 calls for, before the accessibility service can actually
// enforce anything.
class MainActivity : Activity() {
    private val http = OkHttpClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val config = LocalConfigStore.load(this)
        if (config == null) {
            showEnrollmentScreen()
        } else {
            proceedToPermissionsAndLaunch(config)
        }
    }

    private fun showEnrollmentScreen() {
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 60, 40, 40) }
        val backendField = EditText(this).apply { hint = "Backend URL"; setText("http://10.0.2.2:8097") }
        val codeField = EditText(this).apply { hint = "Enrollment code" }
        val error = TextView(this)
        val enrollButton = Button(this).apply { text = "Enroll" }

        enrollButton.setOnClickListener {
            val backendUrl = backendField.text.toString().trim()
            val code = codeField.text.toString().trim()
            Thread {
                try {
                    val request = Request.Builder().url("$backendUrl/api/devices/by-code/$code").build()
                    http.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) {
                            runOnUiThread { error.text = "That code wasn't recognized. Check it and try again." }
                            return@use
                        }
                        val body = JSONObject(response.body!!.string())
                        val deviceId = body.getJSONObject("device").getString("id")
                        val config = LocalConfig(deviceId, backendUrl)
                        LocalConfigStore.save(this, config)
                        runOnUiThread { proceedToPermissionsAndLaunch(config) }
                    }
                } catch (e: java.io.IOException) {
                    runOnUiThread { error.text = "Couldn't reach that backend address. Check it and try again." }
                }
            }.start()
        }

        layout.addView(backendField)
        layout.addView(codeField)
        layout.addView(error)
        layout.addView(enrollButton)
        setContentView(layout)
    }

    private fun proceedToPermissionsAndLaunch(config: LocalConfig) {
        val policyClient = PolicyClient(this, config.backendUrl, config.deviceId)
        if (policyClient.getCachedPolicy() == null) {
            val intent = Intent(this, ConsentActivity::class.java)
            intent.putExtra("backend_url", config.backendUrl)
            intent.putExtra("device_id", config.deviceId)
            startActivityForResult(intent, REQUEST_CONSENT)
            return
        }
        promptForPermissionsIfNeeded()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CONSENT && resultCode == Activity.RESULT_OK) {
            promptForPermissionsIfNeeded()
        }
    }

    // android-agent-spec.md §4: UsageStatsManager and the accessibility
    // service both require a system settings screen the app cannot
    // auto-navigate past — this is the explicit "now go grant this
    // permission" step, with its own plain-language reason, not an
    // assumption either is silently available after consent.
    private fun promptForPermissionsIfNeeded() {
        if (!hasUsageStatsPermission()) {
            Toast("3rdEye needs Usage Access to enforce screen-time limits. Opening settings…")
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            return
        }
        if (!isAccessibilityServiceEnabled()) {
            Toast("3rdEye needs Accessibility access to know which app is in front. Opening settings…")
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            return
        }
        finish() // enforcement runs entirely in ThirdEyeAccessibilityService from here on
    }

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = getSystemService(AppOpsManager::class.java)
        val mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val enabledServices = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return enabledServices.contains(ThirdEyeAccessibilityService::class.java.name)
    }

    private fun Toast(message: String) = android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show()

    companion object {
        private const val REQUEST_CONSENT = 1
    }
}
