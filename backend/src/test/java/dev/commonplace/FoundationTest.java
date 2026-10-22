package dev.commonplace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
    "spring.datasource.url=jdbc:h2:mem:foundation;DB_CLOSE_DELAY=-1", "drive.seed=false", "drive.data=${java.io.tmpdir}/commonplace-foundation"})
class FoundationTest {
    @Autowired TestRestTemplate http;
    @org.junit.jupiter.api.BeforeEach void requests() {
        http.getRestTemplate().setRequestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory());
    }
    ResponseEntity<Map> call(String token, HttpMethod method, String path, Object body, String key) {
        HttpHeaders h=new HttpHeaders(); h.setBearerAuth("local-"+token+"-key");
        if(key!=null) h.set("Idempotency-Key",key);
        return http.exchange("/api"+path,method,new HttpEntity<>(body,h),Map.class);
    }
    @Test void authFoldersStableIdsAndRetryValidation() {
        assertThat(http.getForEntity("/api/namespaces",Map.class).getStatusCode().value()).isEqualTo(401);
        Map ns=call("alice",HttpMethod.POST,"/namespaces",Map.of("name","Test"),"ns").getBody();
        String n=(String)ns.get("id");
        Map folder=call("alice",HttpMethod.POST,"/namespaces/"+n+"/folders",Map.of("name","Notes","parentId",""),"folder").getBody();
        String id=(String)folder.get("id");
        assertThat(call("alice",HttpMethod.POST,"/namespaces/"+n+"/folders",Map.of("name","Notes","parentId",""),"folder").getBody()).isEqualTo(folder);
        assertThat(call("alice",HttpMethod.POST,"/namespaces/"+n+"/folders",Map.of("name","Other"),"folder").getStatusCode().value()).isEqualTo(409);
        assertThat(call("alice",HttpMethod.PATCH,"/entries/"+id,Map.of("name","Renamed","parentId","","version",1),"rename").getBody().get("id")).isEqualTo(id);
        assertThat(call("alice",HttpMethod.PATCH,"/entries/"+id,Map.of("name","Cycle","parentId",id,"version",2),"cycle").getStatusCode().value()).isEqualTo(400);
        assertThat(call("bob",HttpMethod.GET,"/namespaces/"+n+"/snapshot",null,null).getStatusCode().value()).isEqualTo(403);
    }
}
