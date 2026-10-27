package com.thirdeye.agent

import android.app.Activity
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView

// The full-screen lock itself — Android's equivalent of LockWorkStation().
// Deliberately offers no way to dismiss from inside the app; only the
// parent's own policy change (or the limit/bedtime window ending) clears
// it, same enforcement model as the Windows agent.
class LockedActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val reason = intent.getStringExtra("reason") ?: "Screen time limit reached."

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(60, 200, 60, 60)
        }
        layout.addView(TextView(this).apply {
            text = "3rdEye\n\n$reason"
            textSize = 20f
        })
        setContentView(layout)
    }

    override fun onBackPressed() {
        // Deliberately does nothing — this screen isn't dismissable by the
        // user, same as the Windows agent's lock screen isn't bypassable
        // by the child without the parent's own unlock mechanism.
    }
}
