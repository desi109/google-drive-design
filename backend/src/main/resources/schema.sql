CREATE TABLE IF NOT EXISTS namespaces (
 id VARCHAR(80) PRIMARY KEY, name VARCHAR(240) NOT NULL, owner_id VARCHAR(40) NOT NULL,
 quota_bytes BIGINT NOT NULL CHECK (quota_bytes >= 0)
);
CREATE TABLE IF NOT EXISTS members (
 ns VARCHAR(80) NOT NULL REFERENCES namespaces(id), user_id VARCHAR(40) NOT NULL,
 role VARCHAR(10) NOT NULL CHECK(role IN ('owner','writer','reader')), PRIMARY KEY(ns,user_id)
);
CREATE TABLE IF NOT EXISTS entries (
 id VARCHAR(80) PRIMARY KEY, ns VARCHAR(80) NOT NULL REFERENCES namespaces(id),
 parent_id VARCHAR(80) NOT NULL, name VARCHAR(240) NOT NULL,
 folder BOOLEAN NOT NULL, head VARCHAR(80), version BIGINT NOT NULL,
 deleted BOOLEAN NOT NULL DEFAULT FALSE, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_parent ON entries(ns,parent_id,deleted);
CREATE TABLE IF NOT EXISTS operations (
 actor VARCHAR(40) NOT NULL, op_key VARCHAR(160) NOT NULL,
 fingerprint VARCHAR(64) NOT NULL, result_json CLOB NOT NULL, PRIMARY KEY(actor,op_key)
);
CREATE TABLE IF NOT EXISTS blocks (
 ns VARCHAR(80) NOT NULL REFERENCES namespaces(id), hash VARCHAR(64) NOT NULL,
 size_bytes INT NOT NULL, ciphertext BLOB NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(ns,hash)
);
CREATE TABLE IF NOT EXISTS revisions (
 id VARCHAR(80) PRIMARY KEY, file_id VARCHAR(80) NOT NULL REFERENCES entries(id),
 size_bytes BIGINT NOT NULL, author VARCHAR(40) NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS revisions_file ON revisions(file_id,created_at);
CREATE TABLE IF NOT EXISTS revision_blocks (
 revision_id VARCHAR(80) NOT NULL REFERENCES revisions(id), part_index INT NOT NULL,
 ns VARCHAR(80) NOT NULL, hash VARCHAR(64) NOT NULL,
 PRIMARY KEY(revision_id,part_index), FOREIGN KEY(ns,hash) REFERENCES blocks(ns,hash)
);
CREATE TABLE IF NOT EXISTS uploads (
 id VARCHAR(80) PRIMARY KEY, ns VARCHAR(80) NOT NULL REFERENCES namespaces(id), actor VARCHAR(40) NOT NULL,
 file_id VARCHAR(80), parent_id VARCHAR(80) NOT NULL, name VARCHAR(240) NOT NULL,
 base_version BIGINT NOT NULL, size_bytes BIGINT NOT NULL,
 state VARCHAR(16) NOT NULL CHECK(state IN ('OPEN','COMPLETE','EXPIRED','CANCELLED')),
 expires_at BIGINT NOT NULL, result_json CLOB
);
CREATE INDEX IF NOT EXISTS uploads_quota ON uploads(ns,state,expires_at);
CREATE TABLE IF NOT EXISTS upload_manifest (
 upload_id VARCHAR(80) NOT NULL REFERENCES uploads(id), part_index INT NOT NULL, hash VARCHAR(64) NOT NULL,
 PRIMARY KEY(upload_id,part_index)
);
CREATE TABLE IF NOT EXISTS upload_parts (
 upload_id VARCHAR(80) NOT NULL REFERENCES uploads(id), part_index INT NOT NULL,
 ns VARCHAR(80) NOT NULL, hash VARCHAR(64) NOT NULL,
 PRIMARY KEY(upload_id,part_index), FOREIGN KEY(ns,hash) REFERENCES blocks(ns,hash)
);
