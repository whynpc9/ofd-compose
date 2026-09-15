import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import org.ofdrw.reader.OFDReader;
import org.ofdrw.reader.ContentExtractor;
import org.ofdrw.core.basicStructure.pageObj.layer.block.TextObject;
import org.ofdrw.core.basicStructure.pageObj.layer.block.PathObject;
import org.ofdrw.core.basicStructure.pageObj.layer.block.ImageObject;

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
        for (String name : List.of("combined", "cff", "truetype", "glyphless", "geometry", "jpeg", "logical-display", "glyphless-logical")) {
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
                    var blocks=reader.getPage(p).getContent().getLayers().getFirst().getPageBlocks();
                    check(blocks.size()==page.getAsJsonArray("objects").size(),"all primitive count/order");
                    for(int b=0;b<blocks.size();b++) {
                        var original=page.getAsJsonArray("objects").get(b).getAsJsonObject();
                        var state=states.get(original.get("stateId").getAsString());
                        double[] expectedMatrix=matrix(state);
                        if(blocks.get(b) instanceof PathObject path) {
                            check(original.get("kind").getAsString().equals("path"),"path order");
                            if(original.get("coordinateSpace").getAsString().equals("page"))expectedMatrix=new double[]{1,0,0,1,0,0};
                            var actualMatrix=path.getCTM().toDouble();for(int k=0;k<6;k++)near(actualMatrix[k],expectedMatrix[k]);
                            check(path.getFill()==original.get("fill").getAsBoolean(),"path fill");
                            check(path.getStroke()==original.get("stroke").getAsBoolean(),"path stroke");
                            if(state.has("clip")) {
                                check(path.getClips().getClips().size()==1,"path clip count");
                                var clipMatrix=path.getClips().getClips().getFirst().getAreas().getFirst().getCTM().toDouble();
                                var wantedClip=matrix(state);for(int k=0;k<6;k++)near(clipMatrix[k],wantedClip[k]);
                            }
                            near(path.getLineWidth(),n(state,"lineWidth")/1000);
                            check(path.getAbbreviatedData()!=null && !path.getAbbreviatedData().isBlank(),"path geometry");
                        } else if(blocks.get(b) instanceof ImageObject image) {
                            check(original.get("kind").getAsString().equals("image"),"image order");
                            JsonObject resource=null;
                            for(var r:ir.getAsJsonArray("resources"))if(r.getAsJsonObject().get("id").getAsString().equals(original.get("resourceId").getAsString()))resource=r.getAsJsonObject();
                            var pixel=matrix(original);double w=n(resource,"pixelWidth"),h=n(resource,"pixelHeight");
                            double[] m=expectedMatrix;
                            expectedMatrix=new double[]{(m[0]*pixel[0]+m[2]*pixel[1])*w,(m[1]*pixel[0]+m[3]*pixel[1])*w,(m[0]*pixel[2]+m[2]*pixel[3])*h,(m[1]*pixel[2]+m[3]*pixel[3])*h,m[0]*pixel[4]+m[2]*pixel[5]+m[4],m[1]*pixel[4]+m[3]*pixel[5]+m[5]};
                            var actualMatrix=image.getCTM().toDouble();for(int k=0;k<6;k++)near(actualMatrix[k],expectedMatrix[k]);
                            if(original.has("clip")) {
                                var clips=image.getClips().getClips();check(clips.size()==(state.has("clip")?2:1),"image clip intersection count");
                                var clipMatrix=clips.getLast().getAreas().getFirst().getCTM().toDouble();
                                double[] wantedClip=expectedMatrix.clone();wantedClip[0]/=w;wantedClip[1]/=w;wantedClip[2]/=h;wantedClip[3]/=h;
                                for(int k=0;k<6;k++)near(clipMatrix[k],wantedClip[k]);
                            }
                        }
                    }
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
                            var maps=text.getCGTransforms(); check(!maps.isEmpty(),"CG map");
                            check(maps.stream().mapToInt(c -> c.getCodeCount()).sum()==obj.get("logicalText").getAsString().length(),"UTF16 code count");
                            check(maps.stream().mapToInt(c -> c.getGlyphCount()).sum()==glyphs.size(),"glyph count");
                            var gids=maps.stream().flatMap(c -> Arrays.stream(c.getGlyphs().toDouble())).toArray(Double[]::new);
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
