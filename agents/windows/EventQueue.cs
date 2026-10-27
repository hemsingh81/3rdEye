using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ThirdEyeAgent;

// STORY-01 (development-stories.md): local durable queue, flushed to the
// backend's POST /api/devices/:id/events on the existing sync timer.
// Shortcut: append-only JSON Lines file, not SQLite — offline-sync-spec.md
// §3 describes a fuller embedded-DB design; this is the smallest complete
// thing for Phase 1's single-device, single-queue case. Upgrade to SQLite
// if/when multiple writers or a real query need shows up, not before.
public class EventQueue
{
    private record QueuedEvent(
        [property: JsonPropertyName("kind")] string Kind, // "usage" | "alert"
        [property: JsonPropertyName("client_event_id")] string ClientEventId,
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("message")] string? Message,
        [property: JsonPropertyName("ts")] string? Ts,
        [property: JsonPropertyName("start_ts")] string? StartTs,
        [property: JsonPropertyName("end_ts")] string? EndTs
    );

    private readonly string _queuePath;
    private readonly HttpClient _http;
    private readonly string _deviceId;

    public EventQueue(string backendUrl, string deviceId, string localDataDir)
    {
        Directory.CreateDirectory(localDataDir);
        _queuePath = Path.Combine(localDataDir, "events.jsonl");
        _http = new HttpClient { BaseAddress = new Uri(backendUrl) };
        _deviceId = deviceId;
    }

    // Called from LockoutEnforcer at the moment of a lock — the event is
    // durable on disk immediately, independent of whether a flush ever
    // succeeds (that's the whole point of queueing it at all).
    public void EnqueueAlert(string type, string message)
    {
        Append(new QueuedEvent("alert", Guid.NewGuid().ToString(), type, message, DateTime.UtcNow.ToString("o"), null, null));
    }

    public void EnqueueUsage(DateTime startTs, DateTime endTs)
    {
        Append(new QueuedEvent("usage", Guid.NewGuid().ToString(), null, null, null, startTs.ToUniversalTime().ToString("o"), endTs.ToUniversalTime().ToString("o")));
    }

    private void Append(QueuedEvent evt)
    {
        File.AppendAllText(_queuePath, JsonSerializer.Serialize(evt) + "\n");
    }

    // Flushes the whole queue in one batch. On success, clears only what was
    // actually sent — on failure (offline), leaves it untouched for the
    // next sync attempt. Each event's client_event_id is generated at
    // Enqueue time, not here, so a retried flush after a dropped connection
    // is safely idempotent on the backend (offline-sync-spec.md §4 step 3).
    //
    // Review catch: an earlier version of this method read the file, awaited
    // the HTTP POST (yielding the UI thread — LockoutEnforcer.Lock() can run
    // and append a new event during that gap), then deleted the *whole*
    // file on success — silently dropping whatever got appended mid-flush.
    // Fixed by snapshotting via an atomic rename before the await: new
    // Enqueue calls after the rename just start a fresh events.jsonl, so
    // nothing written during the network call is in the snapshot we delete.
    public async Task<bool> FlushAsync()
    {
        if (!File.Exists(_queuePath)) return true;
        var snapshotPath = _queuePath + ".flushing";
        try
        {
            File.Move(_queuePath, snapshotPath, overwrite: true);
        }
        catch (IOException)
        {
            return false; // another flush already in progress — try again next sync
        }

        var lines = await File.ReadAllLinesAsync(snapshotPath);
        var events = lines
            .Where(l => l.Trim().Length > 0)
            .Select(l => JsonSerializer.Deserialize<QueuedEvent>(l))
            .Where(e => e is not null)
            .Select(e => e!)
            .ToList();

        if (events.Count == 0)
        {
            File.Delete(snapshotPath);
            return true;
        }

        var usageEvents = events.Where(e => e.Kind == "usage").Select(e => new
        {
            client_event_id = e.ClientEventId,
            start_ts = e.StartTs,
            end_ts = e.EndTs,
        });
        var alertEvents = events.Where(e => e.Kind == "alert").Select(e => new
        {
            client_event_id = e.ClientEventId,
            type = e.Type,
            message = e.Message,
            ts = e.Ts,
        });

        try
        {
            var response = await _http.PostAsJsonAsync($"/api/devices/{_deviceId}/events", new { usage_events = usageEvents, alert_events = alertEvents });
            if (!response.IsSuccessStatusCode)
            {
                RequeueSnapshot(snapshotPath);
                return false;
            }
        }
        catch (HttpRequestException)
        {
            RequeueSnapshot(snapshotPath); // offline — put it back for the next sync attempt
            return false;
        }

        File.Delete(snapshotPath);
        return true;
    }

    // Puts a failed snapshot's events back ahead of anything enqueued during
    // the flush attempt, preserving original order.
    private void RequeueSnapshot(string snapshotPath)
    {
        var snapshotContent = File.ReadAllText(snapshotPath);
        var currentContent = File.Exists(_queuePath) ? File.ReadAllText(_queuePath) : "";
        File.WriteAllText(_queuePath, snapshotContent + currentContent);
        File.Delete(snapshotPath);
    }
}
