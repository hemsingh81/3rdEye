using System.Text.Json;

namespace ThirdEyeAgent;

// Mirrors offline-sync-spec.md §3: policy cache + device identity live in a
// local, durable store so the agent works with zero connectivity. For this
// MVP slice that's a JSON file, not the full embedded-DB/event-queue design —
// shortcut: no event queue yet, upgrade when Phase 1 adds usage/alert events.
public class LocalConfig
{
    public string DeviceId { get; set; } = "";
    public string BackendUrl { get; set; } = "";
    public string LocalDataDir { get; set; } = "";

    private static string ConfigPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "3rdEye", "config.json");

    public static LocalConfig? Load()
    {
#if DEBUG
        // dev-standalone-mode-spec.md §3: a dev build only, never present in
        // a release build — compiled out entirely via the #if DEBUG guard,
        // not just disabled by default.
        var devConfigPath = Path.Combine(AppContext.BaseDirectory, "3rdeye-dev-config.txt");
        if (File.Exists(devConfigPath))
        {
            return DevStandaloneConfig.Parse(devConfigPath);
        }
#endif
        if (!File.Exists(ConfigPath)) return null;
        return JsonSerializer.Deserialize<LocalConfig>(File.ReadAllText(ConfigPath));
    }

    public void Save()
    {
        var dir = Path.GetDirectoryName(ConfigPath)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(this));
    }
}
