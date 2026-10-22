package dev.commonplace;

import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;

@Service
public class Lifecycle {
    final Database db;final Catalog catalog;
    Lifecycle(Database db,Catalog catalog){this.db=db;this.catalog=catalog;}
    Map<String,Object> members(String actor,String ns){catalog.role(actor,ns);return Map.of("members",db.rows("SELECT user_id,role FROM members WHERE ns=? ORDER BY user_id",ns));}
    Map<String,Object> share(String actor,String ns,String key,Map<String,Object>b){catalog.owner(actor,ns);return catalog.retry(actor,key,List.of("share",ns,b),()->{
        String user=catalog.text(b,"userId"),role=catalog.text(b,"role");
        if(!Set.of("alice","bob","eve").contains(user)||!Set.of("reader","writer","none").contains(role))throw ApiError.bad("Choose a local user and reader, writer or none.");
        if(db.number("SELECT COUNT(*) FROM members WHERE ns=? AND user_id=? AND role='owner'",ns,user)>0)throw ApiError.bad("The namespace owner cannot be changed.");
        db.update("DELETE FROM members WHERE ns=? AND user_id=?",ns,user);if(!role.equals("none"))db.update("INSERT INTO members VALUES(?,?,?)",ns,user,role);
        catalog.events.append(ns,actor,role.equals("none")?"access_revoked":"sharing_changed","");return members(actor,ns);
    });}
    Map<String,Object> state(String actor,String id,String action,String key,Map<String,Object>b){var e=action.equals("purge")?db.one("SELECT * FROM entries WHERE id=?",id):catalog.entry(id);String ns=(String)e.get("ns");catalog.write(actor,ns);if(action.equals("purge"))catalog.owner(actor,ns);
        return catalog.retry(actor,key,List.of(action,id,b),()->{
            if((boolean)e.get("purged"))throw new ApiError(404,"NOT_FOUND","This item was permanently purged.");
            catalog.version(e,catalog.integer(b,"version"));
            boolean deleted=(boolean)e.get("deleted");
            if(action.equals("trash")){
                if(deleted)throw ApiError.bad("This item is already in trash.");
                if(db.number("SELECT COUNT(*) FROM entries WHERE parent_id=? AND deleted=FALSE",id)>0)throw new ApiError(409,"FOLDER_NOT_EMPTY","Move or trash the contents first.");
                db.update("UPDATE entries SET deleted=TRUE,version=version+1,updated_at=? WHERE id=?",Database.now(),id);
            }else if(action.equals("restore")){
                if(!deleted)throw ApiError.bad("This item is already active.");catalog.parent(ns,(String)e.get("parentId"));catalog.unique(ns,(String)e.get("parentId"),(String)e.get("name"),id);
                db.update("UPDATE entries SET deleted=FALSE,version=version+1,updated_at=? WHERE id=?",Database.now(),id);
            }else if(action.equals("purge")){
                if(!deleted)throw ApiError.bad("Trash this item before permanent purge.");
                if(db.number("SELECT COUNT(*) FROM entries WHERE parent_id=? AND purged=FALSE",id)>0)throw new ApiError(409,"FOLDER_NOT_EMPTY","Purge all children first, including those in trash.");
                if(db.number("SELECT COUNT(*) FROM uploads WHERE state='OPEN' AND expires_at>? AND (file_id=? OR parent_id=?)",Database.now(),id,id)>0)throw new ApiError(409,"UPLOAD_ACTIVE","Cancel active uploads before purging this item.");
                db.update("DELETE FROM revision_blocks WHERE revision_id IN (SELECT id FROM revisions WHERE file_id=?)",id);db.update("DELETE FROM revisions WHERE file_id=?",id);db.update("UPDATE entries SET head=NULL,purged=TRUE,version=version+1,updated_at=? WHERE id=?",Database.now(),id);
            }else throw ApiError.bad("Choose trash, restore or purge.");
            catalog.events.append(ns,actor,action,id);return Map.of("id",id,"action",action);
        });
    }
    void cleanup(){
        for(var u:db.rows("SELECT id FROM uploads WHERE state='OPEN' AND expires_at<=? FETCH FIRST 100 ROWS ONLY",Database.now()))db.update("UPDATE uploads SET state='EXPIRED' WHERE id=?",u.get("id"));
        for(var u:db.rows("SELECT DISTINCT p.upload_id FROM upload_parts p JOIN uploads u ON u.id=p.upload_id WHERE u.state<>'OPEN' FETCH FIRST 100 ROWS ONLY"))db.update("DELETE FROM upload_parts WHERE upload_id=?",u.get("uploadId"));
    }
    Map<String,Object> gc(String actor,String ns){catalog.owner(actor,ns);cleanup();int count=0;
        var unreachable=db.rows("SELECT b.hash FROM blocks b WHERE b.ns=? AND NOT EXISTS(SELECT 1 FROM revision_blocks r WHERE r.ns=b.ns AND r.hash=b.hash) AND NOT EXISTS(SELECT 1 FROM upload_parts p WHERE p.ns=b.ns AND p.hash=b.hash) FETCH FIRST 100 ROWS ONLY",ns);
        for(var b:unreachable){db.update("DELETE FROM blocks WHERE ns=? AND hash=?",ns,b.get("hash"));count++;}
        return Map.of("collectedBlocks",count,"batchLimit",100);
    }
    @Scheduled(fixedDelay=60000,initialDelay=60000) void expire(){db.tx(()->{cleanup();return null;});}
}
