package dev.commonplace;

import java.util.*;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class Seed implements ApplicationRunner {
    final Database db;final Catalog c;final Transfers t;final Lifecycle life;final boolean enabled;
    Seed(Database db,Catalog c,Transfers t,Lifecycle life,@Value("${drive.seed}") boolean enabled){this.db=db;this.c=c;this.t=t;this.life=life;this.enabled=enabled;}
    @Override public void run(ApplicationArguments args){if(!enabled)return;db.tx(()->{
        if(db.number("SELECT COUNT(*) FROM settings WHERE setting_key='seed-v1'")>0)return null;
        String ns=(String)c.createNamespace("alice","seed-namespace",Map.of("name","Studio workspace")).get("id");
        String project=(String)c.folder("alice",ns,"seed-projects",Map.of("name","Product studio","parentId","")).get("id");
        String research=(String)c.folder("alice",ns,"seed-research",Map.of("name","Research","parentId","")).get("id");
        c.folder("alice",ns,"seed-personal",Map.of("name","Personal","parentId",""));
        String file=sample(ns,project,"Project brief.md","# Commonplace\n\nA quieter place for work in progress.\n\nFirst draft: browse, preserve revisions, and keep conflicts visible.\n",null,0,"seed-brief-1");
        sample(ns,project,"Project brief.md","# Commonplace\n\nA quieter place for work in progress.\n\nDecisions\n- Give every file a stable identity.\n- Preserve both sides of a conflicting edit.\n- Treat notifications as hints; trust the changes feed.\n\nNext: test two browsers reconnecting after an offline edit.\n",file,1,"seed-brief-2");
        sample(ns,"","Welcome.txt","Welcome to your workspace.\n\nOpen Product studio for a brief with two immutable revisions.\nOpen this application in two independent browser windows to explore synchronization.\nThis local app stores encrypted blocks and persistent metadata.\n",null,0,"seed-welcome");
        sample(ns,research,"Sync field notes.txt","Field notes\n\nA disconnected client knows its last snapshot, not the current server state.\nSave the observed version with every pending edit.\nOn reconnect, preserve a stale edit as a conflict copy.\n",null,0,"seed-notes");
        sample(ns,project,"Color study.svg","<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"720\" height=\"480\"><rect width=\"720\" height=\"480\" fill=\"#e9eef7\"/><circle cx=\"270\" cy=\"235\" r=\"150\" fill=\"#3d5cc7\"/><rect x=\"350\" y=\"85\" width=\"210\" height=\"300\" rx=\"105\" fill=\"#d5e3cb\"/><text x=\"40\" y=\"440\" font-family=\"sans-serif\" font-size=\"22\" fill=\"#243344\">Commonplace / Color study</text></svg>",null,0,"seed-color");
        life.share("alice",ns,"seed-share",Map.of("userId","bob","role","reader"));db.update("INSERT INTO settings VALUES('seed-v1',?)",ns);return null;
    });}
    String sample(String ns,String parent,String name,String text,String file,long version,String key){byte[] bytes=text.getBytes(StandardCharsets.UTF_8);var body=new HashMap<String,Object>(Map.of("ns",ns,"parentId",parent,"name",name,"size",bytes.length,"hashes",List.of(BlockCipher.hash(bytes)),"baseVersion",version));if(file!=null)body.put("fileId",file);var u=t.begin("alice",key,body);String id=(String)u.get("id");t.part("alice",id,0,bytes);return (String)t.complete("alice",id).get("fileId");}
}
