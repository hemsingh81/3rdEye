using System.Diagnostics;

namespace ThirdEyeAgent;

// STORY-11: F3 "block from running" — family-tier-spec.md §2.1's Windows
// column is explicit that this isn't AppLocker/WDAC-grade enforcement
// (Enterprise-edition-only); the smallest-complete thing available on a
// Home/Pro install is a background watcher that terminates a blocked
// app's process when it's found running. Named limitation, not hidden:
// matching a running process to an installed app is a heuristic
// (normalized substring match on process name vs. the app's registry
// DisplayName), not a guaranteed-correct mapping — see MatchesBlockedApp.
public class AppBlockEnforcer
{
    private readonly PolicyClient _policyClient;
    private readonly InstalledAppInventory _inventory;
    private readonly EventQueue _eventQueue;

    // Respawn guard: without this, a process that immediately relaunches
    // after being killed would get killed again every single poll tick,
    // which would look like a crash-loop to the user and hammer the
    // process table for no benefit. Debounce per app_id, and after too
    // many consecutive respawns, back off and alert instead of continuing
    // to fight it silently.
    private readonly Dictionary<string, DateTime> _lastKillAttempt = new();
    private readonly Dictionary<string, int> _consecutiveRespawns = new();
    private readonly HashSet<string> _gaveUpOn = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan KillDebounce = TimeSpan.FromSeconds(10);
    private const int RespawnAlertThreshold = 3;

    public event Action<string>? Blocked;

    public AppBlockEnforcer(PolicyClient policyClient, InstalledAppInventory inventory, EventQueue eventQueue)
    {
        _policyClient = policyClient;
        _inventory = inventory;
        _eventQueue = eventQueue;
    }

    public void Tick()
    {
        var policy = _policyClient.GetCachedPolicy();
        if (policy is null || policy.AppControlMode != "default_deny") return;

        var allowlist = new HashSet<string>(policy.AppAllowlist ?? Array.Empty<string>(), StringComparer.OrdinalIgnoreCase);
        var blockedAppIds = _inventory.LastKnownAppIds.Where(id => !allowlist.Contains(id)).ToList();
        if (blockedAppIds.Count == 0) return;

        Process[] processes;
        try
        {
            processes = Process.GetProcesses();
        }
        catch (Exception)
        {
            return; // enumerating processes failed — try again next tick, don't crash the agent over it
        }

        foreach (var process in processes)
        {
            try
            {
                var matchedAppId = blockedAppIds.FirstOrDefault(appId => MatchesBlockedApp(process.ProcessName, appId));
                if (matchedAppId is null) continue;

                // Already gave up on this one — fire the alert exactly
                // once (handled at the moment we gave up, below), not
                // every tick thereafter. Still skipped here even if the
                // process is still running, until the allowlist changes
                // and it drops out of blockedAppIds entirely.
                if (_gaveUpOn.Contains(matchedAppId)) continue;

                if (_lastKillAttempt.TryGetValue(matchedAppId, out var lastAttempt) && DateTime.Now - lastAttempt < KillDebounce)
                {
                    continue; // already tried recently — don't hammer it
                }

                _lastKillAttempt[matchedAppId] = DateTime.Now;
                _consecutiveRespawns[matchedAppId] = _consecutiveRespawns.GetValueOrDefault(matchedAppId) + 1;

                if (_consecutiveRespawns[matchedAppId] > RespawnAlertThreshold)
                {
                    // Stop fighting it, exactly once — surface the honest
                    // state instead of silently hammering kill attempts
                    // (or alerts about failing to) forever.
                    _gaveUpOn.Add(matchedAppId);
                    _eventQueue.EnqueueAlert("app_block_failed", $"{matchedAppId} kept restarting after being blocked — stopped auto-blocking it.");
                    continue;
                }

                process.Kill();
                _eventQueue.EnqueueAlert("app_blocked", $"Blocked: {matchedAppId}");
                Blocked?.Invoke(matchedAppId);
            }
            catch (InvalidOperationException)
            {
                // The process already exited between GetProcesses() and
                // here — not an error, just a race with reality.
            }
            catch (Exception)
            {
                // Covers access-denied killing an elevated/system process,
                // among other things Process.Kill() can throw. Must not
                // crash the agent over one process it couldn't terminate —
                // the exact d040b88 bug class, applied to a new mechanism.
            }
        }
    }

    // Heuristic, deliberately: a process's image name ("chrome") and its
    // installed app's registry DisplayName ("Google Chrome") are not the
    // same string. Normalizing both (strip spaces/punctuation, lowercase)
    // and checking containment catches the common case without claiming
    // a guaranteed-correct mapping — a real one would need the install
    // path correlated to the running executable, which this slice doesn't
    // attempt.
    private static bool MatchesBlockedApp(string processName, string appId)
    {
        var normalizedProcess = Normalize(processName);
        var normalizedApp = Normalize(appId);
        if (normalizedProcess.Length < 3) return false; // too short to match meaningfully, avoid false positives
        return normalizedApp.Contains(normalizedProcess, StringComparison.OrdinalIgnoreCase);
    }

    private static string Normalize(string s) => new(s.Where(char.IsLetterOrDigit).ToArray());
}
