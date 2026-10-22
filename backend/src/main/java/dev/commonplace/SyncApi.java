package dev.commonplace;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class SyncApi {
    final Database db;final Catalog catalog;final Lifecycle life;
    SyncApi(Database db,Catalog catalog,Lifecycle life){this.db=db;this.catalog=catalog;this.life=life;}
    String actor(HttpServletRequest r){return (String)r.getAttribute("actor");}
    @GetMapping("/namespaces/{ns}/changes") Object changes(HttpServletRequest r,@PathVariable String ns,@RequestParam(defaultValue="0") long after){return db.tx(()->{catalog.role(actor(r),ns);return catalog.events.changes(ns,after);});}
    @GetMapping("/namespaces/{ns}/notifications") Object notifications(HttpServletRequest r,@PathVariable String ns,@RequestParam(defaultValue="0") long after){return db.tx(()->{catalog.role(actor(r),ns);if(after<0)throw ApiError.bad("after must be nonnegative.");long cursor=catalog.events.cursor(ns);return Map.of("changed",cursor!=after,"cursor",cursor);});}
    @GetMapping("/namespaces/{ns}/members") Object members(HttpServletRequest r,@PathVariable String ns){return db.tx(()->life.members(actor(r),ns));}
    @PutMapping("/namespaces/{ns}/members") Object share(HttpServletRequest r,@PathVariable String ns,@RequestHeader("Idempotency-Key") String k,@RequestBody Map<String,Object>b){return db.tx(()->life.share(actor(r),ns,k,b));}
    @PostMapping("/entries/{id}/{action:trash|restore|purge}") Object state(HttpServletRequest r,@PathVariable String id,@PathVariable String action,@RequestHeader("Idempotency-Key") String k,@RequestBody Map<String,Object>b){return db.tx(()->life.state(actor(r),id,action,k,b));}
    @PostMapping("/namespaces/{ns}/gc") Object gc(HttpServletRequest r,@PathVariable String ns){return db.tx(()->life.gc(actor(r),ns));}
}
