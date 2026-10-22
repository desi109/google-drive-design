package dev.commonplace;

import com.fasterxml.jackson.core.type.TypeReference;
import java.io.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class Transfers {
    public static final int BLOCK_SIZE=4*1024*1024;
    private static final long TTL=24*60*60*1000L;
    final Database db; final Catalog catalog; final BlockCipher crypto;
    Transfers(Database db,Catalog catalog,BlockCipher crypto){this.db=db;this.catalog=catalog;this.crypto=crypto;}
    long used(String ns){return db.number("SELECT COALESCE(SUM(r.size_bytes),0) FROM revisions r JOIN entries e ON e.id=r.file_id WHERE e.ns=?",ns);}
    long reserved(String ns){return db.number("SELECT COALESCE(SUM(size_bytes),0) FROM uploads WHERE ns=? AND state='OPEN' AND expires_at>?",ns,Database.now());}
    Map<String,Object> begin(String actor,String key,Map<String,Object>b){
        String ns=catalog.text(b,"ns");catalog.write(actor,ns);
        return catalog.retry(actor,key,List.of("upload",b),()->{
            long size=catalog.integer(b,"size");if(size<0)throw ApiError.bad("size cannot be negative.");
            if(size>Catalog.LIMIT)throw new ApiError(413,"FILE_TOO_LARGE","Maximum file size is 10,000,000,000 bytes.");
            String name=catalog.name(catalog.text(b,"name")),parent=catalog.optional(b,"parentId"),file=catalog.optional(b,"fileId");catalog.parent(ns,parent);
            long base=catalog.integer(b,"baseVersion");
            if(!file.isEmpty()){var e=catalog.entry(file);if(!e.get("ns").equals(ns)||(boolean)e.get("folder"))throw ApiError.bad("Choose a file in this namespace.");if((boolean)e.get("deleted"))throw new ApiError(409,"TRASHED","Restore the file before beginning an upload.");if(base<1)throw ApiError.bad("Provide the observed version.");}
            else {if(base!=0)throw ApiError.bad("A new file has baseVersion 0.");catalog.unique(ns,parent,name,"");}
            if(!(b.get("hashes") instanceof List<?> hashes)||hashes.size()!=(size+BLOCK_SIZE-1)/BLOCK_SIZE)throw ApiError.bad("Manifest length must match the file size and 4 MiB block size.");
            for(Object h:hashes)if(!(h instanceof String s)||!s.matches("[a-f0-9]{64}"))throw ApiError.bad("Manifest hashes must be lowercase SHA-256 values.");
            long quota=((Number)db.one("SELECT quota_bytes FROM namespaces WHERE id=?",ns).get("quotaBytes")).longValue();
            if(used(ns)+reserved(ns)+size>quota)throw new ApiError(409,"QUOTA_EXCEEDED","Retained revisions and active uploads consume this namespace's quota.");
            String id=Database.id();db.update("INSERT INTO uploads(id,ns,actor,file_id,parent_id,name,base_version,size_bytes,state,expires_at) VALUES(?,?,?,?,?,?,?,?,'OPEN',?)",id,ns,actor,file,parent,name,base,size,Database.now()+TTL);
            for(int i=0;i<hashes.size();i++){
                String hash=(String)hashes.get(i);db.update("INSERT INTO upload_manifest VALUES(?,?,?)",id,i,hash);
                long expected=Math.min(BLOCK_SIZE,size-(long)i*BLOCK_SIZE);
                if(db.number("SELECT COUNT(*) FROM blocks WHERE ns=? AND hash=? AND size_bytes=?",ns,hash,expected)>0)db.update("INSERT INTO upload_parts VALUES(?,?,?,?)",id,i,ns,hash);
            }
            return status(actor,id);
        });
    }
    Map<String,Object> upload(String actor,String id){var u=db.one("SELECT id,ns,actor,file_id,parent_id,name,base_version,size_bytes,state,expires_at FROM uploads WHERE id=?",id);if(!u.get("actor").equals(actor))throw new ApiError(403,"FORBIDDEN","Upload sessions belong to their initiating user.");catalog.write(actor,(String)u.get("ns"));return u;}
    void open(Map<String,Object>u){if(!u.get("state").equals("OPEN")||((Number)u.get("expiresAt")).longValue()<=Database.now())throw new ApiError(410,"UPLOAD_CLOSED","This upload is closed or expired; start a new session.");}
    Map<String,Object> status(String actor,String id){var u=upload(actor,id);var result=new LinkedHashMap<>(u);result.put("blockSize",BLOCK_SIZE);result.put("parts",db.rows("SELECT part_index FROM upload_parts WHERE upload_id=? ORDER BY part_index",id).stream().map(p->p.get("partIndex")).toList());return result;}
    Map<String,Object> part(String actor,String id,int index,byte[] bytes){var u=upload(actor,id);open(u);
        var m=db.rows("SELECT hash FROM upload_manifest WHERE upload_id=? AND part_index=?",id,index);if(m.isEmpty())throw ApiError.bad("Part index is outside the manifest.");
        long expected=Math.min(BLOCK_SIZE,((Number)u.get("sizeBytes")).longValue()-(long)index*BLOCK_SIZE);String hash=(String)m.getFirst().get("hash"),ns=(String)u.get("ns");
        if(bytes.length!=expected||!BlockCipher.hash(bytes).equals(hash))throw new ApiError(422,"BLOCK_MISMATCH","Part size or SHA-256 does not match the manifest.");
        if(db.number("SELECT COUNT(*) FROM blocks WHERE ns=? AND hash=?",ns,hash)==0)db.update("INSERT INTO blocks VALUES(?,?,?,?,?)",ns,hash,bytes.length,crypto.encrypt(ns,hash,bytes),Database.now());
        if(db.number("SELECT COUNT(*) FROM upload_parts WHERE upload_id=? AND part_index=?",id,index)==0)db.update("INSERT INTO upload_parts VALUES(?,?,?,?)",id,index,ns,hash);
        return Map.of("accepted",true,"partIndex",index);
    }
    Map<String,Object> complete(String actor,String id){var u=upload(actor,id);
        if(u.get("state").equals("COMPLETE")){try{return catalog.json.readValue(db.jdbc.queryForObject("SELECT result_json FROM uploads WHERE id=?",String.class,id),new TypeReference<>(){});}catch(Exception e){throw new IllegalStateException(e);}}
        open(u);if(db.number("SELECT COUNT(*) FROM upload_manifest WHERE upload_id=?",id)!=db.number("SELECT COUNT(*) FROM upload_parts WHERE upload_id=?",id))throw new ApiError(409,"MISSING_PARTS","Upload all missing parts before completing.");
        String ns=(String)u.get("ns"),file=(String)u.get("fileId"),parent=(String)u.get("parentId"),name=(String)u.get("name");boolean conflict=false;
        if(!file.isEmpty()){
            var e=catalog.entry(file);conflict=(boolean)e.get("deleted")||((Number)e.get("version")).longValue()!=((Number)u.get("baseVersion")).longValue();
            if(conflict){file="";parent="";} // Recover stale data at the root even if its former parent was trashed.
        }
        if(file.isEmpty()){
            if(!parent.isEmpty()){var p=catalog.entry(parent);if((boolean)p.get("deleted")){parent="";conflict=true;}}
            if(db.number("SELECT COUNT(*) FROM entries WHERE ns=? AND parent_id=? AND name=? AND deleted=FALSE",ns,parent,name)>0)conflict=true;
            if(conflict)name=name.substring(0,Math.min(name.length(),145))+" (conflict "+id+")";
            catalog.parent(ns,parent);catalog.unique(ns,parent,name,"");file=Database.id();db.update("INSERT INTO entries(id,ns,parent_id,name,folder,version,updated_at) VALUES(?,?,?,?,FALSE,0,?)",file,ns,parent,name,Database.now());
        }
        String revision=Database.id();db.update("INSERT INTO revisions VALUES(?,?,?,?,?)",revision,file,u.get("sizeBytes"),actor,Database.now());
        db.update("INSERT INTO revision_blocks SELECT ?,part_index,ns,hash FROM upload_parts WHERE upload_id=?",revision,id);
        db.update("UPDATE entries SET head=?,version=version+1,updated_at=? WHERE id=?",revision,Database.now(),file);
        Map<String,Object> result=Map.of("fileId",file,"revisionId",revision,"conflict",conflict);
        try{db.update("UPDATE uploads SET state='COMPLETE',result_json=? WHERE id=?",catalog.json.writeValueAsString(result),id);}catch(Exception e){throw new IllegalStateException(e);}
        return result;
    }
    Map<String,Object> cancel(String actor,String id){var u=upload(actor,id);if(u.get("state").equals("OPEN"))db.update("UPDATE uploads SET state='CANCELLED' WHERE id=?",id);return Map.of("cancelled",true);}
    Map<String,Object> revisions(String actor,String file){var e=catalog.entry(file);catalog.role(actor,(String)e.get("ns"));return Map.of("revisions",db.rows("SELECT * FROM revisions WHERE file_id=? ORDER BY created_at DESC,id",file));}
    Map<String,Object> downloadInfo(String actor,String file,String revision){var e=catalog.entry(file);catalog.role(actor,(String)e.get("ns"));String rev=revision==null?(String)e.get("head"):revision;var r=db.one("SELECT * FROM revisions WHERE id=? AND file_id=?",rev,file);var info=new LinkedHashMap<>(r);info.put("name",e.get("name"));info.put("ns",e.get("ns"));return info;}
    void stream(Map<String,Object>info,OutputStream output) throws IOException {
        for(var b:db.rows("SELECT hash FROM revision_blocks WHERE revision_id=? ORDER BY part_index",info.get("id"))){String ns=(String)info.get("ns"),hash=(String)b.get("hash");byte[] encrypted=db.jdbc.queryForObject("SELECT ciphertext FROM blocks WHERE ns=? AND hash=?",byte[].class,ns,hash);output.write(crypto.decrypt(ns,hash,encrypted));}
    }
}
