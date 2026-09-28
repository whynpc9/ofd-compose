using System.Text.Json;
using static OFDCompose.Containers.ContainerBudget;

namespace OFDCompose.Containers;

// .NET marshals bounded descriptors and compares text; numbering semantics stay in Layout Core.
internal static class SourceNumberingValidation
{
    internal static string[] Resolve(JsonElement[] paragraphs,NumberingLabelsResolver? resolver,ContainerBudget budget)
    {
        if(paragraphs.Length==0)return [];
        Need(resolver is not null,"NUMBERING_VERIFIER_REQUIRED");
        Need(paragraphs.Length<=100000,"SIZE_LIMIT");
        // Reserve the bounded writer's worst-case escaped-token/buffer expansion before visiting any descriptor.
        // Do not copy full paragraph text merely to estimate the request size.
        budget.Charge(Math.Min(16*1024*1024,budget.Limits.JsonBytes)*12L+paragraphs.Length*128L);
        using var stream=new DescriptorStream();
        using(var writer=new Utf8JsonWriter(stream))
        {
            writer.WriteStartArray();
            foreach(var paragraph in paragraphs)
            {
                budget.Charge(32);
                writer.WriteStartObject();
                writer.WriteString("nodeId",paragraph.GetProperty("nodeId").GetString());
                writer.WritePropertyName("layout");writer.WriteStartObject();writer.WritePropertyName("numbering");paragraph.GetProperty("layout").GetProperty("numbering").WriteTo(writer);writer.WriteEndObject();
                if(paragraph.TryGetProperty("instancePath",out var instances))
                {
                    writer.WritePropertyName("instancePath");writer.WriteStartArray();
                    foreach(var instance in instances.EnumerateArray())
                    {
                        budget.Charge(32);
                        writer.WriteStartObject();writer.WriteString("nodeId",instance.GetProperty("nodeId").GetString());writer.WriteString("key",instance.GetProperty("key").GetString());writer.WriteEndObject();
                    }
                    writer.WriteEndArray();
                }
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
        }
        Need(stream.Length<=16*1024*1024,"SIZE_LIMIT");budget.Charge(stream.Length*2L);
        ReadOnlyMemory<byte> output;
        try { output=resolver!(new("ofd-compose/numbering@0",stream.ToArray()),budget.Token); }
        catch(OperationCanceledException) { throw; }
        catch(Exception) { throw new ContainerFailure("NUMBERING_VERIFICATION_FAILED"); }
        budget.Charge(0);
        Need(output.Length is >0 and <=16*1024*1024,"NUMBERING_VERIFICATION_FAILED");
        using var parsed=SafePackage.Json(output,budget);
        Need(parsed.RootElement.ValueKind==JsonValueKind.Array&&parsed.RootElement.GetArrayLength()==paragraphs.Length,"NUMBERING_VERIFICATION_FAILED");
        var labels=new string[paragraphs.Length];int index=0;
        foreach(var value in parsed.RootElement.EnumerateArray())
        {
            Need(value.ValueKind==JsonValueKind.String,"NUMBERING_VERIFICATION_FAILED");
            string label=value.GetString()!;Need(label.Length is >0 and <=64,"NUMBERING_VERIFICATION_FAILED");
            budget.Charge(label.Length*4L);labels[index++]=label;
        }
        return labels;
    }
    private sealed class DescriptorStream : MemoryStream
    {
        public override void Write(byte[] bytes,int offset,int count){Need(Length+count<=16*1024*1024,"SIZE_LIMIT");base.Write(bytes,offset,count);}
        public override void Write(ReadOnlySpan<byte> bytes){Need(Length+bytes.Length<=16*1024*1024,"SIZE_LIMIT");base.Write(bytes);}
    }

}
