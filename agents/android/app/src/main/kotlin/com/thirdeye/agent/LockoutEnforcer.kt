package com.thirdeye.agent

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

// android-agent-spec.md §3 (explicit instruction): carries over the
// Windows LockoutEnforcer's two review fixes from day one, not as bugs to
// rediscover on this platform — (1) a date-rollover reset so usage doesn't
// accumulate forever, (2) per-trigger guards so a lock doesn't re-fire
// every callback once triggered. Driven by the AccessibilityService's
// foreground-app callback instead of a timer tick (android-agent-spec.md
// §1) — UsageStatsManager gives real per-app time here, not the "process
// alive" approximation Windows uses for this slice.
class LockoutEnforcer(
    private val policyClient: PolicyClient,
    private val eventQueue: EventQueue,
    private val onLocked: (String) -> Unit,
) {
    private var usedTodayMinutes = 0.0
    private var lastTickAt: Instant = Instant.now()
    private var usageDate: LocalDate = LocalDate.now()
    private var sessionStartedAt: Instant = Instant.now()
    private var lockedForToday = false
    private var lockedForBedtime = false

    // Call this from the AccessibilityService's onAccessibilityEvent, not a
    // fixed timer — same semantic role as the Windows agent's Tick().
    fun onForegroundAppChanged(now: Instant = Instant.now()) {
        val today = LocalDate.now()
        if (today != usageDate) {
            usageDate = today
            usedTodayMinutes = 0.0
            lockedForToday = false
        }

        usedTodayMinutes += Duration.between(lastTickAt, now).toMillis() / 60000.0
        lastTickAt = now

        val policy = policyClient.getCachedPolicy() ?: return // not enrolled / no policy synced yet

        if (usedTodayMinutes >= policy.dailyLimitMinutes) {
            if (!lockedForToday) {
                lockedForToday = true
                lock("Daily screen time limit reached (${policy.dailyLimitMinutes} min).")
            }
            return
        }

        if (isBedtime(policy, now)) {
            if (!lockedForBedtime) {
                lockedForBedtime = true
                lock("Bedtime (${policy.bedtimeStart}-${policy.bedtimeEnd}).")
            }
        } else {
            lockedForBedtime = false // outside the window again — re-arm for the next bedtime
        }
    }

    private fun isBedtime(policy: Policy, now: Instant): Boolean {
        val start = policy.bedtimeStart?.let { LocalTime.parse(it) } ?: return false
        val end = policy.bedtimeEnd?.let { LocalTime.parse(it) } ?: return false
        val current = now.atZone(ZoneId.systemDefault()).toLocalTime()
        return if (start > end) {
            current >= start || current < end // window crosses midnight (e.g. 21:00-07:00)
        } else {
            current >= start && current < end
        }
    }

    private fun lock(reason: String) {
        val now = Instant.now()
        eventQueue.enqueueAlert("daily_limit_reached", reason)
        eventQueue.enqueueUsage(sessionStartedAt.toString(), now.toString())
        sessionStartedAt = now
        onLocked(reason) // caller draws the full-screen overlay
    }
}
