using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ThirdEyeAgent;

public record Policy(
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("version")] int Version,
    [property: JsonPropertyName("daily_limit_minutes")] int DailyLimitMinutes,
    [property: JsonPropertyName("bedtime_start")] string? BedtimeStart,
    [property: JsonPropertyName("bedtime_end")] string? BedtimeEnd,
    [property: JsonPropertyName("content_filter_categories")] string[] ContentFilterCategories,
    // STORY-11: added after a review catch — the backend had these columns
    // (STORY-10) but never actually returned them from the policy-pull
    // endpoint, so no agent could ever know what to enforce. Fixed in
    // policy.ts; app_allowlist arrives as a flat array of app_id strings
    // (approved_at/approved_by aren't needed for matching).
    [property: JsonPropertyName("app_control_mode")] string? AppControlMode,
    [property: JsonPropertyName("app_allowlist")] string[]? AppAllowlist,
    // STORY-13: full objects, not flattened like AppAllowlist — the agent
    // needs the name (for the alert message) and the math inputs
    // (lat/lon/radius), not just an id.
    [property: JsonPropertyName("geofence_rules")] GeofenceRule[]? GeofenceRules,
    // STORY-15: nullable like the other additive fields above — an older
    // cached policy_cache.json on disk (written before this field existed)
    // deserializes with these as null, not a crash.
    [property: JsonPropertyName("custom_blocked_domains")] string[]? CustomBlockedDomains,
    [property: JsonPropertyName("custom_allowed_domains")] string[]? CustomAllowedDomains
);

public record GeofenceRule(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("lat")] double Lat,
    [property: JsonPropertyName("lon")] double Lon,
    [property: JsonPropertyName("radius_meters")] double RadiusMeters
);

// offline-sync-spec.md §4: on connectivity, pull policy first, cache it
// locally, and enforce from the cache either way — a fetch failure (offline)
// is the normal case, not an error path.
public class PolicyClient
{
    private readonly HttpClient _http;
    private readonly string _cachePath;

    public PolicyClient(string backendUrl, string deviceId, string localDataDir)
    {
        _http = new HttpClient { BaseAddress = new Uri(backendUrl) };
        Directory.CreateDirectory(localDataDir);
        _cachePath = Path.Combine(localDataDir, "policy_cache.json");
        DeviceId = deviceId;
    }

    public string DeviceId { get; }

    public async Task<Policy?> SyncAndGetPolicyAsync()
    {
        try
        {
            var fetched = await _http.GetFromJsonAsync<Policy>($"/api/devices/{DeviceId}/policy");
            if (fetched is not null)
            {
                File.WriteAllText(_cachePath, JsonSerializer.Serialize(fetched));
                return fetched;
            }
        }
        catch (HttpRequestException)
        {
            // No connectivity — fall through to the local cache below.
        }

        return GetCachedPolicy();
    }

    public Policy? GetCachedPolicy()
    {
        if (!File.Exists(_cachePath)) return null;
        return JsonSerializer.Deserialize<Policy>(File.ReadAllText(_cachePath));
    }
}
