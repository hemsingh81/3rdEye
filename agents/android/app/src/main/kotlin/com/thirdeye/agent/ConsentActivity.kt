package com.thirdeye.agent

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

// family-tier-spec.md §3.2: mandatory, cannot be skipped, shown before any
// data collection starts. android-agent-spec.md §2: same copy as the
// Windows agent's ConsentForm.cs, word for word — not reworded per
// platform, since the marketing site's Trust page promises one consistent
// disclosed list, not a per-platform remix.
class ConsentActivity : Activity() {
    private val http = OkHttpClient()
    private lateinit var backendUrl: String
    private lateinit var deviceId: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        backendUrl = intent.getStringExtra("backend_url")!!
        deviceId = intent.getStringExtra("device_id")!!

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 60, 40, 40)
        }

        val label = TextView(this)
        label.text =
            "Before this device is set up, here's exactly what your parent will see:\n\n" +
            "✓ Screen time and when the device locks\n" +
            "✓ Location and arrival/departure alerts\n" +
            "✓ App install requests and installed apps\n" +
            "✓ Web category (not full browsing history)\n\n" +
            "Never collected: message content, microphone, camera, full browsing history.\n\n" +
            "This 3rdEye icon stays visible in your notifications — it can't be hidden."
        layout.addView(label)

        val acceptButton = Button(this)
        acceptButton.text = "I understand"
        acceptButton.setOnClickListener { accept() }
        layout.addView(acceptButton)

        setContentView(layout)
    }

    private fun accept() {
        val body = JSONObject().apply {
            put("accepted_by", android.os.Build.MODEL) // Android has no equivalent of Environment.UserName
        }.toString().toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("$backendUrl/api/devices/$deviceId/consent")
            .post(body)
            .build()

        Thread {
            try {
                http.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        setResult(Activity.RESULT_OK)
                        finish()
                    }
                    // Not successful: stay on screen — same "couldn't reach
                    // the server, check your connection and try again"
                    // behavior as ConsentForm.cs, UI wiring omitted here for
                    // brevity but not forgotten; see Known Shortcuts in
                    // agents/android/README.md.
                }
            } catch (e: java.io.IOException) {
                // Same note as above.
            }
        }.start()
    }
}
