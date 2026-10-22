package dev.commonplace;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import static org.assertj.core.api.Assertions.*;

/** Fresh application contexts reopen a disposable on-disk database and its real encryption key. */
class RecoveryTest {
    @TempDir Path directory;
    ConfigurableApplicationContext open() {
        return new SpringApplicationBuilder(Application.class).logStartupInfo(false).run(
            "--spring.main.web-application-type=none", "--spring.main.banner-mode=off",
            "--spring.datasource.url=jdbc:h2:file:"+directory.resolve("metadata")+";DB_CLOSE_ON_EXIT=FALSE",
            "--drive.data="+directory, "--drive.seed=false");
    }
    Map<String,Object> manifest(String ns,String name,byte[]... blocks) {
        return Map.of("ns",ns,"name",name,"parentId","","size",Arrays.stream(blocks).mapToLong(block->block.length).sum(),
            "hashes",Arrays.stream(blocks).map(BlockCipher::hash).toList(),"baseVersion",0);
    }
    String populate() {
        try(var context=open()) {
            var db=context.getBean(Database.class);var catalog=context.getBean(Catalog.class);var transfers=context.getBean(Transfers.class);
            return db.tx(()->{
                String ns=(String)catalog.createNamespace("alice","namespace",Map.of("name","Recovery")).get("id");
                byte[] bytes="recoverable payload".getBytes(StandardCharsets.UTF_8);
                var upload=transfers.begin("alice","original",manifest(ns,"original.txt",bytes));
                transfers.part("alice",(String)upload.get("id"),0,bytes);return (String)transfers.complete("alice",(String)upload.get("id")).get("fileId");
            });
        }
    }
    byte[] read(Transfers transfers,String file,String revision) {
        try{var out=new ByteArrayOutputStream();transfers.stream(transfers.downloadInfo("alice",file,revision),out);return out.toByteArray();}
        catch(Exception e){throw new IllegalStateException(e);}
    }

    @Test void restartRetainsPartialUploadsImmutableRevisionsOperationResultsAndChanges() {
        String file=populate();String ns,uploadId;long cursor;
        byte[] first=new byte[4_194_304],tail="resume after restart".getBytes(StandardCharsets.UTF_8);Arrays.fill(first,(byte)42);
        Map<String,Object> uploadBody;
        try(var context=open()) {
            var db=context.getBean(Database.class);var catalog=context.getBean(Catalog.class);var transfers=context.getBean(Transfers.class);
            ns=(String)db.tx(()->catalog.entry(file)).get("ns");uploadBody=manifest(ns,"resumed.bin",first,tail);
            var upload=db.tx(()->transfers.begin("alice","resumable",uploadBody));uploadId=(String)upload.get("id");
            db.tx(()->transfers.part("alice",uploadId,0,first));cursor=db.tx(()->catalog.events.cursor(ns));
        }
        Map<String,Object> completed;
        try(var context=open()) {
            var db=context.getBean(Database.class);var catalog=context.getBean(Catalog.class);var transfers=context.getBean(Transfers.class);
            assertThat(db.tx(()->read(transfers,file,null))).isEqualTo("recoverable payload".getBytes(StandardCharsets.UTF_8));
            var pending=db.tx(()->transfers.status("alice",uploadId));assertThat(pending.get("parts")).isEqualTo(List.of(0));
            assertThat(db.tx(()->transfers.begin("alice","resumable",uploadBody)).get("id")).isEqualTo(uploadId);
            db.tx(()->transfers.part("alice",uploadId,1,tail));completed=db.tx(()->transfers.complete("alice",uploadId));
            var changes=db.tx(()->catalog.events.changes(ns,cursor));
            assertThat((List<?>)changes.get("changes")).hasSize(1);assertThat(changes.get("hasMore")).isEqualTo(false);
        }
        try(var context=open()) {
            var db=context.getBean(Database.class);var catalog=context.getBean(Catalog.class);var transfers=context.getBean(Transfers.class);
            assertThat(db.tx(()->transfers.complete("alice",uploadId))).isEqualTo(completed);
            String resumed=(String)completed.get("fileId");
            db.tx(()->{try{
                var out=new ByteArrayOutputStream();transfers.stream(transfers.downloadInfo("alice",resumed,(String)completed.get("revisionId")),out);
                byte[] expected=Arrays.copyOf(first,first.length+tail.length);System.arraycopy(tail,0,expected,first.length,tail.length);
                assertThat(out.toByteArray()).isEqualTo(expected);
            }catch(Exception e){throw new IllegalStateException(e);}return null;});
            var reuse=db.tx(()->transfers.begin("alice","reused",manifest(ns,"copy.bin",first,tail)));
            assertThat(reuse.get("parts")).isEqualTo(List.of(0,1));
            assertThat((List<?>)db.tx(()->catalog.snapshot("alice",ns)).get("entries")).hasSize(2);
            assertThat(db.tx(()->catalog.events.cursor(ns))).isGreaterThan(cursor);
        }
    }

    @Test void missingKeyWithRetainedBlocksRefusesStartupAndRestoringBackupRecoversData() throws Exception {
        String file=populate();Path key=directory.resolve("block-key.bin");byte[] backup=Files.readAllBytes(key);Files.delete(key);
        assertThatThrownBy(()->{try(var ignored=open()) {}}).hasStackTraceContaining("Missing block-key.bin: restore the key backup; refusing to replace it.");
        assertThat(Files.exists(key)).isFalse();assertThat(Files.exists(directory.resolve("metadata.mv.db"))).isTrue();
        Files.write(key,backup);
        try(var context=open()) {
            var db=context.getBean(Database.class);var transfers=context.getBean(Transfers.class);
            assertThat(db.tx(()->read(transfers,file,null))).isEqualTo("recoverable payload".getBytes(StandardCharsets.UTF_8));
        }
    }

    @Test void corruptOrTruncatedKeyRefusesStartupWithoutReplacingKeyOrPayload() throws Exception {
        String file=populate();Path key=directory.resolve("block-key.bin");byte[] backup=Files.readAllBytes(key),corrupt=backup.clone();corrupt[0]^=1;Files.write(key,corrupt);
        assertThatThrownBy(()->{try(var ignored=open()) {}}).hasStackTraceContaining("Block authentication failed; restore verified data and key backups.");
        assertThat(Files.readAllBytes(key)).isEqualTo(corrupt);
        Files.write(key,new byte[31]);
        assertThatThrownBy(()->{try(var ignored=open()) {}}).hasStackTraceContaining("block-key.bin must contain exactly 32 bytes.");
        assertThat(Files.size(key)).isEqualTo(31);
        Files.write(key,backup);
        try(var context=open()) {
            var db=context.getBean(Database.class);var transfers=context.getBean(Transfers.class);
            assertThat(db.tx(()->read(transfers,file,null))).isEqualTo("recoverable payload".getBytes(StandardCharsets.UTF_8));
        }
    }
}
