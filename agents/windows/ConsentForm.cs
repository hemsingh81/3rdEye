using System.Text;
using System.Text.Json;

namespace ThirdEyeAgent;

// family-tier-spec.md §3.2: mandatory, cannot be skipped, shown before any
// data collection starts. Plain-language categories, nothing suppressed.
public class ConsentForm : Form
{
    private readonly HttpClient _http;
    private readonly string _deviceId;

    public ConsentForm(string backendUrl, string deviceId)
    {
        _http = new HttpClient { BaseAddress = new Uri(backendUrl) };
        _deviceId = deviceId;

        Text = "3rdEye — What your parent can see";
        Width = 480;
        Height = 420;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var label = new Label
        {
            Text =
                "Before this device is set up, here's exactly what your parent will see:\n\n" +
                "✓ Screen time and when the device locks\n" +
                "✓ Location and arrival/departure alerts\n" +
                "✓ App install requests and installed apps\n" +
                "✓ Web category (not full browsing history)\n\n" +
                "Never collected: message content, microphone, camera, full browsing history.\n\n" +
                "This 3rdEye icon stays visible in your taskbar — it can't be hidden.",
            Left = 20,
            Top = 20,
            Width = 440,
            Height = 280,
        };

        var acceptButton = new Button
        {
            Text = "I understand",
            Left = 20,
            Top = 310,
            Width = 440,
            Height = 36,
        };
        acceptButton.Click += async (_, _) => await AcceptAsync();

        Controls.Add(label);
        Controls.Add(acceptButton);
    }

    private async Task AcceptAsync()
    {
        var body = JsonSerializer.Serialize(new { accepted_by = Environment.UserName });
        var response = await _http.PostAsync(
            $"/api/devices/{_deviceId}/consent",
            new StringContent(body, Encoding.UTF8, "application/json"));

        if (response.IsSuccessStatusCode)
        {
            DialogResult = DialogResult.OK;
            Close();
        }
        else
        {
            MessageBox.Show(
                "Couldn't reach the 3rdEye server to record consent. Check your connection and try again.",
                "3rdEye", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
