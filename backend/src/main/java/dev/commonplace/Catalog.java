package dev.commonplace;

import com.fasterxml.jackson.databind.*;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;

@Service
public class Catalog {
    static final long LIMIT=10_000_000_000L;
    final Database db; final ObjectMapper json;
    public Catalog(Database db,ObjectMapper json){this.db=db;this.json=json.copy().enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);}
    String text(Map<String,Object> b,String key){Object v=b.get(key);if(!(v instanceof String s))throw ApiError.bad(key+" must be text.");return s;}
    String optional(Map<String,Object>b,String key){return b.get(key)==null?"":text(b,key);}
    long integer(Map<String,Object>b,String key){Object v=b.get(key);if(!(v instanceof Number n)||n.doubleValue()!=n.longValue())throw ApiError.bad(key+" must be an integer.");return n.longValue();}
    String name(String s){if(s.isBlank()||s.length()>200||s.equals(".")||s.equals("..")||s.chars().anyMatch(c->c<32||c=='/'||c=='\\'||c==127))throw ApiError.bad("Use a name of 1–200 characters without slashes or controls.");return s;}
    String role(String actor,String ns){var m=db.rows("SELECT role FROM members WHERE ns=? AND user_id=?",ns,actor);if(m.isEmpty())throw new ApiError(403,"FORBIDDEN","This namespace is not shared with you.");return (String)m.getFirst().get("role");}
    void write(String actor,String ns){if(role(actor,ns).equals("reader"))throw new ApiError(403,"READ_ONLY","A reader cannot change this namespace.");}
    void owner(String actor,String ns){if(!role(actor,ns).equals("owner"))throw new ApiError(403,"OWNER_REQUIRED","Only the namespace owner can change sharing or purge data.");}
    Map<String,Object> entry(String id){return db.one("SELECT * FROM entries WHERE id=?",id);}
    void parent(String ns,String p){if(p.isEmpty())return;var e=entry(p);if(!e.get("ns").equals(ns)||!(boolean)e.get("folder")||(boolean)e.get("deleted"))throw ApiError.bad("Choose an active folder in this namespace.");}
    void unique(String ns,String p,String name,String except){if(db.number("SELECT COUNT(*) FROM entries WHERE ns=? AND parent_id=? AND name=? AND deleted=FALSE AND id<>?",ns,p,name,except)>0)throw new ApiError(409,"NAME_EXISTS","An item already has this name in that folder.");}
    void version(Map<String,Object>e,long v){if(((Number)e.get("version")).longValue()!=v)throw new ApiError(409,"STALE_VERSION","This item changed. Refresh before changing metadata.");}
    Map<String,Object> retry(String actor,String key,Object body,Supplier<Map<String,Object>> action){
        if(key==null||key.isBlank()||key.length()>160)throw ApiError.bad("Provide an Idempotency-Key of 1–160 characters.");
        try {
            String hash=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(body)));
            var old=db.rows("SELECT fingerprint,result_json FROM operations WHERE actor=? AND op_key=?",actor,key);
            if(!old.isEmpty()){
                if(!old.getFirst().get("fingerprint").equals(hash))throw new ApiError(409,"KEY_REUSED","Use a new idempotency key for a different request.");
                return json.readValue(db.jdbc.queryForObject("SELECT result_json FROM operations WHERE actor=? AND op_key=?",String.class,actor,key),new com.fasterxml.jackson.core.type.TypeReference<>(){});
            }
            var result=action.get(); db.update("INSERT INTO operations VALUES (?,?,?,?)",actor,key,hash,json.writeValueAsString(result));return result;
        }catch(ApiError e){throw e;}catch(Exception e){throw new IllegalStateException(e);}
    }
    Map<String,Object> namespaces(String actor){return Map.of("namespaces",db.rows("SELECT n.*,m.role FROM namespaces n JOIN members m ON m.ns=n.id WHERE m.user_id=? ORDER BY n.name",actor),"user",actor);}
    Map<String,Object> createNamespace(String actor,String key,Map<String,Object>b){
        return retry(actor,key,List.of("namespace",b),()->{String id=Database.id();db.update("INSERT INTO namespaces VALUES (?,?,?,?)",id,name(text(b,"name")),actor,LIMIT);db.update("INSERT INTO members VALUES (?,?,?)",id,actor,"owner");return db.one("SELECT * FROM namespaces WHERE id=?",id);});
    }
    Map<String,Object> snapshot(String actor,String ns){String r=role(actor,ns);return Map.of("namespace",db.one("SELECT * FROM namespaces WHERE id=?",ns),"role",r,"entries",db.rows("SELECT * FROM entries WHERE ns=? ORDER BY folder DESC,name",ns));}
    Map<String,Object> folder(String actor,String ns,String key,Map<String,Object>b){write(actor,ns);return retry(actor,key,List.of("folder",ns,b),()->{
        String p=optional(b,"parentId"),n=name(text(b,"name")),id=Database.id();parent(ns,p);unique(ns,p,n,"");
        db.update("INSERT INTO entries(id,ns,parent_id,name,folder,version,updated_at) VALUES(?,?,?,?,TRUE,1,?)",id,ns,p,n,Database.now());return entry(id);
    });}
    Map<String,Object> patch(String actor,String id,String key,Map<String,Object>b){var e=entry(id);String ns=(String)e.get("ns");write(actor,ns);return retry(actor,key,List.of("patch",id,b),()->{
        version(e,integer(b,"version"));if((boolean)e.get("deleted"))throw ApiError.bad("Restore this item first.");
        String p=text(b,"parentId"),n=name(text(b,"name"));parent(ns,p);unique(ns,p,n,id);
        String cursor=p;while(!cursor.isEmpty()){if(cursor.equals(id))throw ApiError.bad("A folder cannot contain itself.");cursor=(String)entry(cursor).get("parentId");}
        db.update("UPDATE entries SET name=?,parent_id=?,version=version+1,updated_at=? WHERE id=?",n,p,Database.now(),id);return entry(id);
    });}
}
