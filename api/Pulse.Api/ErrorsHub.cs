using Microsoft.AspNetCore.SignalR;

namespace Pulse.Api;

/// <summary>
/// Server-to-client only: dashboards connect to /hubs/errors and listen. Nothing is called on the hub;
/// the ingest and resolve endpoints push through IHubContext&lt;ErrorsHub&gt;.
/// </summary>
public class ErrorsHub : Hub;

public static class HubEvents
{
    public const string EventReceived = "eventReceived";
    public const string IssueCreated = "issueCreated";
    public const string IssueUpdated = "issueUpdated";
}
