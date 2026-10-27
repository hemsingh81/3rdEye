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
    private lateinit var appInventory: InstalledAppInventory
    private lateinit var locationClient: LocationClient
    private val syncHandler = Handler(Looper.getMainLooper())
    private val locationHandler = Handler(Looper.getMainLooper())

    // STORY-12: debounces repeated lock-overlay launches for the SAME
    // blocked package — without this, every TYPE_WINDOW_STATE_CHANGED
    // event while the user keeps trying to reopen a blocked app would
    // relaunch LockedActivity again, which is itself a foreground-change
    // event, which could cascade. Same respawn-guard reasoning as the
    // Windows AppBlockEnforcer's debounce, applied to the overlay instead
    // of a process kill.
    private val lastBlockedAt = mutableMapOf<String, Long>()
    private val blockDebounceMs = 3000L

    override fun onServiceConnected() {
        super.onServiceConnected()
        val config = LocalConfigStore.load(this) ?: return // not enrolled — nothing to enforce

        policyClient = PolicyClient(this, config.backendUrl, config.deviceId)
        eventQueue = EventQueue(this, config.backendUrl, config.deviceId)
        appInventory = InstalledAppInventory(this, config.backendUrl, config.deviceId)
        locationClient = LocationClient(this, policyClient, eventQueue)
        enforcer = LockoutEnforcer(policyClient, eventQueue, ::showLockedOverlay)

        startForegroundNotification()
        Thread { appInventory.report() }.start() // one-time report on start, per android-agent-spec.md's F3 extension
        scheduleSyncLoop()
        scheduleLocationLoop()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return

        // Never evaluate our own app — it's a regular (non-system)
        // installed package that would otherwise get reported and
        // default-denied like anything else, which would make the agent
        // lock itself out the first time it comes to the foreground.
        if (pkg == packageName) return

        if (isBlockedApp(pkg)) {
            val now = System.currentTimeMillis()
            val last = lastBlockedAt[pkg]
            if (last == null || now - last > blockDebounceMs) {
                lastBlockedAt[pkg] = now
                eventQueue.enqueueAlert("app_blocked", "Blocked: $pkg")
                showLockedOverlay("This app isn't approved yet. Ask your parent if you think this is wrong.")
            }
            return
        }

        enforcer.onForegroundAppChanged()
    }

    override fun onInterrupt() {}

    // F3 "block from running," Android's version of the Windows
    // AppBlockEnforcer's scoping rule: only ever evaluate a package this
    // agent has actually reported via InstalledAppInventory — a system/
    // launcher package that was never part of anyone's approval flow
    // can't be accidentally blocked just because it isn't on an allowlist
    // nobody was ever asked to put it on.
    private fun isBlockedApp(pkg: String): Boolean {
        val policy = policyClient.getCachedPolicy() ?: return false
        if (policy.appControlMode != "default_deny") return false
        if (!appInventory.lastKnownAppIds.contains(pkg)) return false
        return !policy.appAllowlist.contains(pkg)
    }

    // STORY-01/offline-sync-spec.md §4: policy pull first, then flush the
    // event queue, same order as the Windows agent's sync timer — every
    // 5 minutes here too, for consistency across platforms. STORY-12 adds
    // a periodic inventory re-report alongside it, not a third timer.
    private fun scheduleSyncLoop() {
        syncHandler.postDelayed(object : Runnable {
            override fun run() {
                Thread {
                    policyClient.syncAndGetPolicy()
                    eventQueue.flush()
                    appInventory.report()
                }.start()
                syncHandler.postDelayed(this, 5 * 60 * 1000L)
            }
        }, 5 * 60 * 1000L)
    }

    // STORY-13: a separate timer from scheduleSyncLoop, same reasoning as
    // the Windows agent's separate locationTimer — location calls don't
    // need the 5-minute sync cadence, and mixing it into that loop would
    // couple two independently-tunable intervals for no benefit.
    private fun scheduleLocationLoop() {
        locationHandler.postDelayed(object : Runnable {
            override fun run() {
                locationClient.tick()
                locationHandler.postDelayed(this, 2 * 60 * 1000L)
            }
        }, 2 * 60 * 1000L)
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
