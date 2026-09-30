using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Pulse.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<PulseDb>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Pulse") ?? "Data Source=pulse.db"));
builder.Services.AddScoped<IngestService>();

// Enums travel as "open" / "resolved" rather than 0 / 1, over both HTTP and SignalR.
var enumsAsStrings = new JsonStringEnumConverter(JsonNamingPolicy.CamelCase);
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(enumsAsStrings));
builder.Services.AddSignalR().AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(enumsAsStrings));

// The game lives on its own origin, like a customer's site would. No cookies are involved, so any origin may post.
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

// Per-session token bucket: 5 requests of burst, refilled at one every 2 s — exactly the SDK's flush rate,
// so a well-behaved client never notices it, while a runaway one gets 429s instead of flooding the database.
// The session id comes from the query string because the limiter runs before the body is read.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("per-session", http => RateLimitPartition.GetTokenBucketLimiter(
        http.Request.Query["sessionId"].FirstOrDefault() ?? http.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
        _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = 5,
            TokensPerPeriod = 1,
            ReplenishmentPeriod = TimeSpan.FromSeconds(2),
            QueueLimit = 0,
        }));
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PulseDb>();
    db.Database.EnsureCreated(); // a demo, so no migrations
    db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;"); // readers don't block the ingest writer
}

app.UseCors();
app.UseRateLimiter();

// Batch ingest. The SDK posts text/plain (navigator.sendBeacon can't send application/json cross-origin
// without a preflight), so the body is parsed by hand instead of relying on [FromBody] content-type checks.
app.MapPost("/api/events", async (HttpRequest request, IngestService ingest, CancellationToken ct) =>
    {
        List<IncomingEvent>? batch;
        try
        {
            batch = await JsonSerializer.DeserializeAsync<List<IncomingEvent>>(request.Body, JsonSerializerOptions.Web, ct);
        }
        catch (JsonException)
        {
            return Results.BadRequest(new { error = "Body must be a JSON array of events." });
        }

        if (batch is null || batch.Count == 0)
            return Results.BadRequest(new { error = "Send at least one event." });
        if (batch.Count > IngestService.MaxBatchSize)
            return Results.BadRequest(new { error = $"At most {IngestService.MaxBatchSize} events per request." });

        await ingest.IngestAsync(batch, request.Headers.UserAgent.ToString(), ct);
        return Results.Accepted(value: new { accepted = batch.Count });
    })
    .RequireRateLimiting("per-session")
    .WithMetadata(new RequestSizeLimitAttribute(256 * 1024));

// Latest events across all issues, so a freshly opened dashboard starts with a filled live feed.
app.MapGet("/api/events", async (int? limit, PulseDb db, CancellationToken ct) =>
{
    var rows = await db.Events.AsNoTracking()
        .OrderByDescending(e => e.Id)
        .Take(Math.Clamp(limit ?? 50, 1, 200))
        .Join(db.Issues, e => e.IssueId, i => i.Id, (e, i) => new { Event = e, i.Type })
        .ToListAsync(ct);
    return rows.OrderByDescending(r => r.Event.Id).Select(r => r.Event.ToDto(r.Type));
});

app.MapGet("/api/issues", async (string? status, PulseDb db, CancellationToken ct) =>
{
    var query = db.Issues.AsQueryable();
    if (status is not null && status != "all")
    {
        if (!Enum.TryParse<IssueStatus>(status, ignoreCase: true, out var wanted))
            return Results.BadRequest(new { error = "status must be open, resolved or all." });
        query = query.Where(i => i.Status == wanted);
    }
    return Results.Ok(await IssueQueries.ToDtosAsync(db, query.OrderByDescending(i => i.LastSeen).Take(200), ct));
});

app.MapGet("/api/issues/{id:int}/events", async (int id, int? limit, PulseDb db, CancellationToken ct) =>
{
    var issue = await db.Issues.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, ct);
    if (issue is null) return Results.NotFound();

    var events = await db.Events.AsNoTracking()
        .Where(e => e.IssueId == id)
        .OrderByDescending(e => e.Id)
        .Take(Math.Clamp(limit ?? 20, 1, IngestService.MaxEventsPerIssue))
        .ToListAsync(ct);
    return Results.Ok(events.Select(e => e.ToDto(issue.Type)));
});

// Resolve (or reopen) an issue. Resolving clears the regression flag; the next event reopens it as a regression.
app.MapPatch("/api/issues/{id:int}", async (int id, StatusChange change, PulseDb db, IHubContext<ErrorsHub> hub, CancellationToken ct) =>
{
    var issue = await db.Issues.FindAsync([id], ct);
    if (issue is null) return Results.NotFound();

    issue.Status = change.Status;
    if (change.Status == IssueStatus.Resolved) issue.IsRegression = false;
    await db.SaveChangesAsync(ct); // only Status and IsRegression are written, so a concurrent Count increment isn't lost

    var dto = (await IssueQueries.ToDtosAsync(db, db.Issues.Where(i => i.Id == id), ct))[0];
    await hub.Clients.All.SendAsync(HubEvents.IssueUpdated, dto, CancellationToken.None);
    return Results.Ok(dto);
});

app.MapGet("/api/stats/per-minute", async (PulseDb db, CancellationToken ct) =>
{
    var since = IssueQueries.TrendStart();
    return await db.IssueMinutes
        .Where(m => m.Minute >= since)
        .GroupBy(m => m.Minute)
        .OrderBy(g => g.Key)
        .Select(g => new MinuteCount(g.Key, g.Sum(m => m.Count)))
        .ToListAsync(ct);
});

app.MapHub<ErrorsHub>("/hubs/errors");

app.Run();
