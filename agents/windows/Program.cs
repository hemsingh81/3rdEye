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
            // No local config at all means this copy was never enrolled —
            // out of scope for this slice (enrollment-code entry UI comes
            // with it); for now, assume Phase 0's enroll API already ran
            // and a config.json was dropped alongside the install.
            MessageBox.Show(
                "3rdEye isn't enrolled on this device yet. Run enrollment first.",
                "3rdEye", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var policyClient = new PolicyClient(config.BackendUrl, config.DeviceId, config.LocalDataDir);

        // family-tier-spec.md §3.2 step 2-3: consent is mandatory and logged
        // before any enforcement or data collection starts.
        if (policyClient.GetCachedPolicy() is null)
        {
            using var consent = new ConsentForm(config.BackendUrl, config.DeviceId);
            if (consent.ShowDialog() != DialogResult.OK) return;
        }

        var enforcer = new LockoutEnforcer(policyClient);

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

        _ = policyClient.SyncAndGetPolicyAsync(); // pull latest policy on startup; cache serves enforcement either way

        var syncTimer = new System.Windows.Forms.Timer { Interval = 5 * 60 * 1000 }; // re-sync every 5 min when online
        syncTimer.Tick += async (_, _) => await policyClient.SyncAndGetPolicyAsync();
        syncTimer.Start();

        var enforceTimer = new System.Windows.Forms.Timer { Interval = 60 * 1000 };
        enforceTimer.Tick += (_, _) => enforcer.Tick();
        enforceTimer.Start();

        Application.Run();
    }
}
