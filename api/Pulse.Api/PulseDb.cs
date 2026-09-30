using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Pulse.Api;

public enum IssueStatus { Open, Resolved }

/// <summary>One row per distinct bug. Every occurrence with the same fingerprint lands here.</summary>
public class Issue
{
    public int Id { get; set; }
    public required string Fingerprint { get; set; }
    public required string Title { get; set; }
    public required string Type { get; set; }
    public DateTime FirstSeen { get; set; }
    public DateTime LastSeen { get; set; }
    public int Count { get; set; }
    public IssueStatus Status { get; set; }
    public bool IsRegression { get; set; }
}

/// <summary>One occurrence of an issue. Only the latest 100 per issue are kept.</summary>
public class ErrorEvent
{
    public long Id { get; set; }
    public int IssueId { get; set; }
    public DateTime Timestamp { get; set; }
    public required string Message { get; set; }
    public string? Stack { get; set; }
    public string? Url { get; set; }
    public string? UserAgent { get; set; }
    public string? Release { get; set; }
    public string? SessionId { get; set; }
    public string? Context { get; set; } // raw JSON
    public int RepeatCount { get; set; } = 1; // > 1 when the SDK folded duplicates into one event
}

/// <summary>
/// Per-minute counts per issue, updated on ingest. The spike chart and sparklines read from here
/// because Events is capped per issue, so counting its rows would undercount exactly the spikes we want to see.
/// </summary>
public class IssueMinute
{
    public int IssueId { get; set; }
    public DateTime Minute { get; set; }
    public int Count { get; set; }
}

public class PulseDb(DbContextOptions<PulseDb> options) : DbContext(options)
{
    public DbSet<Issue> Issues => Set<Issue>();
    public DbSet<ErrorEvent> Events => Set<ErrorEvent>();
    public DbSet<IssueMinute> IssueMinutes => Set<IssueMinute>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Issue>(e =>
        {
            e.HasIndex(i => i.Fingerprint).IsUnique();
            e.HasIndex(i => i.LastSeen);
            e.Property(i => i.Status).HasConversion<string>();
        });

        model.Entity<ErrorEvent>(e =>
        {
            e.HasIndex(x => new { x.IssueId, x.Id });
            e.HasOne<Issue>().WithMany().HasForeignKey(x => x.IssueId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<IssueMinute>(e =>
        {
            e.HasKey(x => new { x.IssueId, x.Minute });
            e.HasIndex(x => x.Minute);
            e.HasOne<Issue>().WithMany().HasForeignKey(x => x.IssueId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    // SQLite stores dates as text and EF reads them back with an unspecified kind. Everything here is UTC,
    // so say so: the JSON then ends in "Z" and browsers don't shift the time into their local zone.
    protected override void ConfigureConventions(ModelConfigurationBuilder conventions) =>
        conventions.Properties<DateTime>().HaveConversion<UtcConverter>();

    private sealed class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
}
