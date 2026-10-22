package dev.commonplace;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class IdentityFilter extends OncePerRequestFilter {
    private final Map<String,String> tokens;
    IdentityFilter(@Value("${drive.alice-token}") String alice,@Value("${drive.bob-token}") String bob,@Value("${drive.eve-token}") String eve) {
        if(alice.length()<12||bob.length()<12||eve.length()<12) throw new IllegalArgumentException("Tokens must have at least 12 characters");
        tokens=Map.of(alice,"alice",bob,"bob",eve,"eve");
    }
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain) throws ServletException,IOException {
        res.setHeader("X-Content-Type-Options","nosniff"); res.setHeader("Referrer-Policy","same-origin");
        res.setHeader("Content-Security-Policy","default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
        if(!req.getRequestURI().startsWith("/api/")) { chain.doFilter(req,res); return; }
        res.setHeader("Cache-Control","no-store");
        if(req.getRequestURI().equals("/api/health")) { chain.doFilter(req,res); return; }
        String auth=req.getHeader("Authorization"); String user=auth!=null&&auth.startsWith("Bearer ")?tokens.get(auth.substring(7)):null;
        if(user==null) { res.setStatus(401); res.setContentType("application/json"); res.getWriter().write("{\"code\":\"UNAUTHENTICATED\",\"message\":\"Use a configured local access token.\"}"); return; }
        req.setAttribute("actor",user);
        // JSON endpoints are small. Bound unknown-length bodies too; raw block transport has its own bound.
        boolean part=req.getMethod().equals("PUT")&&req.getRequestURI().matches("/api/uploads/[^/]+/parts/[0-9]+");
        if(!part && !req.getMethod().equals("GET")) {
            byte[] body=req.getInputStream().readNBytes(1_048_577);
            if(body.length>1_048_576) { res.setStatus(413);res.setContentType("application/json");res.getWriter().write("{\"code\":\"BODY_TOO_LARGE\",\"message\":\"JSON request exceeds 1 MiB.\"}");return; }
            chain.doFilter(new HttpServletRequestWrapper(req) {
                @Override public ServletInputStream getInputStream() {
                    var in=new ByteArrayInputStream(body);
                    return new ServletInputStream() {
                        public int read(){ return in.read(); } public boolean isFinished(){return in.available()==0;}
                        public boolean isReady(){return true;} public void setReadListener(ReadListener l) {throw new UnsupportedOperationException();}
                    };
                }
                @Override public BufferedReader getReader(){return new BufferedReader(new InputStreamReader(getInputStream(),java.nio.charset.StandardCharsets.UTF_8));}
            },res);
        } else chain.doFilter(req,res);
    }
}
