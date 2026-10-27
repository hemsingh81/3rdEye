using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ThirdEyeAgent;

// STORY-06 (development-stories.md) / implementation-plan.md §1.6's decision,
// implemented: local DNS-based filtering, not a TLS-intercepting proxy and
// not a WFP kernel driver. See that doc for the full reasoning and the
// disclosed DNS-over-HTTPS bypass gap this is paired with (RegistryPolicy.cs).
//
// Requires the network adapter's DNS pointed at 127.0.0.1 — that's an
// install-time `netsh` step, not something this class does to the system
// itself (same "configuration happens at enrollment" pattern already used
// for the DoH-disabling registry policy).
public class DnsFilter : IDisposable
{
    private readonly PolicyClient _policyClient;
    private readonly EventQueue _eventQueue;
    private readonly IPEndPoint _upstream = new(IPAddress.Parse("1.1.1.1"), 53);
    private UdpClient? _listener;
    private bool _running;

    // Shortcut: a small embedded category->domain sample, not a real,
    // licensed domain-categorization feed — this proves the mechanism
    // (query intercepted, matched, refused) without claiming production
    // coverage. Upgrade when a real categorization data source is sourced;
    // named here so it isn't mistaken for a finished, shippable blocklist.
    private static readonly Dictionary<string, string[]> CategoryDomains = new()
    {
        ["adult"] = new[] { "adult-example.test" },
        ["violence"] = new[] { "violence-example.test" },
        ["gambling"] = new[] { "gambling-example.test" },
    };

    public event Action<string>? Blocked;

    public DnsFilter(PolicyClient policyClient, EventQueue eventQueue)
    {
        _policyClient = policyClient;
        _eventQueue = eventQueue;
    }

    public void Start(int port = 53)
    {
        _listener = new UdpClient(new IPEndPoint(IPAddress.Loopback, port));
        _running = true;
        _ = ListenLoopAsync();
    }

    private async Task ListenLoopAsync()
    {
        while (_running)
        {
            UdpReceiveResult result;
            try
            {
                result = await _listener!.ReceiveAsync();
            }
            catch (ObjectDisposedException)
            {
                return; // Stop()/Dispose() called — exit cleanly, not a crash.
            }

            _ = HandleQueryAsync(result);
        }
    }

    private async Task HandleQueryAsync(UdpReceiveResult result)
    {
        var query = result.Buffer;
        var domain = TryParseQuestionName(query);

        if (domain is not null && IsBlocked(domain))
        {
            var response = BuildNxDomainResponse(query);
            await _listener!.SendAsync(response, response.Length, result.RemoteEndPoint);
            // F2's block event — same alert_events table and EventQueue
            // STORY-01 already built; no second queue invented here.
            _eventQueue.EnqueueAlert("content_filter_block", $"Blocked DNS resolution for {domain}");
            Blocked?.Invoke(domain);
            return;
        }

        // Not blocked — forward the raw query to upstream and relay the raw
        // response back untouched. No need to parse the response at all for
        // a filter that only ever decides at the query stage.
        try
        {
            using var upstreamClient = new UdpClient();
            upstreamClient.Client.ReceiveTimeout = 3000;
            await upstreamClient.SendAsync(query, query.Length, _upstream);
            var upstreamResult = await upstreamClient.ReceiveAsync();
            await _listener!.SendAsync(upstreamResult.Buffer, upstreamResult.Buffer.Length, result.RemoteEndPoint);
        }
        catch (SocketException)
        {
            // Upstream unreachable (offline) — the query simply times out on
            // the requester's side, same as it would with no filter running.
        }
    }

    private bool IsBlocked(string domain)
    {
        var policy = _policyClient.GetCachedPolicy();
        if (policy is null) return false;
        foreach (var category in policy.ContentFilterCategories)
        {
            if (CategoryDomains.TryGetValue(category, out var domains) &&
                domains.Any(d => domain.Equals(d, StringComparison.OrdinalIgnoreCase)))
            {
                return true;
            }
        }
        return false;
    }

    // Minimal DNS wire-format parsing: just enough to read the QNAME out of
    // a standard query (fixed 12-byte header, then length-prefixed labels
    // terminated by a zero byte). Returns null on anything malformed rather
    // than throwing — a filter that crashes on a weird packet is worse than
    // one that just forwards it unfiltered.
    private static string? TryParseQuestionName(byte[] packet)
    {
        try
        {
            var offset = 12;
            var labels = new List<string>();
            while (packet[offset] != 0)
            {
                var len = packet[offset];
                offset++;
                labels.Add(Encoding.ASCII.GetString(packet, offset, len));
                offset += len;
            }
            return string.Join(".", labels);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static byte[] BuildNxDomainResponse(byte[] query)
    {
        var response = new byte[query.Length];
        Array.Copy(query, response, query.Length);
        response[2] = (byte)(query[2] | 0x80); // QR bit: this is a response
        response[3] = (byte)((query[3] & 0xF0) | 0x03); // RCODE = NXDOMAIN
        return response;
    }

    public void Dispose()
    {
        _running = false;
        _listener?.Dispose();
    }
}
