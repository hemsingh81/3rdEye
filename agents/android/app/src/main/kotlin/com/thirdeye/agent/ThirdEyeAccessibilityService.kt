package com.thirdeye.agent

import android.accessibilityservice.AccessibilityService
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import android.view.accessibility.AccessibilityEvent

// android-agent-spec.md §2: Android's non-hideable-icon equivalent (X1) —
// a persistent foreground-service notification, forced by the platform's
// own background-execution rules rather than bolted on as an extra
// feature. Drives LockoutEnforcer from the foreground-app callback
// (android-agent-spec.md §1), not a timer tick.
class ThirdEyeAccessibilityService : AccessibilityService() {
    private lateinit var policyClient: PolicyClient
    private lateinit var eventQueue: EventQueue
    private lateinit var enforcer: LockoutEnforcer
    private val syncHandler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        super.onServiceConnected()
        val config = LocalConfigStore.load(this) ?: return // not enrolled — nothing to enforce

        policyClient = PolicyClient(this, config.backendUrl, config.deviceId)
        eventQueue = EventQueue(this, config.backendUrl, config.deviceId)
        enforcer = LockoutEnforcer(policyClient, eventQueue, ::showLockedOverlay)

        startForegroundNotification()
        scheduleSyncLoop()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            enforcer.onForegroundAppChanged()
        }
    }

    override fun onInterrupt() {}

    // STORY-01/offline-sync-spec.md §4: policy pull first, then flush the
    // event queue, same order as the Windows agent's sync timer — every
    // 5 minutes here too, for consistency across platforms.
    private fun scheduleSyncLoop() {
        syncHandler.postDelayed(object : Runnable {
            override fun run() {
                Thread {
                    policyClient.syncAndGetPolicy()
                    eventQueue.flush()
                }.start()
                syncHandler.postDelayed(this, 5 * 60 * 1000L)
            }
        }, 5 * 60 * 1000L)
    }

    private fun startForegroundNotification() {
        val channelId = "thirdeye_active"
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(channelId, "3rdEye active", NotificationManager.IMPORTANCE_LOW),
        )
        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("3rdEye — active")
            .setContentText("Screen time, location, app installs, web category. Never: messages, mic, camera.")
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock) // placeholder — real app icon TBD, not a design decision this service makes
            .setOngoing(true)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }

    // Shortcut: a full-screen Activity launched on top, not a true
    // WindowManager SYSTEM_ALERT_WINDOW overlay — simpler, needs no extra
    // permission, but a determined user could switch away via the recents
    // screen before it draws. Named here, not silently assumed robust;
    // upgrade to a real overlay if that gap turns out to matter in
    // practice, same "measure before upgrading" discipline as the F2 DNS
    // filter's DoH gap.
    private fun showLockedOverlay(reason: String) {
        val intent = Intent(this, LockedActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.putExtra("reason", reason)
        startActivity(intent)
    }

    companion object {
        private const val NOTIFICATION_ID = 1
    }
}
