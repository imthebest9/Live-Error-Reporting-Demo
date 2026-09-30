using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Pulse.Api;

/// <summary>What the SDK sends. Everything is optional: the ingest endpoint must never throw on a sloppy client.</summary>
public record IncomingEvent(
    string? Type,
    string? Message,
    string? Stack,
    string? Url,
    string? Release,
    string? SessionId,
    DateTimeOffset? Timestamp,
    JsonElement? Context,
    int? Count);

public record MinuteCount(DateTime Minute, int Count);

public record IssueDto(
    int Id,
    string Title,
    string Type,
    DateTime FirstSeen,
    DateTime LastSeen,
    int Count,
    IssueStatus Status,
    bool IsRegression,
    IReadOnlyList<MinuteCount> Trend);

public record EventDto(
    long Id,
    int IssueId,
    string Type,
    string Message,
    string? Stack,
    string? Url,
    string? UserAgent,
    string? Release,
    string? SessionId,
    DateTime Timestamp,
    JsonElement? Context,
    int RepeatCount);

public record StatusChange(IssueStatus Status);

public static class IssueQueries
{
    public const int TrendMinutes = 30;

    public static DateTime FloorToMinute(DateTime t) =>
        new(t.Ticks - t.Ticks % TimeSpan.TicksPerMinute, DateTimeKind.Utc);

    public static DateTime TrendStart() => FloorToMinute(DateTime.UtcNow).AddMinutes(-(TrendMinutes - 1));

    /// <summary>Loads issues plus their per-minute counts for the last 30 minutes (for sparklines).</summary>
    public static async Task<List<IssueDto>> ToDtosAsync(PulseDb db, IQueryable<Issue> query, CancellationToken ct)
    {
        var issues = await query.AsNoTracking().ToListAsync(ct);
        var ids = issues.Select(i => i.Id).ToArray();
        var since = TrendStart();

        var trends = (await db.IssueMinutes.AsNoTracking()
                .Where(m => ids.Contains(m.IssueId) && m.Minute >= since)
                .ToListAsync(ct))
            .ToLookup(m => m.IssueId);

        return issues.Select(i => new IssueDto(
                i.Id, i.Title, i.Type, i.FirstSeen, i.LastSeen, i.Count, i.Status, i.IsRegression,
                trends[i.Id].OrderBy(m => m.Minute).Select(m => new MinuteCount(m.Minute, m.Count)).ToList()))
            .ToList();
    }

    public static EventDto ToDto(this ErrorEvent e, string type) => new(
        e.Id, e.IssueId, type, e.Message, e.Stack, e.Url, e.UserAgent, e.Release, e.SessionId, e.Timestamp,
        e.Context is null ? null : JsonSerializer.Deserialize<JsonElement>(e.Context),
        e.RepeatCount);
}
