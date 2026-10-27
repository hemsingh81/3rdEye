#if DEBUG
namespace ThirdEyeAgent;

// Parses dev-tools/dev-standalone-config.sample.txt's format — see
// docs/specs/dev-standalone-mode-spec.md. Debug-only by construction: this
// whole file is wrapped in #if DEBUG, so it cannot ship in a release build
// even if someone forgets to strip the dev config file off disk.
public static class DevStandaloneConfig
{
    public static LocalConfig Parse(string path)
    {
        var values = new Dictionary<string, string>();
        foreach (var line in File.ReadAllLines(path))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith("#")) continue;
            var idx = trimmed.IndexOf('=');
            if (idx < 0) continue;
            values[trimmed[..idx].Trim()] = trimmed[(idx + 1)..].Trim();
        }

        return new LocalConfig
        {
            DeviceId = values.GetValueOrDefault("device_id", "dev-device"),
            BackendUrl = values.GetValueOrDefault("backend_url", ""), // blank by design — never synced in standalone mode
            LocalDataDir = Environment.ExpandEnvironmentVariables(
                values.GetValueOrDefault("local_data_dir", @"%PROGRAMDATA%\3rdEye\dev\")),
        };
    }
}
#endif
