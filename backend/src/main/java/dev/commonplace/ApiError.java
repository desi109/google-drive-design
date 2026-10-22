package dev.commonplace;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

public class ApiError extends RuntimeException {
    final int status;
    final String code;
    public ApiError(int status, String code, String message) { super(message); this.status=status; this.code=code; }
    static ApiError bad(String message) { return new ApiError(400,"INVALID_INPUT",message); }
}

@RestControllerAdvice
class Errors {
    @ExceptionHandler(ApiError.class)
    ResponseEntity<?> domain(ApiError e) { return ResponseEntity.status(e.status).body(Map.of("code",e.code,"message",e.getMessage())); }
    @ExceptionHandler({org.springframework.http.converter.HttpMessageNotReadableException.class,
        org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
        org.springframework.web.bind.MissingRequestHeaderException.class})
    ResponseEntity<?> invalid(Exception e) { return ResponseEntity.badRequest().body(Map.of("code","INVALID_REQUEST","message","Check the request fields and headers.")); }
}
