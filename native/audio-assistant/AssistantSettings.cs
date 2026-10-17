using System.Text.Json;

internal sealed class AssistantSettings
{
  public int Strength { get; set; } = 80;
  public int Semitones { get; set; }
  public int SpeedPercent { get; set; } = 100;
  public int Volume { get; set; } = 70;
  public string OutputId { get; set; } = "";
  public string CableId { get; set; } = "";
  public bool External { get; set; } = true;
  public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

  public static AssistantSettings Load(string path)
  {
    if (!File.Exists(path)) return new();
    try
    {
      var settings = JsonSerializer.Deserialize<AssistantSettings>(File.ReadAllText(path), Json) ?? new();
      settings.Strength = Math.Clamp(settings.Strength, -100, 100);
      settings.Semitones = Math.Clamp(settings.Semitones, -12, 12);
      settings.SpeedPercent = Math.Clamp(settings.SpeedPercent, 50, 200);
      settings.Volume = Math.Clamp(settings.Volume, 0, 200);
      settings.OutputId ??= "";
      settings.CableId ??= "";
      return settings;
    }
    catch (JsonException) { return new(); }
  }

  public void Save(string path)
  {
    File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(this, Json));
    File.Move(path + ".tmp", path, true);
  }
}
