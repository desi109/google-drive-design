package dev.commonplace;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Payload encryption, not end-to-end encryption. Metadata remains readable to the server. */
@Component
public class BlockCipher {
    private final byte[] key;
    private final SecureRandom random=new SecureRandom();
    public BlockCipher(@Value("${drive.data}") String directory,Database db) throws Exception {
        Path dir=Path.of(directory).toAbsolutePath();Files.createDirectories(dir);Path path=dir.resolve("block-key.bin");
        if(!Files.exists(path)) {
            if(db.number("SELECT COUNT(*) FROM blocks")>0)throw new IllegalStateException("Missing block-key.bin: restore the key backup; refusing to replace it.");
            byte[] bytes=new byte[32];random.nextBytes(bytes);
            try {Files.createFile(path,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));}
            catch(UnsupportedOperationException e){Files.createFile(path);}
            Files.write(path,bytes,StandardOpenOption.WRITE);
            try(var channel=java.nio.channels.FileChannel.open(path,StandardOpenOption.WRITE)){channel.force(true);}
        }
        key=Files.readAllBytes(path);if(key.length!=32)throw new IllegalStateException("block-key.bin must contain exactly 32 bytes.");
        var first=db.rows("SELECT ns,hash FROM blocks FETCH FIRST 1 ROW ONLY");
        if(!first.isEmpty()){var b=first.getFirst();decrypt((String)b.get("ns"),(String)b.get("hash"),db.jdbc.queryForObject("SELECT ciphertext FROM blocks WHERE ns=? AND hash=?",byte[].class,b.get("ns"),b.get("hash")));}
    }
    static String hash(byte[] bytes){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(Exception e){throw new IllegalStateException(e);}}
    private Cipher cipher(int mode,String ns,String hash,byte[] nonce) throws Exception {
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(mode,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));c.updateAAD((ns+":"+hash).getBytes(StandardCharsets.UTF_8));return c;
    }
    byte[] encrypt(String ns,String hash,byte[] bytes){try{byte[] nonce=new byte[12];random.nextBytes(nonce);byte[] encrypted=cipher(Cipher.ENCRYPT_MODE,ns,hash,nonce).doFinal(bytes);return ByteBuffer.allocate(12+encrypted.length).put(nonce).put(encrypted).array();}catch(Exception e){throw new IllegalStateException(e);}}
    byte[] decrypt(String ns,String hash,byte[] encrypted){try{byte[] bytes=cipher(Cipher.DECRYPT_MODE,ns,hash,Arrays.copyOf(encrypted,12)).doFinal(Arrays.copyOfRange(encrypted,12,encrypted.length));if(!hash(bytes).equals(hash))throw new GeneralSecurityException("Hash mismatch");return bytes;}catch(Exception e){throw new IllegalStateException("Block authentication failed; restore verified data and key backups.",e);}}
}
