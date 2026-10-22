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
