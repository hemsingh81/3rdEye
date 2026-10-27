using Windows.Devices.Geolocation;

namespace ThirdEyeAgent;

// STORY-13: F4 location + geofence — native Windows Location API
// (Windows.Devices.Geolocation.Geolocator), the documented desktop
// column's own "accuracy varies by hardware, often Wi-Fi/IP-based only"
// caveat from family-tier-spec.md §2.1 applies here; this doesn't attempt
// to improve on whatever the OS itself reports.
public class LocationClient
{
    private readonly PolicyClient _policyClient;
    private readonly EventQueue _eventQueue;
    private readonly Geolocator _geolocator = new();
    private string? _currentGeofenceId; // null = outside every defined zone
    private bool? _accessGranted; // null = not yet requested this run

    public LocationClient(PolicyClient policyClient, EventQueue eventQueue)
    {
        _policyClient = policyClient;
        _eventQueue = eventQueue;
    }

    public async Task TickAsync()
    {
        var policy = _policyClient.GetCachedPolicy();
        if (policy is null) return;

        // Requested once per run, same explicit-permission-walk discipline
        // android-agent-spec.md §4 already applies to UsageStatsManager/
        // Accessibility — never assumed silently available. If denied,
        // every subsequent tick returns early without re-prompting.
        if (_accessGranted is null)
        {
            var status = await Geolocator.RequestAccessAsync();
            _accessGranted = status == GeolocationAccessStatus.Allowed;
        }
        if (_accessGranted != true) return;

        Geoposition position;
        try
        {
            position = await _geolocator.GetGeopositionAsync();
        }
        catch (Exception)
        {
            // Location unavailable (permission denied, no hardware, or a
            // transient OS error) — try again next tick, don't crash the
            // agent over a reading it couldn't get this time.
            return;
        }

        var lat = position.Coordinate.Point.Position.Latitude;
        var lon = position.Coordinate.Point.Position.Longitude;

        var rules = policy.GeofenceRules ?? Array.Empty<GeofenceRule>();
        var matchedRule = rules.FirstOrDefault(r => GeofenceMath.IsInside(lat, lon, r));
        var newGeofenceId = matchedRule?.Id;

        _eventQueue.EnqueueLocation(lat, lon, newGeofenceId);

        // Entry/exit detected on-device, zero round-trip — the alert is
        // queued the same way a lockout alert is, through EnqueueAlert;
        // offline-sync-spec.md §2 calls this "Partial offline": detection
        // works offline, the parent's notification waits for sync.
        if (newGeofenceId != _currentGeofenceId)
        {
            if (matchedRule is not null)
            {
                _eventQueue.EnqueueAlert("geofence_entry", $"Arrived at: {matchedRule.Name}");
            }
            else
            {
                var leftRule = rules.FirstOrDefault(r => r.Id == _currentGeofenceId);
                if (leftRule is not null)
                {
                    _eventQueue.EnqueueAlert("geofence_exit", $"Left: {leftRule.Name}");
                }
            }
            _currentGeofenceId = newGeofenceId;
        }
    }
}
