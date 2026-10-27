using System.Text.Json;

namespace ThirdEyeAgent;

// family-tier-spec.md §3.1-3.2: the parent generated an enrollment code from
// the dashboard (POST /api/devices); this screen is where a device actually
// redeems it. Shown before ConsentForm — enroll, then consent, in that order.
public class EnrollmentForm : Form
{
    private readonly TextBox _backendUrlBox;
    private readonly TextBox _codeBox;
    private readonly Label _errorLabel;

    public LocalConfig? EnrolledConfig { get; private set; }

    public EnrollmentForm()
    {
        Text = "3rdEye — Enroll this device";
        Width = 440;
        Height = 300;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var intro = new Label
        {
            Text = "Enter the backend address and the enrollment code your parent generated from the dashboard.",
            Left = 20,
            Top = 20,
            Width = 380,
            Height = 40,
        };

        var backendLabel = new Label { Text = "Backend URL", Left = 20, Top = 70, Width = 380 };
        _backendUrlBox = new TextBox { Left = 20, Top = 92, Width = 380, Text = "http://localhost:8097" };

        var codeLabel = new Label { Text = "Enrollment code", Left = 20, Top = 128, Width = 380 };
        _codeBox = new TextBox { Left = 20, Top = 150, Width = 380 };

        _errorLabel = new Label
        {
            Left = 20,
            Top = 182,
            Width = 380,
            Height = 36,
            ForeColor = Color.Firebrick,
            Text = "",
        };

        var enrollButton = new Button
        {
            Text = "Enroll",
            Left = 20,
            Top = 222,
            Width = 380,
            Height = 36,
        };
        enrollButton.Click += async (_, _) => await EnrollAsync();

        Controls.Add(intro);
        Controls.Add(backendLabel);
        Controls.Add(_backendUrlBox);
        Controls.Add(codeLabel);
        Controls.Add(_codeBox);
        Controls.Add(_errorLabel);
        Controls.Add(enrollButton);
    }

    private async Task EnrollAsync()
    {
        var backendUrl = _backendUrlBox.Text.Trim();
        var code = _codeBox.Text.Trim();
        if (backendUrl.Length == 0 || code.Length == 0)
        {
            _errorLabel.Text = "Enter both the backend URL and the enrollment code.";
            return;
        }

        try
        {
            using var http = new HttpClient { BaseAddress = new Uri(backendUrl) };
            var response = await http.GetAsync($"/api/devices/by-code/{Uri.EscapeDataString(code)}");
            if (!response.IsSuccessStatusCode)
            {
                _errorLabel.Text = "That code wasn't recognized. Check it and try again.";
                return;
            }

            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var deviceId = body.RootElement.GetProperty("device").GetProperty("id").GetString()!;

            var config = new LocalConfig
            {
                DeviceId = deviceId,
                BackendUrl = backendUrl,
                LocalDataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "3rdEye", "data"),
            };
            config.Save();
            // Not echoed back anywhere after this — a one-time-use credential,
            // not something to leave visible once it's redeemed.
            EnrolledConfig = config;
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (HttpRequestException)
        {
            _errorLabel.Text = "Couldn't reach that backend address. Check it and try again.";
        }
    }
}
