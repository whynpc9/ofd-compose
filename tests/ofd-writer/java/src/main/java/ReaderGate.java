import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import org.ofdrw.reader.OFDReader;
import org.ofdrw.reader.ContentExtractor;
import org.ofdrw.core.basicStructure.pageObj.layer.block.TextObject;

/** Test-only: uses Java OFDReader and ContentExtractor, not writer XML routines. */
public final class ReaderGate {
    static double maxError;
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static double n(JsonObject value, String key) { return value.get(key).getAsDouble(); }
    static void near(double actual, double expected) {
        double error = Math.abs(actual - expected); maxError = Math.max(maxError, error);
        check(error < 1e-8, "geometry mismatch " + actual + " != " + expected);
    }
    static double[] matrix(JsonObject state) {
        JsonObject m = state.getAsJsonObject("transform");
        return new double[]{n(m,"a"),n(m,"b"),n(m,"c"),n(m,"d"),n(m,"e")/1000,n(m,"f")/1000};
    }
    public static void main(String[] args) throws Exception {
        var report = new JsonArray();
        for (String name : List.of("combined", "cff", "truetype", "glyphless")) {
            JsonObject ir = JsonParser.parseString(Files.readString(Path.of(args[0],name,"ir.json"))).getAsJsonObject();
            Map<String,JsonObject> states = new HashMap<>();
            ir.getAsJsonArray("graphicsStates").forEach(e -> states.put(e.getAsJsonObject().get("id").getAsString(),e.getAsJsonObject()));
            int objects = 0, glyphCount = 0; maxError = 0;
            try (var reader = new OFDReader(Path.of(args[1],name+".ofd"))) {
                var extractor = new ContentExtractor(reader);
                check(reader.getNumberOfPages() == ir.getAsJsonArray("pages").size(), "page count");
                int p = 1;
                for (var pageElement : ir.getAsJsonArray("pages")) {
                    var page = pageElement.getAsJsonObject();
                    List<JsonObject> expected = new ArrayList<>();
                    for (var element : page.getAsJsonArray("objects")) if (element.getAsJsonObject().get("kind").getAsString().equals("text")) expected.add(element.getAsJsonObject());
                    List<TextObject> texts = extractor.getPageTextObject(p);
                    check(texts.size() == expected.size(), "text object count " + name);
                    String wanted = expected.stream().map(o -> o.get("logicalText").getAsString()).reduce("",String::concat);
                    String actual = extractor.getPageContent(p).stream().map(s -> Objects.requireNonNullElse(s, "")).reduce("",String::concat);
                    check(actual.equals(wanted), "logical text mismatch " + name + " page " + p);
                    for (int i=0;i<texts.size();i++) {
                        var text=texts.get(i); var obj=expected.get(i); objects++;
                        var codes=text.getTextCodes(); check(codes.size()==1,"one positioned run");
                        var code=codes.getFirst(); var glyphs=obj.getAsJsonArray("glyphs");
                        var m=text.getCTM().toDouble(); var sm=matrix(states.get(obj.get("stateId").getAsString()));
                        for(int k=0;k<6;k++) near(m[k],sm[k]);
                        var dx=code.getDeltaX()==null?new Double[0]:code.getDeltaX().toDouble();
                        var dy=code.getDeltaY()==null?new Double[0]:code.getDeltaY().toDouble();
                        double x=code.getX(),y=code.getY();
                        if(glyphs.size()>0) {
                            var maps=text.getCGTransforms(); check(maps.size()==1,"CG map");
                            check(maps.getFirst().getCodeCount()==obj.get("logicalText").getAsString().length(),"UTF16 code count");
                            check(maps.getFirst().getGlyphCount()==glyphs.size(),"glyph count");
                            var gids=maps.getFirst().getGlyphs().toDouble();
                            for(int g=0;g<glyphs.size();g++) {
                                var glyph=glyphs.get(g).getAsJsonObject();
                                check(gids[g]==n(glyph,"glyphId"),"retained glyph id");
                                if(g>0){x+=dx[g-1];y+=dy[g-1];}
                                double ex=(n(glyph.getAsJsonObject("position"),"x")+n(glyph.getAsJsonObject("offset"),"x"))/1000;
                                double ey=(n(glyph.getAsJsonObject("position"),"y")+n(glyph.getAsJsonObject("offset"),"y"))/1000;
                                near(x,ex);near(y,ey);
                                near(m[0]*x+m[2]*y+m[4]+text.getBoundary().getTopLeftX(),sm[0]*ex+sm[2]*ey+sm[4]);
                                near(m[1]*x+m[3]*y+m[5]+text.getBoundary().getTopLeftY(),sm[1]*ex+sm[3]*ey+sm[5]);
                                glyphCount++;
                            }
                        } else check(!text.getFill() && !text.getStroke(),"glyphless text must not paint");
                    }
                    p++;
                }
            }
            var row=new JsonObject(); row.addProperty("fixture",name);row.addProperty("textObjects",objects);row.addProperty("glyphs",glyphCount);row.addProperty("maxGeometryErrorMm",maxError);report.add(row);
        }
        System.out.println(new GsonBuilder().setPrettyPrinting().create().toJson(report));
    }
}
