namespace ThirdEyeAgent;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();

        var config = LocalConfig.Load();
        if (config is null)
        {
            // STORY-02: no local config means this copy was never enrolled —
            // ask for the enrollment code the parent generated from the
            // dashboard, in the same order family-tier-spec.md §3.1-3.2 lays
            // out: enroll, then consent, then enforcement starts.
            using var enrollment = new EnrollmentForm();
            if (enrollment.ShowDialog() != DialogResult.OK || enrollment.EnrolledConfig is null) return;
            config = enrollment.EnrolledConfig;
        }

        var policyClient = new PolicyClient(config.BackendUrl, config.DeviceId, config.LocalDataDir);
        var eventQueue = new EventQueue(config.BackendUrl, config.DeviceId, config.LocalDataDir);

        // family-tier-spec.md §3.2 step 2-3: consent is mandatory and logged
        // before any enforcement or data collection starts.
        if (policyClient.GetCachedPolicy() is null)
        {
            using var consent = new ConsentForm(config.BackendUrl, config.DeviceId);
            if (consent.ShowDialog() != DialogResult.OK) return;
        }

        var enforcer = new LockoutEnforcer(policyClient, eventQueue);

        // X1: mandatory, non-hideable agent indicator — a tray icon with no
        // "exit" option a child can casually click away.
        using var trayIcon = new NotifyIcon
        {
            Icon = SystemIcons.Shield,
            Visible = true,
            Text = "3rdEye — active",
        };
        var menu = new ContextMenuStrip();
        menu.Items.Add("What my parent can see", null, (_, _) =>
            MessageBox.Show(
                "Screen time, location, app installs, web category.\nNever: messages, mic, camera.",
                "3rdEye"));
        trayIcon.ContextMenuStrip = menu;

        enforcer.Locked += reason => trayIcon.ShowBalloonTip(5000, "3rdEye", reason, ToolTipIcon.Info);

        // STORY-06: F2 content filtering — local DNS-based filtering, per
        // implementation-plan.md §1.6's decision. Apply the DoH-disabling
        // mitigation once at startup (enrollment-time is the more natural
        // point, but doing it here too covers a device enrolled before this
        // story existed), then start the filter itself.
        RegistryPolicy.DisableDnsOverHttps();
        using var dnsFilter = new DnsFilter(policyClient, eventQueue);
        dnsFilter.Blocked += domain => trayIcon.ShowBalloonTip(5000, "3rdEye", $"Blocked: {domain}", ToolTipIcon.Info);
        dnsFilter.Start();

        _ = policyClient.SyncAndGetPolicyAsync(); // pull latest policy on startup; cache serves enforcement either way

        // STORY-01: policy pull first, then flush the event queue — same
        // order offline-sync-spec.md §4 step 1 specifies (pull before push).
        var syncTimer = new System.Windows.Forms.Timer { Interval = 5 * 60 * 1000 }; // re-sync every 5 min when online
        syncTimer.Tick += async (_, _) =>
        {
            await policyClient.SyncAndGetPolicyAsync();
            await eventQueue.FlushAsync();
        };
        syncTimer.Start();

        var enforceTimer = new System.Windows.Forms.Timer { Interval = 60 * 1000 };
        enforceTimer.Tick += (_, _) => enforcer.Tick();
        enforceTimer.Start();

        Application.Run();
    }
}
