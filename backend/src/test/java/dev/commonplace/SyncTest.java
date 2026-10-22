package dev.commonplace;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class SyncTest extends TransferTest {
    @Test void sharingFeedRevocationRetentionAndSafeCollection() {
        String n=ns();byte[] data="retain this revision".getBytes();Map u=start(n,"retained.txt",data,null,0);part((String)u.get("id"),0,data);String file=(String)complete(u).get("fileId");
        assertThat(call("alice",HttpMethod.PUT,"/namespaces/"+n+"/members",Map.of("userId","bob","role","reader"),"share-"+n).getStatusCode().value()).isEqualTo(200);
        assertThat(call("bob",HttpMethod.GET,"/namespaces/"+n+"/snapshot",null,null).getStatusCode().value()).isEqualTo(200);
        assertThat(call("bob",HttpMethod.POST,"/namespaces/"+n+"/folders",Map.of("name","denied"),"deny-"+n).getStatusCode().value()).isEqualTo(403);
        var feed=call("bob",HttpMethod.GET,"/namespaces/"+n+"/changes?after=0",null,null).getBody();assertThat((List)feed.get("changes")).hasSizeGreaterThanOrEqualTo(2);
        long cursor=((Number)feed.get("nextCursor")).longValue();
        assertThat(call("bob",HttpMethod.GET,"/namespaces/"+n+"/notifications?after="+cursor,null,null).getBody().get("changed")).isEqualTo(false);
        assertThat(call("alice",HttpMethod.POST,"/entries/"+file+"/trash",Map.of("version",1),"trash-"+file).getStatusCode().value()).isEqualTo(200);
        assertThat((List)call("alice",HttpMethod.GET,"/entries/"+file+"/revisions",null,null).getBody().get("revisions")).hasSize(1);
        call("alice",HttpMethod.POST,"/namespaces/"+n+"/gc",Map.of(),null);
        assertThat(db.number("SELECT COUNT(*) FROM blocks WHERE ns=?",n)).isEqualTo(1);
        Map reused=start(n,"keeps-block.txt",data,null,0); // active session must pin the same block through purge
        assertThat(call("alice",HttpMethod.POST,"/entries/"+file+"/purge",Map.of("version",2),"purge-"+file).getStatusCode().value()).isEqualTo(200);
        call("alice",HttpMethod.POST,"/namespaces/"+n+"/gc",Map.of(),null);assertThat(db.number("SELECT COUNT(*) FROM blocks WHERE ns=?",n)).isEqualTo(1);
        complete(reused);
        call("alice",HttpMethod.PUT,"/namespaces/"+n+"/members",Map.of("userId","bob","role","none"),"revoke-"+n);
        assertThat(call("bob",HttpMethod.GET,"/namespaces/"+n+"/changes?after="+cursor,null,null).getStatusCode().value()).isEqualTo(403);
    }
    @Test void staleUploadAfterTrashIsPreservedAndExpiredSessionsReleaseSpace() {
        String n=ns();Map first=start(n,"draft.txt","old".getBytes(),null,0);part((String)first.get("id"),0,"old".getBytes());String file=(String)complete(first).get("fileId");
        Map pending=start(n,"draft.txt","offline".getBytes(),file,1);part((String)pending.get("id"),0,"offline".getBytes());
        call("alice",HttpMethod.POST,"/entries/"+file+"/trash",Map.of("version",1),"trash-"+file);
        Map recovered=complete(pending);assertThat(recovered.get("conflict")).isEqualTo(true);
        Map expired=start(n,"expired.txt","unused".getBytes(),null,0);part((String)expired.get("id"),0,"unused".getBytes());
        db.tx(()->{db.update("UPDATE uploads SET expires_at=0 WHERE id=?",expired.get("id"));return null;});
        call("alice",HttpMethod.POST,"/namespaces/"+n+"/gc",Map.of(),null);
        assertThat(call("alice",HttpMethod.POST,"/uploads/"+expired.get("id")+"/complete",Map.of(),null).getStatusCode().value()).isEqualTo(410);
        assertThat(db.number("SELECT COUNT(*) FROM blocks WHERE ns=? AND hash=?",n,hash("unused".getBytes()))).isZero();
    }
}
