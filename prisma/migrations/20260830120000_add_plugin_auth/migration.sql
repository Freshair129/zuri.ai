-- FR-123 / ADR-052: durable public-client authorization-code and plugin-session boundary.
-- Raw authorization codes and bearer tokens are never stored; only hashes are persisted.
-- Dev/test lane (SQLite). The production DDL lives in
-- supabase/migrations/20260830120000_plugin_auth.sql, whose filenames map 1:1
-- with rows in supabase_migrations.schema_migrations.
CREATE TABLE "PluginInstallation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "installationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "PluginInstallation_installationId_key" ON "PluginInstallation"("installationId");
CREATE INDEX "PluginInstallation_clientId_status_idx" ON "PluginInstallation"("clientId", "status");

CREATE TABLE "PluginAuthorizationCode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "codeHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
  "pluginInstallationId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PluginAuthorizationCode_pluginInstallationId_fkey"
    FOREIGN KEY ("pluginInstallationId") REFERENCES "PluginInstallation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PluginAuthorizationCode_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PluginAuthorizationCode_codeHash_key" ON "PluginAuthorizationCode"("codeHash");
CREATE INDEX "PluginAuthorizationCode_pluginInstallationId_expiresAt_idx"
  ON "PluginAuthorizationCode"("pluginInstallationId", "expiresAt");
CREATE INDEX "PluginAuthorizationCode_personId_expiresAt_idx"
  ON "PluginAuthorizationCode"("personId", "expiresAt");

CREATE TABLE "PluginSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "pluginInstallationId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "authorizationCodeId" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "lastUsedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PluginSession_pluginInstallationId_fkey"
    FOREIGN KEY ("pluginInstallationId") REFERENCES "PluginInstallation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PluginSession_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PluginSession_tokenHash_key" ON "PluginSession"("tokenHash");
CREATE INDEX "PluginSession_pluginInstallationId_expiresAt_idx"
  ON "PluginSession"("pluginInstallationId", "expiresAt");
CREATE INDEX "PluginSession_personId_expiresAt_idx"
  ON "PluginSession"("personId", "expiresAt");
CREATE INDEX "PluginSession_authorizationCodeId_idx"
  ON "PluginSession"("authorizationCodeId");
