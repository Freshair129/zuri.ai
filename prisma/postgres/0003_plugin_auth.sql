-- FR-094 / ADR-045: durable public-client authorization-code and plugin-session boundary.
-- Raw authorization codes and bearer tokens are never stored; only hashes are persisted.
CREATE TABLE "PluginInstallation" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginInstallation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluginInstallation_installationId_key" ON "PluginInstallation"("installationId");
CREATE INDEX "PluginInstallation_clientId_status_idx" ON "PluginInstallation"("clientId", "status");

CREATE TABLE "PluginAuthorizationCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "pluginInstallationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginAuthorizationCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PluginAuthorizationCode_pluginInstallationId_fkey"
      FOREIGN KEY ("pluginInstallationId") REFERENCES "PluginInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PluginAuthorizationCode_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PluginAuthorizationCode_codeHash_key" ON "PluginAuthorizationCode"("codeHash");
CREATE INDEX "PluginAuthorizationCode_pluginInstallationId_expiresAt_idx"
  ON "PluginAuthorizationCode"("pluginInstallationId", "expiresAt");
CREATE INDEX "PluginAuthorizationCode_personId_expiresAt_idx"
  ON "PluginAuthorizationCode"("personId", "expiresAt");

CREATE TABLE "PluginSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "pluginInstallationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PluginSession_pluginInstallationId_fkey"
      FOREIGN KEY ("pluginInstallationId") REFERENCES "PluginInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PluginSession_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PluginSession_tokenHash_key" ON "PluginSession"("tokenHash");
CREATE INDEX "PluginSession_pluginInstallationId_expiresAt_idx"
  ON "PluginSession"("pluginInstallationId", "expiresAt");
CREATE INDEX "PluginSession_personId_expiresAt_idx"
  ON "PluginSession"("personId", "expiresAt");

