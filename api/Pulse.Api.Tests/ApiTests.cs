using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Api;

namespace Pulse.Api.Tests;

/// <summary>End-to-end tests against the real app, each with its own throwaway SQLite file.</summary>
public class ApiTests : IAsyncLifetime
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"pulse-test-{Guid.NewGuid():N}.db");
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b.UseSetting("ConnectionStrings:Pulse", $"Data Source={_dbPath};Pooling=false"));
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        foreach (var file in new[] { _dbPath, _dbPath + "-wal", _dbPath + "-shm" }) File.Delete(file);
    }

    private static object Event(string message, string type = "TypeError", int? count = null) => new
    {
        type,
        message,
        stack = "at applyDamage (http://localhost:8081/game/game.js:42:13)\n    at tick (http://localhost:8081/game/game.js:88:5)",
        url = "/game",
        release = "1.0.3",
        sessionId = "s1",
        timestamp = "2026-09-30T14:02:11Z",
        context = new { level = 3, fps = 57 },
        count,
    };

    private Task<HttpResponseMessage> Post(IEnumerable<object> events, string session = "test", string contentType = "application/json") =>
        _client.PostAsync($"/api/events?sessionId={session}",
            new StringContent(JsonSerializer.Serialize(events, Json), Encoding.UTF8, contentType));

    private async Task<List<IssueDto>> Issues(string query = "") =>
        (await _client.GetFromJsonAsync<List<IssueDto>>($"/api/issues{query}", Json))!;

    [Fact]
    public async Task Same_bug_with_different_numbers_becomes_one_issue_with_a_count()
    {
        for (var i = 0; i < 3; i++)
        {
            var response = await Post([Event($"Player {1000 + i} not found")], session: $"s{i}");
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        }

        var issue = Assert.Single(await Issues());
        Assert.Equal("Player <n> not found", issue.Title);
        Assert.Equal(3, issue.Count);
        Assert.Equal(IssueStatus.Open, issue.Status);
        Assert.Equal(3, Assert.Single(issue.Trend).Count);
    }

    [Fact]
    public async Task Repeat_count_from_sdk_dedupe_adds_to_the_issue_count()
    {
        await Post([Event("boom", count: 199)]);

        var issue = Assert.Single(await Issues());
        Assert.Equal(199, issue.Count);
        var perMinute = await _client.GetFromJsonAsync<List<MinuteCount>>("/api/stats/per-minute", Json);
        Assert.Equal(199, Assert.Single(perMinute!).Count);
    }

    [Fact]
    public async Task Text_plain_bodies_from_sendBeacon_are_accepted()
    {
        var response = await Post([Event("beacon")], contentType: "text/plain");
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Single(await Issues());
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("{\"message\":\"not an array\"}")]
    public async Task Bad_bodies_are_rejected(string body)
    {
        var response = await _client.PostAsync("/api/events", new StringContent(body));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Batches_over_fifty_events_are_rejected()
    {
        var response = await Post(Enumerable.Range(0, 51).Select(i => Event($"e{i}")));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Only_the_latest_hundred_events_are_kept_per_issue()
    {
        for (var batch = 0; batch < 3; batch++)
            await Post(Enumerable.Range(0, 40).Select(i => Event($"Enemy {batch * 40 + i} exploded")), session: $"b{batch}");

        var issue = Assert.Single(await Issues());
        Assert.Equal(120, issue.Count); // the count keeps everything...

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PulseDb>();
        var stored = db.Events.Where(e => e.IssueId == issue.Id).OrderBy(e => e.Id).ToList();
        Assert.Equal(IngestService.MaxEventsPerIssue, stored.Count); // ...but only the newest 100 rows remain
        Assert.Equal("Enemy 20 exploded", stored[0].Message);

        var latest = await _client.GetFromJsonAsync<List<EventDto>>($"/api/issues/{issue.Id}/events?limit=5", Json);
        Assert.Equal(5, latest!.Count);
        Assert.Equal("Enemy 119 exploded", latest[0].Message);
        Assert.Equal(57, latest[0].Context!.Value.GetProperty("fps").GetInt32());
    }

    [Fact]
    public async Task Recent_events_across_issues_come_newest_first_with_their_type()
    {
        await Post([Event("first", type: "TypeError")]);
        await Post([Event("second", type: "RangeError")], session: "other");

        var recent = await _client.GetFromJsonAsync<List<EventDto>>("/api/events?limit=10", Json);
        Assert.Equal(["second", "first"], recent!.Select(e => e.Message));
        Assert.Equal(["RangeError", "TypeError"], recent.Select(e => e.Type));
    }

    [Fact]
    public async Task A_new_event_on_a_resolved_issue_reopens_it_as_a_regression()
    {
        await Post([Event("boom")]);
        var id = Assert.Single(await Issues()).Id;

        var resolved = await _client.PatchAsJsonAsync($"/api/issues/{id}", new StatusChange(IssueStatus.Resolved), Json);
        resolved.EnsureSuccessStatusCode();
        Assert.Empty(await Issues("?status=open"));
        Assert.Single(await Issues("?status=resolved"));

        await Post([Event("boom")], session: "later");

        var reopened = Assert.Single(await Issues("?status=open"));
        Assert.True(reopened.IsRegression);
        Assert.Equal(2, reopened.Count);
    }

    [Fact]
    public async Task Resolving_a_missing_issue_is_404()
    {
        var response = await _client.PatchAsJsonAsync("/api/issues/999", new StatusChange(IssueStatus.Resolved), Json);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task One_session_sending_too_fast_gets_429()
    {
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 7; i++)
            statuses.Add((await Post([Event("storm")], session: "runaway")).StatusCode);

        Assert.Equal(HttpStatusCode.Accepted, statuses[0]);
        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);

        // Another session is unaffected.
        Assert.Equal(HttpStatusCode.Accepted, (await Post([Event("calm")], session: "polite")).StatusCode);
    }

    [Fact]
    public async Task Dashboards_get_pushed_new_issues_and_events_over_signalr()
    {
        var server = _factory.Server;
        await using var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, "/hubs/errors"), o =>
            {
                o.HttpMessageHandlerFactory = _ => server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)))
            .Build();

        var created = new TaskCompletionSource<IssueDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        var updated = new TaskCompletionSource<IssueDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        var received = new TaskCompletionSource<EventDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        hub.On<IssueDto>(HubEvents.IssueCreated, i => created.TrySetResult(i));
        hub.On<IssueDto>(HubEvents.IssueUpdated, i => updated.TrySetResult(i));
        hub.On<EventDto>(HubEvents.EventReceived, e => received.TrySetResult(e));
        await hub.StartAsync();

        await Post([Event("Player 1 not found")]);
        var issue = await created.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var evt = await received.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal("Player <n> not found", issue.Title);
        Assert.Equal(issue.Id, evt.IssueId);
        Assert.Equal("Player 1 not found", evt.Message);

        await Post([Event("Player 2 not found")], session: "second");
        Assert.Equal(2, (await updated.Task.WaitAsync(TimeSpan.FromSeconds(5))).Count);
    }
}
