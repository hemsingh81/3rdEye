using System.Runtime.InteropServices;

namespace ThirdEyeAgent;

// family-tier-spec.md §2.1: "block the device" via native Windows enforcement —
// here, locking the session, the same action a user triggers with Win+L. No
// private/undocumented APIs. Runs purely against the locally-cached Policy,
// so it works even with the device offline (the Phase 1 exit criterion in
// mvp-build-plan.md §3 is explicitly "works in airplane mode").
public class LockoutEnforcer
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool LockWorkStation();

    private readonly PolicyClient _policyClient;
    private TimeSpan _usedToday = TimeSpan.Zero;
    private DateTime _lastTickAt = DateTime.Now;
    private DateOnly _usageDate = DateOnly.FromDateTime(DateTime.Now);
    private bool _lockedForToday;
    private bool _lockedForBedtime;

    public event Action<string>? Locked;

    public LockoutEnforcer(PolicyClient policyClient)
    {
        _policyClient = policyClient;
    }

    // Call this on a ~1-minute timer. Shortcut: usage is measured as
    // "agent process alive" time, not real per-app foreground tracking
    // (that's E1/E2-equivalent work, not needed for the F1 lockout slice) —
    // upgrade when Phase 2 adds per-app limits.
    public void Tick()
    {
        var now = DateTime.Now;
        var today = DateOnly.FromDateTime(now);
        if (today != _usageDate)
        {
            _usageDate = today;
            _usedToday = TimeSpan.Zero;
            _lockedForToday = false;
        }

        _usedToday += now - _lastTickAt;
        _lastTickAt = now;

        var policy = _policyClient.GetCachedPolicy();
        if (policy is null) return; // not enrolled / no policy synced yet — nothing to enforce

        if (_usedToday.TotalMinutes >= policy.DailyLimitMinutes)
        {
            // Lock once per day, not every tick, once the limit is already hit —
            // the session stays locked on its own; repeat-firing would just spam
            // the balloon notification every minute.
            if (!_lockedForToday)
            {
                _lockedForToday = true;
                Lock($"Daily screen time limit reached ({policy.DailyLimitMinutes} min).");
            }
            return;
        }

        if (IsBedtime(policy, now))
        {
            if (!_lockedForBedtime)
            {
                _lockedForBedtime = true;
                Lock($"Bedtime ({policy.BedtimeStart}–{policy.BedtimeEnd}).");
            }
        }
        else
        {
            _lockedForBedtime = false; // outside the window again — re-arm for the next bedtime
        }
    }

    private static bool IsBedtime(Policy policy, DateTime now)
    {
        if (policy.BedtimeStart is null || policy.BedtimeEnd is null) return false;
        var start = TimeOnly.Parse(policy.BedtimeStart);
        var end = TimeOnly.Parse(policy.BedtimeEnd);
        var current = TimeOnly.FromDateTime(now);
        return start > end
            ? current >= start || current < end // window crosses midnight (e.g. 21:00–07:00)
            : current >= start && current < end;
    }

    private void Lock(string reason)
    {
        Locked?.Invoke(reason);
        LockWorkStation();
    }
}
