package dev.commonplace;

import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.assertj.core.api.Assertions.*;

/** Exercises the HTTP contracts against real transactions, ciphertext and bounded block transport. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
    "spring.datasource.url=jdbc:h2:mem:hardening", "drive.seed=false"})
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class HardeningTest {
    static final ParameterizedTypeReference<Map<String,Object>> RESPONSE=new ParameterizedTypeReference<>() {};
    @TempDir static Path directory;
    @DynamicPropertySource static void data(DynamicPropertyRegistry properties) {
        properties.add("drive.data",()->directory.toString());
    }
    @Autowired TestRestTemplate http;
    @Autowired Database db;
    @Autowired Catalog catalog;
    @BeforeEach void requests() {
        http.getRestTemplate().setRequestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory());
    }
    String key(){return UUID.randomUUID().toString();}
    ResponseEntity<Map<String,Object>> call(String actor,HttpMethod method,String path,Object body,String key) {
        HttpHeaders headers=new HttpHeaders();headers.setBearerAuth("local-"+actor+"-key");
        if(key!=null)headers.set("Idempotency-Key",key);
        return http.exchange("/api"+path,method,new HttpEntity<>(body,headers),RESPONSE);
    }
    Map<String,Object> ok(ResponseEntity<Map<String,Object>> response) {
        assertThat(response.getStatusCode().value()).isEqualTo(200);return response.getBody();
    }
    String namespace(){return (String)ok(call("alice",HttpMethod.POST,"/namespaces",Map.of("name","Hardening"),key())).get("id");}
    Map<String,Object> manifest(String ns,String name,long size,List<String> hashes,String file,long base) {
        var body=new HashMap<String,Object>(Map.of("ns",ns,"name",name,"parentId","","size",size,"hashes",hashes,"baseVersion",base));
        if(file!=null)body.put("fileId",file);return body;
    }
    Map<String,Object> begin(String actor,Map<String,Object> body){return ok(call(actor,HttpMethod.POST,"/uploads",body,key()));}
    Map<String,Object> begin(String ns,String name,byte[] bytes,String file,long base) {
        return begin("alice",manifest(ns,name,bytes.length,List.of(BlockCipher.hash(bytes)),file,base));
    }
    ResponseEntity<Map<String,Object>> part(String actor,String upload,int index,byte[] bytes) {
        HttpHeaders headers=new HttpHeaders();headers.setBearerAuth("local-"+actor+"-key");headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        return http.exchange("/api/uploads/"+upload+"/parts/"+index,HttpMethod.PUT,new HttpEntity<>(bytes,headers),RESPONSE);
    }
    Map<String,Object> complete(String actor,Map<String,Object> upload) {
        return ok(call(actor,HttpMethod.POST,"/uploads/"+upload.get("id")+"/complete",Map.of(),null));
    }
    Map<String,Object> createFile(String ns,String name,byte[] bytes) {
        var upload=begin(ns,name,bytes,null,0);ok(part("alice",(String)upload.get("id"),0,bytes));return complete("alice",upload);
    }
    String folder(String ns,String name,String parent) {
        return (String)ok(call("alice",HttpMethod.POST,"/namespaces/"+ns+"/folders",Map.of("name",name,"parentId",parent),key())).get("id");
    }
    void share(String ns,String role) {
        ok(call("alice",HttpMethod.PUT,"/namespaces/"+ns+"/members",Map.of("userId","bob","role",role),key()));
    }
    String digest(byte[]... blocks) throws Exception {
        var digest=MessageDigest.getInstance("SHA-256");for(byte[] block:blocks)digest.update(block);
        return HexFormat.of().formatHex(digest.digest());
    }
    String streamedDigest(String file,String revision,long length) {
        return http.getRestTemplate().execute(URI.create(http.getRootUri()+"/api/entries/"+file+"/download"+(revision==null?"":"?revision="+revision)),HttpMethod.GET,
            request->request.getHeaders().setBearerAuth("local-alice-key"),response->{
                assertThat(response.getStatusCode().value()).isEqualTo(200);
                assertThat(response.getHeaders().getContentLength()).isEqualTo(length);
                MessageDigest digest;
                try{digest=MessageDigest.getInstance("SHA-256");}catch(Exception e){throw new IllegalStateException(e);}
                long read=0;byte[] buffer=new byte[8192];InputStream input=response.getBody();
                for(int count;(count=input.read(buffer))!=-1;){digest.update(buffer,0,count);read+=count;}
                assertThat(read).isEqualTo(length);return HexFormat.of().formatHex(digest.digest());
            });
    }

    @Test void outOfOrderBlocksStreamInManifestOrderAndOldRevisionsStayImmutable() throws Exception {
        String ns=namespace();byte[] first=new byte[4_194_304],second=new byte[4_194_304],last="the final partial block".getBytes(StandardCharsets.UTF_8);
        Arrays.fill(first,(byte)17);Arrays.fill(second,(byte)93);long length=(long)first.length+second.length+last.length;
        var upload=begin("alice",manifest(ns,"large.bin",length,List.of(BlockCipher.hash(first),BlockCipher.hash(second),BlockCipher.hash(last)),null,0));
        String id=(String)upload.get("id");
        assertThat(part("alice",id,0,new byte[4_194_305]).getStatusCode().value()).isEqualTo(413);
        ok(part("alice",id,2,last));ok(part("alice",id,0,first));
        assertThat(ok(call("alice",HttpMethod.GET,"/uploads/"+id,null,null)).get("parts")).isEqualTo(List.of(0,2));
        assertThat(call("alice",HttpMethod.POST,"/uploads/"+id+"/complete",Map.of(),null).getStatusCode().value()).isEqualTo(409);
        ok(part("alice",id,1,second));var result=complete("alice",upload);String file=(String)result.get("fileId"),revision=(String)result.get("revisionId");
        assertThat(streamedDigest(file,null,length)).isEqualTo(digest(first,second,last));
        byte[] replacement="replacement head".getBytes(StandardCharsets.UTF_8);var next=begin(ns,"large.bin",replacement,file,1);
        ok(part("alice",(String)next.get("id"),0,replacement));complete("alice",next);
        assertThat(streamedDigest(file,null,replacement.length)).isEqualTo(digest(replacement));
        assertThat(streamedDigest(file,revision,length)).isEqualTo(digest(first,second,last));
        assertThat((List<?>)ok(call("alice",HttpMethod.GET,"/entries/"+file+"/revisions",null,null)).get("revisions")).hasSize(2);
    }

    @Test void simultaneousCompletionsFromOneBasePreserveExactlyOneConflict() throws Exception {
        String ns=namespace();String file=(String)createFile(ns,"draft.txt","original".getBytes(StandardCharsets.UTF_8)).get("fileId");
        byte[] a="concurrent edit A".getBytes(StandardCharsets.UTF_8),b="concurrent edit B".getBytes(StandardCharsets.UTF_8);
        var left=begin(ns,"draft.txt",a,file,1);var right=begin(ns,"draft.txt",b,file,1);
        ok(part("alice",(String)left.get("id"),0,a));ok(part("alice",(String)right.get("id"),0,b));
        var ready=new CountDownLatch(2);var start=new CountDownLatch(1);
        List<Map<String,Object>> results;
        try(var pool=Executors.newFixedThreadPool(2)) {
            List<Future<Map<String,Object>>> futures=new ArrayList<>();
            for(var upload:List.of(left,right))futures.add(pool.submit(()->{ready.countDown();if(!start.await(10,TimeUnit.SECONDS))throw new IllegalStateException("start timed out");return complete("alice",upload);}));
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue();start.countDown();
            results=List.of(futures.get(0).get(30,TimeUnit.SECONDS),futures.get(1).get(30,TimeUnit.SECONDS));
        }finally{start.countDown();}
        assertThat(results.stream().map(result->result.get("conflict"))).containsExactlyInAnyOrder(false,true);
        assertThat(results.stream().filter(result->Boolean.FALSE.equals(result.get("conflict"))).findFirst().orElseThrow().get("fileId")).isEqualTo(file);
        var conflict=results.stream().filter(result->Boolean.TRUE.equals(result.get("conflict"))).findFirst().orElseThrow();
        assertThat(conflict.get("fileId")).isNotEqualTo(file);
        assertThat(db.number("SELECT version FROM entries WHERE id=?",file)).isEqualTo(2);
        assertThat(db.number("SELECT COUNT(*) FROM revisions r JOIN entries e ON e.id=r.file_id WHERE e.ns=?",ns)).isEqualTo(3);
        assertThat(complete("alice",left)).isEqualTo(results.get(0));assertThat(complete("alice",right)).isEqualTo(results.get(1));
    }

    @Test void tenGigabyteManifestReservesQuotaWithoutAllocatingPayloadAndRejectsOneByteMore() {
        String ns=namespace();var hashes=Collections.nCopies(2385,"a".repeat(64));
        var upload=begin("alice",manifest(ns,"ten-gigabytes.bin",10_000_000_000L,hashes,null,0));
        assertThat((List<?>)upload.get("parts")).isEmpty();
        assertThat(db.number("SELECT COUNT(*) FROM upload_manifest WHERE upload_id=?",upload.get("id"))).isEqualTo(2385);
        assertThat(db.number("SELECT COUNT(*) FROM blocks WHERE ns=?",ns)).isZero();
        var snapshot=ok(call("alice",HttpMethod.GET,"/namespaces/"+ns+"/snapshot",null,null));
        assertThat(((Number)snapshot.get("reservedBytes")).longValue()).isEqualTo(10_000_000_000L);
        assertThat(call("alice",HttpMethod.POST,"/uploads",manifest(ns,"too-large.bin",10_000_000_001L,hashes,null,0),key()).getStatusCode().value()).isEqualTo(413);
        ok(call("alice",HttpMethod.DELETE,"/uploads/"+upload.get("id"),null,null));
        assertThat(((Number)ok(call("alice",HttpMethod.GET,"/namespaces/"+ns+"/snapshot",null,null)).get("reservedBytes")).longValue()).isZero();
    }

    @Test void movingFolderUnderItsDescendantRejectsCycleWithoutChangingTree() {
        String ns=namespace(),root=folder(ns,"Root",""),child=folder(ns,"Child",root),grandchild=folder(ns,"Grandchild",child);
        var response=call("alice",HttpMethod.PATCH,"/entries/"+root,Map.of("name","Root","parentId",grandchild,"version",1),key());
        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(db.one("SELECT parent_id,version FROM entries WHERE id=?",root)).containsEntry("parentId","").containsEntry("version",1L);
        assertThat(db.one("SELECT parent_id FROM entries WHERE id=?",grandchild)).containsEntry("parentId",child);
    }

    @Test void revocationBlocksPendingPartsCompletionAndCachedOperationRetries() {
        String ns=namespace();share(ns,"writer");byte[] bytes="writer data".getBytes(StandardCharsets.UTF_8);
        var body=manifest(ns,"pending.txt",bytes.length,List.of(BlockCipher.hash(bytes)),null,0);String operation=key();
        var pending=ok(call("bob",HttpMethod.POST,"/uploads",body,operation));String id=(String)pending.get("id");
        ok(part("bob",id,0,bytes));
        var done=begin("bob",manifest(ns,"completed.txt",bytes.length,List.of(BlockCipher.hash(bytes)),null,0));complete("bob",done);
        assertThat(call("alice",HttpMethod.GET,"/uploads/"+id,null,null).getStatusCode().value()).isEqualTo(403);
        share(ns,"none");
        assertThat(call("bob",HttpMethod.POST,"/uploads",body,operation).getStatusCode().value()).isEqualTo(403);
        assertThat(call("bob",HttpMethod.GET,"/uploads/"+id,null,null).getStatusCode().value()).isEqualTo(403);
        assertThat(part("bob",id,0,bytes).getStatusCode().value()).isEqualTo(403);
        assertThat(call("bob",HttpMethod.POST,"/uploads/"+id+"/complete",Map.of(),null).getStatusCode().value()).isEqualTo(403);
        assertThat(call("bob",HttpMethod.POST,"/uploads/"+done.get("id")+"/complete",Map.of(),null).getStatusCode().value()).isEqualTo(403);
        assertThat(call("bob",HttpMethod.DELETE,"/uploads/"+id,null,null).getStatusCode().value()).isEqualTo(403);
        assertThat(db.one("SELECT state FROM uploads WHERE id=?",id)).containsEntry("state","OPEN");
    }

    @Test void purgeRetryUsesTombstoneWithoutRepeatingMutationOrRestoringVisibility() {
        String ns=namespace(),file=(String)createFile(ns,"purged.txt","purge me".getBytes(StandardCharsets.UTF_8)).get("fileId");
        ok(call("alice",HttpMethod.POST,"/entries/"+file+"/trash",Map.of("version",1),key()));String operation=key();
        var first=ok(call("alice",HttpMethod.POST,"/entries/"+file+"/purge",Map.of("version",2),operation));
        assertThat(ok(call("alice",HttpMethod.POST,"/entries/"+file+"/purge",Map.of("version",2),operation))).isEqualTo(first);
        assertThat(call("alice",HttpMethod.POST,"/entries/"+file+"/purge",Map.of("version",2),key()).getStatusCode().value()).isEqualTo(404);
        assertThat(call("alice",HttpMethod.POST,"/entries/"+file+"/purge",Map.of("version",3),operation).getStatusCode().value()).isEqualTo(409);
        assertThat(call("alice",HttpMethod.GET,"/entries/"+file+"/revisions",null,null).getStatusCode().value()).isEqualTo(404);
        assertThat((List<?>)ok(call("alice",HttpMethod.GET,"/namespaces/"+ns+"/snapshot",null,null)).get("entries")).isEmpty();
        assertThat(db.number("SELECT COUNT(*) FROM changes WHERE ns=? AND kind='purge'",ns)).isEqualTo(1);
        assertThat(db.number("SELECT COUNT(*) FROM revisions WHERE file_id=?",file)).isZero();
    }

    @Test void changeFeedPaginatesWithoutGapsAcrossOtherNamespaceSequenceNumbers() {
        String ns=namespace(),other=namespace();
        db.tx(()->{for(int i=0;i<205;i++){catalog.folder("alice",ns,key(),Map.of("name","Folder "+i));if(i%10==0)catalog.folder("alice",other,key(),Map.of("name","Other "+i));}return null;});
        List<Long> received=new ArrayList<>();long after=0;
        for(int expected:List.of(100,100,5)) {
            var page=ok(call("alice",HttpMethod.GET,"/namespaces/"+ns+"/changes?after="+after,null,null));
            List<?> changes=(List<?>)page.get("changes");assertThat(changes).hasSize(expected);
            assertThat(page.get("hasMore")).isEqualTo(expected==100);
            for(var row:changes){var change=(Map<?,?>)row;assertThat(change.get("ns")).isEqualTo(ns);received.add(((Number)change.get("seq")).longValue());}
            after=((Number)page.get("nextCursor")).longValue();assertThat(after).isEqualTo(received.getLast());
        }
        assertThat(received).hasSize(205).doesNotHaveDuplicates().isSorted();
        assertThat(received).isEqualTo(db.rows("SELECT seq FROM changes WHERE ns=? ORDER BY seq",ns).stream().map(row->((Number)row.get("seq")).longValue()).toList());
        var empty=ok(call("alice",HttpMethod.GET,"/namespaces/"+ns+"/changes?after="+after,null,null));
        assertThat((List<?>)empty.get("changes")).isEmpty();assertThat(((Number)empty.get("nextCursor")).longValue()).isEqualTo(after);
        assertThat(empty.get("hasMore")).isEqualTo(false);
        assertThat(call("alice",HttpMethod.GET,"/namespaces/"+ns+"/changes?after=-1",null,null).getStatusCode().value()).isEqualTo(400);
        assertThat(call("alice",HttpMethod.GET,"/namespaces/"+ns+"/changes?after="+(after+1),null,null).getStatusCode().value()).isEqualTo(409);
    }

    @Test void garbageCollectionReleasesCancelledBlocksButPinsOpenUploadsAndRetainedRevisions() {
        String ns=namespace();byte[] retained="retained block".getBytes(StandardCharsets.UTF_8),pending="open block".getBytes(StandardCharsets.UTF_8),abandoned="cancelled block".getBytes(StandardCharsets.UTF_8);
        createFile(ns,"retained.txt",retained);
        var open=begin(ns,"open.txt",pending,null,0);ok(part("alice",(String)open.get("id"),0,pending));
        var cancelled=begin(ns,"cancelled.txt",abandoned,null,0);ok(part("alice",(String)cancelled.get("id"),0,abandoned));
        ok(call("alice",HttpMethod.DELETE,"/uploads/"+cancelled.get("id"),null,null));
        assertThat(ok(call("alice",HttpMethod.POST,"/namespaces/"+ns+"/gc",Map.of(),null))).containsEntry("collectedBlocks",1);
        assertThat(db.number("SELECT COUNT(*) FROM blocks WHERE ns=?",ns)).isEqualTo(2);
        assertThat(db.number("SELECT COUNT(*) FROM blocks WHERE ns=? AND hash=?",ns,BlockCipher.hash(abandoned))).isZero();
        complete("alice",open);
        assertThat(ok(call("alice",HttpMethod.POST,"/namespaces/"+ns+"/gc",Map.of(),null))).containsEntry("collectedBlocks",0);
    }
}
