using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Pulse.Api;

/// <summary>Turns a batch from the SDK into grouped issues, stored events and live pushes.</summary>
public sealed class IngestService(PulseDb db, IHubContext<ErrorsHub> hub)
{
    public const int MaxBatchSize = 50;
    public const int MaxEventsPerIssue = 100;

    public async Task IngestAsync(IReadOnlyList<IncomingEvent> batch, string? userAgent, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var minute = IssueQueries.FloorToMinute(now);
        var touched = new HashSet<int>();
        var created = new HashSet<int>();
        var saved = new List<(ErrorEvent Row, string Type)>();

        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            foreach (var e in batch)
            {
                var type = Clip(e.Type, 100) ?? "Error";
                var message = Clip(e.Message, 1000) ?? "";
                var stack = Clip(e.Stack, 8000);
                var count = Math.Clamp(e.Count ?? 1, 1, 10_000);
                var title = Clip(Fingerprinter.NormalizeMessage(message), 200) ?? "(no message)";

                var issue = await UpsertIssueAsync(Fingerprinter.Compute(type, message, stack), title, type, count, now, ct);
                touched.Add(issue.Id);
                if (issue.Count == count) created.Add(issue.Id); // an existing issue would already have been >= 1

                await db.Database.ExecuteSqlAsync($"""
                    INSERT INTO IssueMinutes (IssueId, Minute, Count) VALUES ({issue.Id}, {minute}, {count})
                    ON CONFLICT (IssueId, Minute) DO UPDATE SET Count = Count + excluded.Count
                    """, ct);

                var row = new ErrorEvent
                {
                    IssueId = issue.Id,
                    Timestamp = e.Timestamp?.UtcDateTime ?? now,
                    Message = message,
                    Stack = stack,
                    Url = Clip(e.Url, 500),
                    UserAgent = Clip(userAgent, 300),
                    Release = Clip(e.Release, 50),
                    SessionId = Clip(e.SessionId, 64),
                    Context = ContextJson(e.Context),
                    RepeatCount = count,
                };
                db.Events.Add(row);
                saved.Add((row, type));
            }

            await db.SaveChangesAsync(ct);

            foreach (var issueId in touched)
            {
                await db.Events
                    .Where(x => x.IssueId == issueId)
                    .OrderByDescending(x => x.Id)
                    .Skip(MaxEventsPerIssue)
                    .ExecuteDeleteAsync(ct);
            }

            await tx.CommitAsync(ct);
        }

        // Push only after commit, so a dashboard never shows something that could still roll back.
        // Not cancellable: once the data is saved, dashboards should hear about it even if the sender hung up.
        var ids = touched.ToArray();
        var issues = await IssueQueries.ToDtosAsync(db, db.Issues.Where(i => ids.Contains(i.Id)), CancellationToken.None);
        foreach (var issue in issues)
        {
            var name = created.Contains(issue.Id) ? HubEvents.IssueCreated : HubEvents.IssueUpdated;
            await hub.Clients.All.SendAsync(name, issue);
        }
        foreach (var (row, type) in saved)
        {
            await hub.Clients.All.SendAsync(HubEvents.EventReceived, row.ToDto(type));
        }
    }

    /// <summary>
    /// Insert-or-increment in one SQL statement, so the database does the counting: two requests for
    /// the same bug can't both read Count = 5 and both write 6. A new event on a resolved issue reopens it
    /// and flags it as a regression. (SET expressions see the row's old values, so Status there is the old status.)
    /// </summary>
    private async Task<UpsertResult> UpsertIssueAsync(
        string fingerprint, string title, string type, int count, DateTime now, CancellationToken ct)
    {
        var rows = await db.Database.SqlQuery<UpsertResult>($"""
            INSERT INTO Issues (Fingerprint, Title, Type, FirstSeen, LastSeen, Count, Status, IsRegression)
            VALUES ({fingerprint}, {title}, {type}, {now}, {now}, {count}, 'Open', 0)
            ON CONFLICT (Fingerprint) DO UPDATE SET
                Count = Count + excluded.Count,
                LastSeen = max(LastSeen, excluded.LastSeen),
                IsRegression = IsRegression OR Status = 'Resolved',
                Status = 'Open'
            RETURNING Id, Count
            """).ToListAsync(ct);
        return rows[0];
    }

    private sealed record UpsertResult(int Id, int Count);

    private static string? ContextJson(JsonElement? context)
    {
        if (context is not { ValueKind: JsonValueKind.Object } obj) return null;
        var json = obj.GetRawText();
        return json.Length <= 4000 ? json : """{"truncated":true}""";
    }

    private static string? Clip(string? s, int max) =>
        string.IsNullOrEmpty(s) ? null : s.Length <= max ? s : s[..max];
}
