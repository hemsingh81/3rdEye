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
    [property: JsonPropertyName("content_filter_categories")] string[] ContentFilterCategories
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
