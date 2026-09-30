using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Pulse.Api;

/// <summary>
/// Decides which errors are "the same bug": events with the same fingerprint are grouped into one issue.
/// Fingerprint = SHA-256 of type + normalised message + top 3 stack frames.
/// </summary>
public static partial class Fingerprinter
{
    public const int FrameCount = 3;

    public static string Compute(string type, string message, string? stack)
    {
        var parts = new List<string> { type, NormalizeMessage(message) };
        parts.AddRange(TopFrames(stack, FrameCount));

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', parts)));
        return Convert.ToHexStringLower(hash);
    }

    /// <summary>
    /// "Player 4821 not found" and "Player 77 not found" are the same bug, so the parts that vary
    /// between occurrences become placeholders. URLs go first because they contain numbers.
    /// </summary>
    public static string NormalizeMessage(string message)
    {
        var s = UrlPattern().Replace(message, "<url>");
        s = GuidPattern().Replace(s, "<guid>");
        s = NumberPattern().Replace(s, "<n>");
        return Whitespace().Replace(s, " ").Trim();
    }

    /// <summary>
    /// Reads the first frames of a Chrome ("at fn (file:line:col)") or Firefox/Safari ("fn@file:line:col")
    /// stack and reduces each to "function@file". Line and column numbers are dropped on purpose:
    /// they move with every release, and a release that shifts code shouldn't split one bug into two issues.
    /// </summary>
    public static List<string> TopFrames(string? stack, int count)
    {
        var frames = new List<string>();
        if (string.IsNullOrEmpty(stack)) return frames;

        foreach (var line in stack.Split('\n'))
        {
            if (ParseFrame(line.Trim()) is not { } frame) continue; // e.g. the "TypeError: ..." header line
            frames.Add(frame);
            if (frames.Count == count) break;
        }
        return frames;
    }

    private static string? ParseFrame(string line)
    {
        var match = ChromeFrame().Match(line);
        if (!match.Success) match = FirefoxFrame().Match(line);
        if (!match.Success) return null;

        var function = match.Groups["fn"].Value is { Length: > 0 } fn ? fn : "?";
        return $"{function}@{FileName(match.Groups["file"].Value)}";
    }

    // "http://localhost:8081/game/game.js?v=3" -> "game.js": the host differs between environments.
    private static string FileName(string location)
    {
        var path = location.Split('?', '#')[0];
        return path[(path.LastIndexOf('/') + 1)..];
    }

    [GeneratedRegex(@"^at (?:(?<fn>.+?) \()?(?<file>.+?)(?::\d+){0,2}\)?$")]
    private static partial Regex ChromeFrame();

    [GeneratedRegex(@"^(?<fn>[^@]*)@(?<file>.+?):\d+:\d+$")]
    private static partial Regex FirefoxFrame();

    [GeneratedRegex(@"\b[a-z][a-z0-9+.-]*://\S+", RegexOptions.IgnoreCase)]
    private static partial Regex UrlPattern();

    [GeneratedRegex(@"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", RegexOptions.IgnoreCase)]
    private static partial Regex GuidPattern();

    [GeneratedRegex(@"\d+(?:\.\d+)?")]
    private static partial Regex NumberPattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
