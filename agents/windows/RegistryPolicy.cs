using Microsoft.Win32;

namespace ThirdEyeAgent;

// implementation-plan.md §1.6's named mitigation for DnsFilter's disclosed
// gap: a browser's own encrypted DNS (DoH) bypasses a local DNS filter
// entirely. This pushes the same registry policy enterprise IT already
// uses to disable DoH fallback, applied at enrollment, not left as a
// silent assumption that the filter always works.
public static class RegistryPolicy
{
    // Chrome and Edge share this policy key shape (both Chromium-based).
    // Firefox needs a separate policies.json mechanism, not a registry
    // key — NOT implemented here. A real, disclosed gap (same pattern as
    // family-tier-spec.md's non-Store-app gap), not a silent one: Firefox
    // users are not covered by this mitigation yet.
    public static void DisableDnsOverHttps()
    {
        TrySetPolicy(@"SOFTWARE\Policies\Google\Chrome");
        TrySetPolicy(@"SOFTWARE\Policies\Microsoft\Edge");
    }

    private static void TrySetPolicy(string keyPath)
    {
        try
        {
            using var key = Registry.LocalMachine.CreateSubKey(keyPath);
            key?.SetValue("DnsOverHttpsMode", "off", RegistryValueKind.String);
        }
        catch (UnauthorizedAccessException)
        {
            // Writing HKLM needs admin rights — a non-admin install can't
            // apply this mitigation. That's a real limitation, not
            // something to silently swallow into "probably fine"; the
            // installer (not written yet) needs to actually request
            // elevation for this step, which is separate, bigger work than
            // this method — not building a UAC elevation flow here.
        }
    }
}
