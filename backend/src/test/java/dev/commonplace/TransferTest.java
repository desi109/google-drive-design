package dev.commonplace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class TransferTest extends FoundationTest {
    @Autowired Database db;
    static String hash(byte[] b){try{return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(b));}catch(Exception e){throw new RuntimeException(e);}}
    String ns(){return (String)call("alice",HttpMethod.POST,"/namespaces",Map.of("name","Transfers"),UUID.randomUUID().toString()).getBody().get("id");}
    Map start(String n,String name,byte[] data,String file,long version){
        Map<String,Object>b=new HashMap<>(Map.of("ns",n,"name",name,"parentId","","size",data.length,"hashes",data.length==0?List.of():List.of(hash(data)),"baseVersion",version));
        if(file!=null)b.put("fileId",file);
        var result=call("alice",HttpMethod.POST,"/uploads",b,UUID.randomUUID().toString());
        assertThat(result.getStatusCode().value()).isEqualTo(200);return result.getBody();
    }
    ResponseEntity<Map> part(String id,int i,byte[] data){HttpHeaders h=new HttpHeaders();h.setBearerAuth("local-alice-key");h.setContentType(MediaType.APPLICATION_OCTET_STREAM);return http.exchange("/api/uploads/"+id+"/parts/"+i,HttpMethod.PUT,new HttpEntity<>(data,h),Map.class);}
    Map complete(Map u){return call("alice",HttpMethod.POST,"/uploads/"+u.get("id")+"/complete",Map.of(),null).getBody();}
    @Test void resumeEncryptionRevisionsConflictsAndNamespaceReuse() {
        String n=ns();byte[] data="one original secret".getBytes();Map u=start(n,"plan.txt",data,null,0);String id=(String)u.get("id");
        assertThat(call("alice",HttpMethod.POST,"/uploads/"+id+"/complete",Map.of(),null).getStatusCode().value()).isEqualTo(409);
        assertThat(part(id,0,"wrong".getBytes()).getStatusCode().value()).isEqualTo(422);
        assertThat(part(id,0,data).getStatusCode().value()).isEqualTo(200);
        assertThat(part(id,0,data).getStatusCode().value()).isEqualTo(200);
        assertThat((List)call("alice",HttpMethod.GET,"/uploads/"+id,null,null).getBody().get("parts")).hasSize(1);
        Map result=complete(u);assertThat(complete(u)).isEqualTo(result);String file=(String)result.get("fileId");
        byte[] cipher=db.jdbc.queryForObject("SELECT ciphertext FROM blocks WHERE ns=?",byte[].class,n);
        assertThat(new String(cipher)).doesNotContain("original secret");
        Map reuse=start(n,"copy.txt",data,null,0);assertThat((List)reuse.get("parts")).hasSize(1);complete(reuse);
        String other=ns();assertThat((List)start(other,"copy.txt",data,null,0).get("parts")).isEmpty();
        Map a=start(n,"plan.txt","edit A".getBytes(),file,1),b=start(n,"plan.txt","edit B".getBytes(),file,1);
        part((String)a.get("id"),0,"edit A".getBytes());part((String)b.get("id"),0,"edit B".getBytes());
        assertThat(complete(a).get("conflict")).isEqualTo(false);Map conflict=complete(b);assertThat(conflict.get("conflict")).isEqualTo(true);assertThat(conflict.get("fileId")).isNotEqualTo(file);
        assertThat((List)call("alice",HttpMethod.GET,"/entries/"+file+"/revisions",null,null).getBody().get("revisions")).hasSize(2);
        HttpHeaders h=new HttpHeaders();h.setBearerAuth("local-alice-key");
        var download=http.exchange("/api/entries/"+file+"/download",HttpMethod.GET,new HttpEntity<>(h),byte[].class);
        assertThat(download.getBody()).isEqualTo("edit A".getBytes());
        assertThat(call("eve",HttpMethod.GET,"/entries/"+file+"/revisions",null,null).getStatusCode().value()).isEqualTo(403);
    }
    @Test void exactLimitValidationAndQuotaReservation() {
        String n=ns();
        var tooBig=Map.of("ns",n,"name","huge","size",10_000_000_001L,"hashes",List.of(),"baseVersion",0);
        assertThat(call("alice",HttpMethod.POST,"/uploads",tooBig,"oversize").getStatusCode().value()).isEqualTo(413);
        db.tx(()->{db.update("UPDATE namespaces SET quota_bytes=10 WHERE id=?",n);return null;});
        start(n,"first","123456".getBytes(),null,0);
        assertThat(call("alice",HttpMethod.POST,"/uploads",Map.of("ns",n,"name","second","size",6,"hashes",List.of(hash("123456".getBytes())),"baseVersion",0),"full").getStatusCode().value()).isEqualTo(409);
    }
}
