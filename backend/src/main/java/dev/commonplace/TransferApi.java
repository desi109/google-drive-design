package dev.commonplace;

import jakarta.servlet.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.http.ContentDisposition;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class TransferApi {
    final Database db;final Transfers transfers;
    TransferApi(Database db,Transfers transfers){this.db=db;this.transfers=transfers;}
    String actor(HttpServletRequest r){return (String)r.getAttribute("actor");}
    @PostMapping("/uploads") Object begin(HttpServletRequest r,@RequestHeader("Idempotency-Key") String k,@RequestBody Map<String,Object>b){return db.tx(()->transfers.begin(actor(r),k,b));}
    @GetMapping("/uploads/{id}") Object status(HttpServletRequest r,@PathVariable String id){return db.tx(()->transfers.status(actor(r),id));}
    @DeleteMapping("/uploads/{id}") Object cancel(HttpServletRequest r,@PathVariable String id){return db.tx(()->transfers.cancel(actor(r),id));}
    @PutMapping("/uploads/{id}/parts/{index}") Object part(HttpServletRequest r,@PathVariable String id,@PathVariable int index) throws IOException {
        byte[] bytes=r.getInputStream().readNBytes(Transfers.BLOCK_SIZE+1);if(bytes.length>Transfers.BLOCK_SIZE)throw new ApiError(413,"BLOCK_TOO_LARGE","A block cannot exceed 4 MiB.");return db.tx(()->transfers.part(actor(r),id,index,bytes));
    }
    @PostMapping("/uploads/{id}/complete") Object complete(HttpServletRequest r,@PathVariable String id){return db.tx(()->transfers.complete(actor(r),id));}
    @GetMapping("/entries/{id}/revisions") Object revisions(HttpServletRequest r,@PathVariable String id){return db.tx(()->transfers.revisions(actor(r),id));}
    @GetMapping("/entries/{id}/download") void download(HttpServletRequest r,HttpServletResponse response,@PathVariable String id,@RequestParam(required=false) String revision) {
        db.tx(()->{var info=transfers.downloadInfo(actor(r),id,revision);response.setContentType("application/octet-stream");response.setContentLengthLong(((Number)info.get("sizeBytes")).longValue());response.setHeader("Content-Disposition",ContentDisposition.attachment().filename((String)info.get("name"),StandardCharsets.UTF_8).build().toString());try{transfers.stream(info,response.getOutputStream());}catch(IOException e){throw new UncheckedIOException(e);}return null;});
    }
}
