package com.thirdeye.agent

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

// STORY-13: F4 location + geofence — FusedLocationProviderClient is the
// standard Android mechanism (not a private API). family-tier-spec.md
// §2.1's Android row already names this as the native path; the on-device
// geofence math is the same GeofenceMath logic ported from the Windows
// agent's own file, not shared code (different languages), kept formula-
// identical so the two platforms can't disagree on an edge case.
class LocationClient(
    private val context: Context,
    private val policyClient: PolicyClient,
    private val eventQueue: EventQueue,
) {
    private val fusedClient = LocationServices.getFusedLocationProviderClient(context)
    private var currentGeofenceId: String? = null // null = outside every defined zone

    fun tick() {
        val policy = policyClient.getCachedPolicy() ?: return

        val hasPermission = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        // Same explicit-permission-walk discipline as UsageStatsManager/
        // Accessibility — this doesn't request the permission itself
        // (that needs an Activity context + a runtime dialog); MainActivity
        // handles the request, this just checks before using it rather
        // than assuming it's silently granted.
        if (!hasPermission) return

        val cancellation = CancellationTokenSource()
        fusedClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cancellation.token)
            .addOnSuccessListener { location ->
                if (location == null) return@addOnSuccessListener // no fix available this tick — try again next tick

                val rules = policy.geofenceRules
                val matchedRule = rules.firstOrNull { GeofenceMath.isInside(location.latitude, location.longitude, it) }
                val newGeofenceId = matchedRule?.id

                eventQueue.enqueueLocation(location.latitude, location.longitude, newGeofenceId)

                if (newGeofenceId != currentGeofenceId) {
                    if (matchedRule != null) {
                        eventQueue.enqueueAlert("geofence_entry", "Arrived at: ${matchedRule.name}")
                    } else {
                        val leftRule = rules.firstOrNull { it.id == currentGeofenceId }
                        if (leftRule != null) {
                            eventQueue.enqueueAlert("geofence_exit", "Left: ${leftRule.name}")
                        }
                    }
                    currentGeofenceId = newGeofenceId
                }
            }
        // No addOnFailureListener-driven retry — a missed fix this tick
        // is covered by the next scheduled tick; this class doesn't crash
        // the agent over a location request that failed or timed out.
    }
}
