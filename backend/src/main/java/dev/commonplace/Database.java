package dev.commonplace;

import java.util.*;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** One serialization point, including commit, for this single-process local lab. */
@Component
public class Database {
    final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    public Database(JdbcTemplate jdbc, org.springframework.transaction.PlatformTransactionManager tm) {
        this.jdbc=jdbc; transactions=new TransactionTemplate(tm);
    }
    public synchronized <T> T tx(Supplier<T> action) { return transactions.execute(s -> action.get()); }
    List<Map<String,Object>> rows(String sql,Object... args) {
        return jdbc.queryForList(sql,args).stream().map(raw -> {
            Map<String,Object> m=new LinkedHashMap<>();
            raw.forEach((k,v)-> {
                String[] words=k.toLowerCase(Locale.ROOT).split("_"); StringBuilder name=new StringBuilder(words[0]);
                for(int i=1;i<words.length;i++) name.append(Character.toUpperCase(words[i].charAt(0))).append(words[i].substring(1));
                m.put(name.toString(),v);
            }); return m;
        }).toList();
    }
    Map<String,Object> one(String sql,Object... args) {
        var rows=rows(sql,args); if(rows.isEmpty()) throw new ApiError(404,"NOT_FOUND","The requested item does not exist."); return rows.getFirst();
    }
    long number(String sql,Object... args) { return Objects.requireNonNull(jdbc.queryForObject(sql,Long.class,args)); }
    void update(String sql,Object... args) { jdbc.update(sql,args); }
    static String id() { return UUID.randomUUID().toString(); }
    static long now() { return System.currentTimeMillis(); }
}
