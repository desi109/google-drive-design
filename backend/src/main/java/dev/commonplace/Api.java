package dev.commonplace;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class Api {
    final Database db; final Catalog catalog;
    Api(Database db,Catalog catalog){this.db=db;this.catalog=catalog;}
    String actor(HttpServletRequest req){return (String)req.getAttribute("actor");}
    @GetMapping("/health") Map<String,Object> health(){return Map.of("status","up");}
    @GetMapping("/namespaces") Object namespaces(HttpServletRequest r){return db.tx(()->catalog.namespaces(actor(r)));}
    @PostMapping("/namespaces") Object namespace(HttpServletRequest r,@RequestHeader("Idempotency-Key") String k,@RequestBody Map<String,Object>b){return db.tx(()->catalog.createNamespace(actor(r),k,b));}
    @GetMapping("/namespaces/{ns}/snapshot") Object snapshot(HttpServletRequest r,@PathVariable String ns){return db.tx(()->catalog.snapshot(actor(r),ns));}
    @PostMapping("/namespaces/{ns}/folders") Object folder(HttpServletRequest r,@PathVariable String ns,@RequestHeader("Idempotency-Key") String k,@RequestBody Map<String,Object>b){return db.tx(()->catalog.folder(actor(r),ns,k,b));}
    @PatchMapping("/entries/{id}") Object patch(HttpServletRequest r,@PathVariable String id,@RequestHeader("Idempotency-Key") String k,@RequestBody Map<String,Object>b){return db.tx(()->catalog.patch(actor(r),id,k,b));}
}
