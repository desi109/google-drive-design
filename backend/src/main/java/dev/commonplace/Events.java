package dev.commonplace;

import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class Events {
    final Database db;
    Events(Database db){this.db=db;}
    void append(String ns,String actor,String kind,String file){db.update("INSERT INTO changes(ns,actor,kind,file_id,created_at) VALUES(?,?,?,?,?)",ns,actor,kind,file,Database.now());}
    long cursor(String ns){return db.number("SELECT COALESCE(MAX(seq),0) FROM changes WHERE ns=?",ns);}
    Map<String,Object> changes(String ns,long after){
        if(after<0)throw ApiError.bad("after must be nonnegative.");
        if(after>cursor(ns))throw new ApiError(409,"CURSOR_AHEAD","Fetch a new snapshot after restoring a server backup.");
        var rows=db.rows("SELECT * FROM changes WHERE ns=? AND seq>? ORDER BY seq FETCH FIRST 101 ROWS ONLY",ns,after);
        boolean more=rows.size()>100;var page=rows.subList(0,Math.min(100,rows.size()));
        long next=page.isEmpty()?after:((Number)page.getLast().get("seq")).longValue();
        return Map.of("changes",page,"nextCursor",next,"hasMore",more);
    }
}
