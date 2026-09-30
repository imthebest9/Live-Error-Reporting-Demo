using Pulse.Api;

namespace Pulse.Api.Tests;

public class FingerprinterTests
{
    private const string ChromeStack = """
        TypeError: Cannot read properties of undefined (reading 'hp')
            at applyDamage (http://localhost:8081/game/game.js:42:13)
            at tick (http://localhost:8081/game/game.js:88:5)
            at loop (http://localhost:8081/game/game.js:120:3)
            at main (http://localhost:8081/game/game.js:200:1)
        """;

    [Theory]
    [InlineData("Player 4821 not found", "Player <n> not found")]
    [InlineData("Took 12.5ms", "Took <n>ms")]
    [InlineData("Save 3f2504e0-4f89-11d3-9a0c-0305e82c3301 is corrupt", "Save <guid> is corrupt")]
    [InlineData("GET https://api.example.com/v2/players/77 failed", "GET <url> failed")]
    [InlineData("  too   much\n space ", "too much space")]
    public void NormalizeMessage_replaces_the_parts_that_vary(string message, string expected) =>
        Assert.Equal(expected, Fingerprinter.NormalizeMessage(message));

    [Fact]
    public void Same_bug_with_different_ids_gets_the_same_fingerprint() =>
        Assert.Equal(
            Fingerprinter.Compute("Error", "Player 4821 not found", ChromeStack),
            Fingerprinter.Compute("Error", "Player 77 not found", ChromeStack));

    [Fact]
    public void Different_type_gets_a_different_fingerprint() =>
        Assert.NotEqual(
            Fingerprinter.Compute("TypeError", "boom", ChromeStack),
            Fingerprinter.Compute("RangeError", "boom", ChromeStack));

    [Fact]
    public void Different_message_gets_a_different_fingerprint() =>
        Assert.NotEqual(
            Fingerprinter.Compute("Error", "Player not found", ChromeStack),
            Fingerprinter.Compute("Error", "Level not found", ChromeStack));

    [Fact]
    public void Same_message_thrown_from_a_different_place_gets_a_different_fingerprint()
    {
        var elsewhere = ChromeStack.Replace("applyDamage", "spawnEnemy");
        Assert.NotEqual(
            Fingerprinter.Compute("TypeError", "boom", ChromeStack),
            Fingerprinter.Compute("TypeError", "boom", elsewhere));
    }

    [Fact]
    public void Line_numbers_moving_in_a_new_release_do_not_split_the_issue()
    {
        var nextRelease = ChromeStack.Replace(":42:13", ":57:9").Replace(":88:5", ":101:5");
        Assert.Equal(
            Fingerprinter.Compute("TypeError", "boom", ChromeStack),
            Fingerprinter.Compute("TypeError", "boom", nextRelease));
    }

    [Fact]
    public void Only_the_top_three_frames_count()
    {
        var differentFourthFrame = ChromeStack.Replace("at main", "at bootstrap");
        Assert.Equal(
            Fingerprinter.Compute("TypeError", "boom", ChromeStack),
            Fingerprinter.Compute("TypeError", "boom", differentFourthFrame));
    }

    [Fact]
    public void TopFrames_reads_chrome_stacks_and_skips_the_header_line() =>
        Assert.Equal(
            ["applyDamage@game.js", "tick@game.js", "loop@game.js"],
            Fingerprinter.TopFrames(ChromeStack, 3));

    [Fact]
    public void TopFrames_reads_firefox_and_safari_stacks()
    {
        const string firefox = """
            applyDamage@http://localhost:8081/game/game.js:42:13
            @http://localhost:8081/game/game.js?v=2:88:5
            """;
        Assert.Equal(["applyDamage@game.js", "?@game.js"], Fingerprinter.TopFrames(firefox, 3));
    }

    [Fact]
    public void TopFrames_handles_anonymous_chrome_frames_and_missing_stacks()
    {
        Assert.Equal(["?@game.js"], Fingerprinter.TopFrames("Error: x\n    at http://h/game/game.js:3:9", 3));
        Assert.Empty(Fingerprinter.TopFrames(null, 3));
        Assert.Empty(Fingerprinter.TopFrames("", 3));
    }

    [Fact]
    public void Fingerprint_is_a_sha256_hex_string() =>
        Assert.Matches("^[0-9a-f]{64}$", Fingerprinter.Compute("Error", "boom", null));
}
