using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32;

namespace ThirdEyeAgent;

// A plain record, not a ValueTuple — System.Text.Json doesn't reliably
// preserve ValueTuple element names, which would have silently serialized
// as {"Item1":...,"Item2":...} instead of the shape the backend expects.
public record InstalledApp(
    [property: JsonPropertyName("app_id")] string AppId,
    [property: JsonPropertyName("install_source")] string InstallSource
);

// STORY-11: reports what's actually installed, Store or not — family-
// tier-spec.md §2.1's Windows install-gate only covers the Microsoft Store;
// a sideloaded app shows up here precisely because the gate didn't catch
// it, which is the documented gap this story's block-from-running (not
// install-gate) capability exists to cover.
public class InstalledAppInventory
{
    private readonly HttpClient _http;
    private readonly string _deviceId;

    // AppBlockEnforcer matches against this, not every running process —
    // scoping enforcement to apps this agent has actually seen in the
    // registry keeps a name-matching heuristic from ever touching
    // software that was never part of this inventory in the first place.
    public IReadOnlyList<string> LastKnownAppIds { get; private set; } = Array.Empty<string>();

    public InstalledAppInventory(string backendUrl, string deviceId)
    {
        _http = new HttpClient { BaseAddress = new Uri(backendUrl) };
        _deviceId = deviceId;
    }

    // Shortcut: posts the FULL current inventory every poll, not a diff
    // against a locally-cached previous list. The backend's insert is
    // already idempotent (UNIQUE(device_id, app_id), upserts detected_at)
    // per migration 007, so a diff here would only save bandwidth, not
    // correctness — not worth the extra local-state file for that.
    public async Task ReportAsync()
    {
        var apps = Enumerate().ToList();
        LastKnownAppIds = apps.Select(a => a.AppId).ToList();
        if (apps.Count == 0) return;

        try
        {
            await _http.PostAsJsonAsync($"/api/devices/{_deviceId}/installed-apps", new { apps });
        }
        catch (HttpRequestException)
        {
            // Offline — next poll tries again; this inventory isn't queued
            // locally like EventQueue's events are, because re-enumerating
            // the registry next poll costs nothing and always gives the
            // current truth, unlike a point-in-time event that must be
            // preserved exactly.
        }
    }

    private static IEnumerable<InstalledApp> Enumerate()
    {
        foreach (var hive in new[]
                 {
                     @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                     @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
                 })
        {
            using var key = Registry.LocalMachine.OpenSubKey(hive);
            if (key is null) continue;

            foreach (var subKeyName in key.GetSubKeyNames())
            {
                using var subKey = key.OpenSubKey(subKeyName);
                var displayName = subKey?.GetValue("DisplayName") as string;
                // Entries with no DisplayName are almost always updates/
                // patches, not real applications — skip them rather than
                // reporting noise a parent would have to sift through.
                if (string.IsNullOrWhiteSpace(displayName)) continue;

                var installLocation = subKey?.GetValue("InstallLocation") as string;
                yield return new InstalledApp(displayName, installLocation ?? "registry");
            }
        }
    }
}
