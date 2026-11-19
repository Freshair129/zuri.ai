-- ADR-119 — remove the SmartGift Business from the Zuri database (data only, owner-run).
--
-- DO NOT APPLY WITHOUT THE OWNER. Applying this file is a separate, owner-instructed
-- operator step (ADR-057, docs/plans/SMARTGIFT-BUSINESS-DROP-RUNBOOK-20261120.md); the change
-- that adds it never claims it was applied. Follow the runbook order: LINE console/channel
-- secret revoke -> vault -> binding -> this migration.
--
-- Scope. Exactly one Business: id 834fa869-62f3-431c-a287-e9a95e91175b / code BUS-SMARTGIFT /
-- tenant 77cdbe70-3111-4a04-922a-8059be99a8b0. The tenant is SHARED with other businesses
-- and is never touched, nor is the portfolio. Person rows are kept (a Person is not
-- Business-owned); only the Membership and RoleBinding rows of this Business go. AuditEvent
-- rows are retained (append-only evidence; AuditEvent.businessId is a plain column).
--
-- Mechanism. The table list below is the foreign-key closure of "Business" in
-- prisma/schema.postgres.prisma (every model related to Business, to a Business-scoped
-- model, or carrying a plain businessId column), listed CHILDREN FIRST. It is generated
-- from the schema and checked against it by tests/postgres/smartgift-drop-migration.test.js.
--   1. Membership is computed parents-first into temp tables of ctids, following every
--      declared foreign key from "Business" downwards.
--   2. Guard: if any member row also references a row that is NOT a member (another
--      business's data), the migration aborts with RAISE EXCEPTION before deleting anything.
--   3. Guard: member rows in the retained MarketingReport* tables abort (their delete
--      triggers raise by design; the owner must decide that separately).
--   4. Deletes run children-first, one statement per table, with a RAISE NOTICE row count.
--   5. The Business row is deleted last.
-- The block is idempotent: when the Business is absent it logs a NOTICE and does nothing.
-- It contains no DROP or ALTER statement (the temp tables it creates use ON COMMIT DROP, which only
-- removes them at commit) and runs as one transaction (a DO block is atomic).
-- It needs a role that bypasses RLS (superuser or BYPASSRLS), otherwise it aborts.
--
-- Dry run: SET zuri.smartgift_drop_dry_run = 'on' for the session first; the block then
-- runs every step, prints every count, and finishes with RAISE EXCEPTION so nothing commits.
--
-- Rollback: there is none after commit; restore from the backup taken in the runbook.
-- The zuri_core.* LINE runtime layer, roles, policies and functions are NOT touched here;
-- the runbook carries them as separate, ordered, owner-confirmed SQL.

DO $smartgift_drop$
DECLARE
  target_id     constant text := '834fa869-62f3-431c-a287-e9a95e91175b';
  target_code   constant text := 'BUS-SMARTGIFT';
  target_tenant constant text := '77cdbe70-3111-4a04-922a-8059be99a8b0';
  retained      constant text[] := ARRAY['MarketingReportPolicy', 'MarketingReportBinding', 'MarketingExternalReport'];
  spec          constant jsonb := '[
  {"t":"AccessInvite","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AgentApprovalNotification","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["approvalRequestId"],"p":"AgentApprovalRequest","r":["id"]},{"c":["decisionId"],"p":"AgentApprovalDecision","r":["id"]}]},
  {"t":"AgentMissionEvidence","fk":[{"c":["draftId"],"p":"AgentMissionDraft","r":["id"]},{"c":["workItemId"],"p":"WorkItem","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AgentTraceEvent","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AssetDepreciationCandidate","fk":[{"c":["intakeId"],"p":"AssetIntake","r":["id"]},{"c":["registeredAssetId"],"p":"RegisteredAsset","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AssetExtractionJob","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["evidenceId"],"p":"AssetEvidence","r":["id"]}]},
  {"t":"AssetLocationHistory","fk":[{"c":["registeredAssetId"],"p":"RegisteredAsset","r":["id"]},{"c":["branchId"],"p":"Branch","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AssetProcurementRef","fk":[{"c":["intakeId"],"p":"AssetIntake","r":["id"]},{"c":["registeredAssetId"],"p":"RegisteredAsset","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AssetProjectAllocation","fk":[{"c":["registeredAssetId"],"p":"RegisteredAsset","r":["id"]},{"c":["projectId"],"p":"Project","r":["id"]},{"c":["workstreamId"],"p":"Workstream","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AssetResponsibility","fk":[{"c":["registeredAssetId"],"p":"RegisteredAsset","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"BusinessAgentConfig","fk":[{"c":["businessId","tenantId"],"p":"Business","r":["id","tenantId"]}]},
  {"t":"BusinessBillingProfile","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"BusinessKeyResultCheckIn","fk":[{"c":["keyResultId"],"p":"BusinessKeyResult","r":["id"]}]},
  {"t":"BusinessKpiObservation","fk":[{"c":["kpiId"],"p":"BusinessKpi","r":["id"]}]},
  {"t":"BusinessLeadMeasureValue","fk":[{"c":["leadMeasureId"],"p":"BusinessLeadMeasure","r":["id"]}]},
  {"t":"BusinessWeeklyCommitment","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["leadMeasureId"],"p":"BusinessLeadMeasure","r":["id"]}]},
  {"t":"BusinessWigSession","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ChannelAccountClaim","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"CommerceDocument","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["orderId"],"p":"SalesOrder","r":["id"]},{"c":["branchId"],"p":"Branch","r":["id"]}]},
  {"t":"CommerceDocumentSequence","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ConversationAnalysis","fk":[{"c":["conversationId"],"p":"Conversation","r":["id"]}]},
  {"t":"ConversationEvent","fk":[{"c":["conversationId"],"p":"Conversation","r":["id"]},{"c":["sessionId"],"p":"ConversationSession","r":["id"]}]},
  {"t":"CustomerImportReviewDecision","fk":[{"c":["reviewCaseId"],"p":"CustomerImportReviewCase","r":["id"]},{"c":["provenanceId"],"p":"CustomerImportProvenance","r":["id"]},{"c":["targetCustomerId"],"p":"Customer","r":["id"]}]},
  {"t":"CustomerLegalHold","fk":[{"c":["customerId"],"p":"Customer","r":["id"]}]},
  {"t":"CustomerRetentionConsent","fk":[{"c":["customerId"],"p":"Customer","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"CustomizationWorkOrder","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["rawProductId"],"p":"Product","r":["id"]},{"c":["outputProductId"],"p":"Product","r":["id"]}]},
  {"t":"DeadLetterRecord","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["connectionId"],"p":"IntegrationConnection","r":["id"]},{"c":["ingestionRunId"],"p":"IngestionRun","r":["id"]},{"c":["rawRecordId"],"p":"RawExternalRecord","r":["id"]}]},
  {"t":"EdgeDeviceCredential","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"Employment","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["branchId"],"p":"Branch","r":["id"]}]},
  {"t":"ExternalEntityRef","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["connectionId"],"p":"IntegrationConnection","r":["id"]}]},
  {"t":"FeatureContribution","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["featureId"],"p":"ProjectFeature","r":["id"]}]},
  {"t":"FeatureWorkLink","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["featureId"],"p":"ProjectFeature","r":["id"]},{"c":["workItemId"],"p":"WorkItem","r":["id"]}]},
  {"t":"FileLink","fk":[{"c":["fileId"],"p":"FileAsset","r":["id"]}]},
  {"t":"Gate","fk":[{"c":["projectId"],"p":"Project","r":["id"]},{"c":["workstreamId"],"p":"Workstream","r":["id"]}]},
  {"t":"GenesisRag17EvidenceCursor","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"GenesisRag17IngestionIntent","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"GenesisRag17SourceMention","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"GoodsReceiptLine","fk":[{"c":["receiptId"],"p":"GoodsReceipt","r":["id"]},{"c":["purchaseOrderLineId"],"p":"PurchaseOrderLine","r":["id"]}]},
  {"t":"IntegrationCredentialVersion","fk":[{"c":["credentialId"],"p":"IntegrationCredential","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"IntegrationSecretEnvelope","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"InventoryCatalogIntake","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"InventoryLedgerFence","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"InventoryStocktake","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"KittingWorkOrder","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["recipeId"],"p":"ProductRecipe","r":["id"]},{"c":["finishedProductId"],"p":"Product","r":["id"]}]},
  {"t":"KnowledgeArtifactOperation","fk":[{"c":["storageId"],"p":"KnowledgeArtifactStorage","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"KnowledgeCandidate","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["conversationId"],"p":"Conversation","r":["id"]}]},
  {"t":"KnowledgeChunk","fk":[{"c":["parsedArtifactId"],"p":"KnowledgeParsedArtifact","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"KnowledgeCorpusGeneration","fk":[{"c":["corpusId"],"p":"KnowledgeCorpus","r":["id"]}]},
  {"t":"KnowledgeEvidenceCursor","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"KnowledgeIngestion","fk":[{"c":["corpusId"],"p":"KnowledgeCorpus","r":["id"]},{"c":["sourceId"],"p":"KnowledgeSource","r":["id"]}]},
  {"t":"LineConversationJob","fk":[{"c":["accountId"],"p":"LineOaAccount","r":["id"]},{"c":["inboundMessageId"],"p":"Message","r":["id"]},{"c":["sessionId"],"p":"ConversationSession","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"LineGroundingShadowComparison","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"LineOaLiffApp","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["lineOaAccountId"],"p":"LineOaAccount","r":["id"]}]},
  {"t":"LineOaRichMenuJob","fk":[{"c":["accountId"],"p":"LineOaAccount","r":["id"]},{"c":["richMenuId"],"p":"LineOaRichMenu","r":["id"]},{"c":["richMenuVersionId"],"p":"LineOaRichMenuVersion","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"LineProductDisclosurePolicy","fk":[{"c":["businessId","tenantId"],"p":"Business","r":["id","tenantId"]},{"c":["lineOaAccountId","tenantId","businessId"],"p":"LineOaAccount","r":["id","tenantId","businessId"]},{"c":["productId","tenantId","businessId"],"p":"Product","r":["id","tenantId","businessId"]}]},
  {"t":"LineStockDisclosurePolicy","fk":[{"c":["businessId","tenantId"],"p":"Business","r":["id","tenantId"]},{"c":["lineOaAccountId","tenantId","businessId"],"p":"LineOaAccount","r":["id","tenantId","businessId"]},{"c":["productId","tenantId","businessId"],"p":"Product","r":["id","tenantId","businessId"]}]},
  {"t":"LocalWorkspaceMount","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ManagedBlobRecoveryOperation","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"MarketObservation","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"MarketingBroadcastIntentVersion","fk":[{"c":["intentId"],"p":"MarketingBroadcastIntent","r":["id"]}]},
  {"t":"MarketingContentDecision","fk":[{"c":["briefId"],"p":"MarketingContentBrief","r":["id"]},{"c":["contentVersionId"],"p":"MarketingContentVersion","r":["id"]},{"c":["reviewId"],"p":"MarketingContentReview","r":["id"]}]},
  {"t":"MarketingDecision","fk":[{"c":["planId"],"p":"MarketingPlan","r":["id"]},{"c":["planVersionId"],"p":"MarketingPlanVersion","r":["id"]},{"c":["reviewId"],"p":"MarketingReview","r":["id"]}]},
  {"t":"MarketingExternalReport","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["bindingId"],"p":"MarketingReportBinding","r":["id"]},{"c":["initiativeId"],"p":"MarketingInitiative","r":["id"]},{"c":["planId"],"p":"MarketingPlan","r":["id"]}]},
  {"t":"MarketingOperationsIntake","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"Membership","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"MemoryProjectionReceipt","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"MessageAttachment","fk":[{"c":["messageId"],"p":"Message","r":["id"]}]},
  {"t":"Milestone","fk":[{"c":["projectId"],"p":"Project","r":["id"]},{"c":["workstreamId"],"p":"Workstream","r":["id"]}]},
  {"t":"NotionOAuthState","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"OfficeDesignBlob","fk":[{"c":["registryId"],"p":"OfficeDesignRegistry","r":["id"]}]},
  {"t":"OfficeDesignIdentity","fk":[{"c":["registryId"],"p":"OfficeDesignRegistry","r":["id"]}]},
  {"t":"OfficeDesignImportReceipt","fk":[{"c":["registryId"],"p":"OfficeDesignRegistry","r":["id"]}]},
  {"t":"OfficeDesignRevision","fk":[{"c":["registryId"],"p":"OfficeDesignRegistry","r":["id"]}]},
  {"t":"Payment","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["orderId"],"p":"SalesOrder","r":["id"]},{"c":["slipFileAssetId"],"p":"FileAsset","r":["id"]}]},
  {"t":"PipelineEventReceipt","fk":[{"c":["runId"],"p":"PipelineRun","r":["id"]}]},
  {"t":"PipelineGateDecision","fk":[{"c":["runId"],"p":"PipelineRun","r":["id"]}]},
  {"t":"PipelineReconciliation","fk":[{"c":["runId"],"p":"PipelineRun","r":["id"]},{"c":["stepId"],"p":"PipelineStep","r":["id"]}]},
  {"t":"PipelineRecordEvent","fk":[{"c":["runId"],"p":"PipelineRun","r":["id"]},{"c":["stepId"],"p":"PipelineStep","r":["id"]}]},
  {"t":"PlanImportReceipt","fk":[{"c":["projectId"],"p":"Project","r":["id"]}]},
  {"t":"PricingCalculation","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["ruleSetId"],"p":"PricingRuleSet","r":["id"]}]},
  {"t":"ProductBundleItem","fk":[{"c":["bundleId"],"p":"ProductBundle","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]}]},
  {"t":"ProductIdentifier","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]}]},
  {"t":"ProductRecipeLine","fk":[{"c":["recipeId"],"p":"ProductRecipe","r":["id"]},{"c":["componentProductId"],"p":"Product","r":["id"]}]},
  {"t":"ProductUnitConversion","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]}]},
  {"t":"ProjectApprovalRequest","fk":[{"c":["executionRunDbId"],"p":"ProjectExecutionRun","r":["id"]},{"c":["executionStepDbId"],"p":"ProjectExecutionStep","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ProjectFeatureMutationReceipt","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["projectId"],"p":"Project","r":["id"]},{"c":["featureId"],"p":"ProjectFeature","r":["id"]}]},
  {"t":"ProjectFile","fk":[{"c":["projectId"],"p":"Project","r":["id"]},{"c":["workItemId"],"p":"WorkItem","r":["id"]}]},
  {"t":"ProjectGoal","fk":[{"c":["projectId"],"p":"Project","r":["id"]},{"c":["goalId"],"p":"BusinessGoal","r":["id"]}]},
  {"t":"ProjectTeam","fk":[{"c":["projectId"],"p":"Project","r":["id"]},{"c":["teamId"],"p":"Team","r":["id"]}]},
  {"t":"RequirementBinding","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["featureId"],"p":"ProjectFeature","r":["id"]},{"c":["governanceSnapshotId"],"p":"GovernanceSnapshot","r":["id"]}]},
  {"t":"RoleBinding","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"SalesOrderLine","fk":[{"c":["orderId"],"p":"SalesOrder","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]}]},
  {"t":"SalesTask","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["customerId"],"p":"Customer","r":["id"]},{"c":["conversationId"],"p":"Conversation","r":["id"]}]},
  {"t":"SotDecision","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"StockMovement","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]},{"c":["lotId"],"p":"ProductLot","r":["id"]},{"c":["serialUnitId"],"p":"SerialUnit","r":["id"]},{"c":["sourceLocationId"],"p":"WarehouseLocation","r":["id"]},{"c":["targetLocationId"],"p":"WarehouseLocation","r":["id"]}]},
  {"t":"StockReservation","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]}]},
  {"t":"SupplierCostLine","fk":[{"c":["sheetId"],"p":"SupplierCostSheet","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]}]},
  {"t":"SyncCursor","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["connectionId"],"p":"IntegrationConnection","r":["id"]}]},
  {"t":"TeamMembership","fk":[{"c":["teamId"],"p":"Team","r":["id"]}]},
  {"t":"AgentApprovalDecision","fk":[{"c":["requestId"],"p":"AgentApprovalRequest","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AgentMissionDraft","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AssetEvidence","fk":[{"c":["intakeId"],"p":"AssetIntake","r":["id"]},{"c":["registeredAssetId"],"p":"RegisteredAsset","r":["id"]},{"c":["fileAssetId"],"p":"FileAsset","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"Branch","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"BusinessKeyResult","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["goalId"],"p":"BusinessGoal","r":["id"]}]},
  {"t":"BusinessKpi","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"BusinessLeadMeasure","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["goalId"],"p":"BusinessGoal","r":["id"]}]},
  {"t":"CustomerImportProvenance","fk":[{"c":["batchId"],"p":"CustomerImportBatch","r":["id"]},{"c":["customerId"],"p":"Customer","r":["id"]},{"c":["reviewCaseId"],"p":"CustomerImportReviewCase","r":["id"]}]},
  {"t":"GoodsReceipt","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["purchaseOrderId"],"p":"PurchaseOrder","r":["id"]},{"c":["fxCostSheetId"],"p":"SupplierCostSheet","r":["id"]}]},
  {"t":"IntegrationCredential","fk":[{"c":["connectionId"],"p":"IntegrationConnection","r":["id"]}]},
  {"t":"KnowledgeArtifactStorage","fk":[{"c":["rawArtifactId"],"p":"KnowledgeRawArtifact","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"KnowledgeParsedArtifact","fk":[{"c":["rawArtifactId"],"p":"KnowledgeRawArtifact","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"KnowledgeSource","fk":[{"c":["corpusId"],"p":"KnowledgeCorpus","r":["id"]}]},
  {"t":"LineOaRichMenuVersion","fk":[{"c":["richMenuId"],"p":"LineOaRichMenu","r":["id"]},{"c":["imageFileAssetId"],"p":"FileAsset","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"MarketingBroadcastIntent","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"MarketingContentReview","fk":[{"c":["briefId"],"p":"MarketingContentBrief","r":["id"]},{"c":["contentVersionId"],"p":"MarketingContentVersion","r":["id"]}]},
  {"t":"MarketingInitiative","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["planId"],"p":"MarketingPlan","r":["id"]},{"c":["handoffId"],"p":"MarketingHandoff","r":["id"]}]},
  {"t":"MarketingReportBinding","fk":[{"c":["businessId"],"p":"MarketingReportPolicy","r":["businessId"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"MarketingReview","fk":[{"c":["planId"],"p":"MarketingPlan","r":["id"]},{"c":["planVersionId"],"p":"MarketingPlanVersion","r":["id"]}]},
  {"t":"Message","fk":[{"c":["conversationId"],"p":"Conversation","r":["id"]},{"c":["sessionId"],"p":"ConversationSession","r":["id"]}]},
  {"t":"OfficeDesignRegistry","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["workspaceId"],"p":"Workspace","r":["id"]}]},
  {"t":"PipelineStep","fk":[{"c":["runId"],"p":"PipelineRun","r":["id"]}]},
  {"t":"PricingRuleSet","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["sourceRuleSetId"],"p":"PricingRuleSet","r":["id"]}]},
  {"t":"ProductBundle","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ProductRecipe","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]}]},
  {"t":"ProjectExecutionStep","fk":[{"c":["runId"],"p":"ProjectExecutionRun","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ProjectFeature","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["projectId"],"p":"Project","r":["id"]},{"c":["governanceSnapshotId"],"p":"GovernanceSnapshot","r":["id"]}]},
  {"t":"PurchaseOrderLine","fk":[{"c":["purchaseOrderId"],"p":"PurchaseOrder","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]}]},
  {"t":"SalesOrder","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["customerId"],"p":"Customer","r":["id"]},{"c":["conversationId"],"p":"Conversation","r":["id"]}]},
  {"t":"SerialUnit","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]},{"c":["lotId"],"p":"ProductLot","r":["id"]}]},
  {"t":"Team","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"WarehouseLocation","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AgentApprovalRequest","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["conversationId"],"p":"Conversation","r":["id"]},{"c":["customerId"],"p":"Customer","r":["id"]}]},
  {"t":"BusinessGoal","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["roadmapId"],"p":"BusinessRoadmap","r":["id"]},{"c":["horizonId"],"p":"BusinessRoadmapHorizon","r":["id"]}]},
  {"t":"ConversationSession","fk":[{"c":["conversationId"],"p":"Conversation","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"CustomerImportReviewCase","fk":[{"c":["batchId"],"p":"CustomerImportBatch","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"FileAsset","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["projectId"],"p":"Project","r":["id"]},{"c":["workItemId"],"p":"WorkItem","r":["id"]}]},
  {"t":"GovernanceSnapshot","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["repositoryId"],"p":"Repository","r":["id"]},{"c":["projectRepositoryId"],"p":"ProjectRepository","r":["id"]}]},
  {"t":"KnowledgeCorpus","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"KnowledgeRawArtifact","fk":[{"c":["rawExternalRecordId"],"p":"RawExternalRecord","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"LineOaRichMenu","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["lineOaAccountId"],"p":"LineOaAccount","r":["id"]}]},
  {"t":"MarketingContentVersion","fk":[{"c":["briefId"],"p":"MarketingContentBrief","r":["id"]}]},
  {"t":"MarketingHandoff","fk":[{"c":["planId"],"p":"MarketingPlan","r":["id"]},{"c":["planVersionId"],"p":"MarketingPlanVersion","r":["id"]},{"c":["workspaceId"],"p":"Workspace","r":["id"]},{"c":["projectId"],"p":"Project","r":["id"]}]},
  {"t":"MarketingReportPolicy","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"PipelineRun","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ProductLot","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["productId"],"p":"Product","r":["id"]},{"c":["factoryId"],"p":"Factory","r":["id"]}]},
  {"t":"ProjectExecutionRun","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"PurchaseOrder","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["supplierId"],"p":"Supplier","r":["id"]}]},
  {"t":"RegisteredAsset","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["intakeId"],"p":"AssetIntake","r":["id"]},{"c":["lotId"],"p":"AssetLot","r":["id"]}]},
  {"t":"SupplierCostSheet","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["supplierId"],"p":"Supplier","r":["id"]}]},
  {"t":"AssetIntake","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"AssetLot","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"BusinessRoadmapHorizon","fk":[{"c":["roadmapId"],"p":"BusinessRoadmap","r":["id"]}]},
  {"t":"Conversation","fk":[{"c":["customerId"],"p":"Customer","r":["id"]},{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"CustomerImportBatch","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"LineOaAccount","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["integrationConnectionId"],"p":"IntegrationConnection","r":["id"]},{"c":["memoryProjectId"],"p":"Project","r":["id"]}]},
  {"t":"MarketingContentBrief","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"MarketingPlanVersion","fk":[{"c":["planId"],"p":"MarketingPlan","r":["id"]}]},
  {"t":"Product","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["productMasterId"],"p":"ProductMaster","r":["id"]}]},
  {"t":"ProjectRepository","fk":[{"c":["projectId"],"p":"Project","r":["id"]},{"c":["repoId"],"p":"Repository","r":["id"]}]},
  {"t":"RawExternalRecord","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["connectionId"],"p":"IntegrationConnection","r":["id"]},{"c":["ingestionRunId"],"p":"IngestionRun","r":["id"]}]},
  {"t":"Supplier","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"WorkItem","fk":[{"c":["workstreamId"],"p":"Workstream","r":["id"]},{"c":["containerId"],"p":"WorkContainer","r":["id"]}]},
  {"t":"BusinessRoadmap","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"Customer","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"IngestionRun","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["connectionId"],"p":"IntegrationConnection","r":["id"]}]},
  {"t":"MarketingPlan","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ProductMaster","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["categoryId"],"p":"InventoryCategory","r":["id"]},{"c":["familyId"],"p":"ProductFamily","r":["id"]},{"c":["factoryId"],"p":"Factory","r":["id"]}]},
  {"t":"Repository","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"WorkContainer","fk":[{"c":["workstreamId"],"p":"Workstream","r":["id"]},{"c":["parentId"],"p":"WorkContainer","r":["id"]}]},
  {"t":"Factory","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"IntegrationConnection","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"InventoryCategory","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"ProductFamily","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]},
  {"t":"Workstream","fk":[{"c":["projectId"],"p":"Project","r":["id"]}]},
  {"t":"Project","fk":[{"c":["businessId"],"p":"Business","r":["id"]},{"c":["workspaceId"],"p":"Workspace","r":["id"]}]},
  {"t":"Workspace","fk":[{"c":["businessId"],"p":"Business","r":["id"]}]}
]'::jsonb;
  dry_run       constant boolean := coalesce(current_setting('zuri.smartgift_drop_dry_run', true), '') = 'on';
  n             constant int := jsonb_array_length(spec);
  i             int;
  k             int;
  t             text;
  f             jsonb;
  parent        text;
  match_sql     text;
  notnull_sql   text;
  exists_sql    text;
  member_sql    text;
  cnt           bigint;
  extra         bigint;
  total         bigint := 0;
  counts        jsonb := '{}'::jsonb;
  violations    text := '';
  found_code    text;
  found_tenant  text;
BEGIN
  PERFORM set_config('search_path', 'public, pg_temp', true);

  IF to_regclass('public."Business"') IS NULL THEN
    RAISE NOTICE 'SMARTGIFT_DROP: "Business" does not exist; nothing to do';
    RETURN;
  END IF;

  SELECT b.code, b."tenantId" INTO found_code, found_tenant
    FROM public."Business" b WHERE b.id = target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE NOTICE 'SMARTGIFT_DROP: Business % is already absent; nothing to do', target_id;
    RETURN;
  END IF;
  IF found_code IS DISTINCT FROM target_code OR found_tenant IS DISTINCT FROM target_tenant THEN
    RAISE EXCEPTION 'SMARTGIFT_DROP_TARGET_MISMATCH: id % has code % / tenant %, expected % / %',
      target_id, found_code, found_tenant, target_code, target_tenant;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'SMARTGIFT_DROP_REQUIRES_RLS_BYPASS_ROLE: % cannot see every row through RLS', current_user;
  END IF;

  -- 1. membership, parents first (spec is children first, so walk it backwards)
  CREATE TEMP TABLE "sg_m_Business" (tid tid NOT NULL) ON COMMIT DROP;
  INSERT INTO "sg_m_Business" SELECT b.ctid FROM public."Business" b WHERE b.id = target_id;

  FOR i IN REVERSE n - 1 .. 0 LOOP
    t := spec -> i ->> 't';
    EXECUTE format('CREATE TEMP TABLE %I (tid tid NOT NULL) ON COMMIT DROP', 'sg_m_' || t);
    member_sql := '';
    FOR f IN SELECT * FROM jsonb_array_elements(spec -> i -> 'fk') LOOP
      parent := f ->> 'p';
      SELECT string_agg(format('p.%I = c.%I', r.val, c.val), ' AND ') INTO match_sql
        FROM jsonb_array_elements_text(f -> 'c') WITH ORDINALITY AS c(val, ord)
        JOIN jsonb_array_elements_text(f -> 'r') WITH ORDINALITY AS r(val, ord) USING (ord);
      exists_sql := format('EXISTS (SELECT 1 FROM %I m JOIN public.%I p ON p.ctid = m.tid WHERE %s)',
                           'sg_m_' || parent, parent, match_sql);
      member_sql := member_sql || CASE WHEN member_sql = '' THEN '' ELSE ' OR ' END || exists_sql;
    END LOOP;
    EXECUTE format('INSERT INTO %I SELECT c.ctid FROM public.%I c WHERE %s', 'sg_m_' || t, t, member_sql);
    GET DIAGNOSTICS cnt = ROW_COUNT;
    -- a self-referencing table can contain a child of a member row: iterate to a fixed point
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(spec -> i -> 'fk') AS s(x) WHERE s.x ->> 'p' = t) THEN
      LOOP
        EXECUTE format('INSERT INTO %I SELECT c.ctid FROM public.%I c WHERE NOT EXISTS (SELECT 1 FROM %I q WHERE q.tid = c.ctid) AND (%s)',
                       'sg_m_' || t, t, 'sg_m_' || t, member_sql);
        GET DIAGNOSTICS extra = ROW_COUNT;
        EXIT WHEN extra = 0;
        cnt := cnt + extra;
      END LOOP;
    END IF;
    counts := counts || jsonb_build_object(t, cnt);
  END LOOP;

  -- 2. no member row may point at a row that is not a member (another business's data)
  FOR i IN 0 .. n - 1 LOOP
    t := spec -> i ->> 't';
    FOR f IN SELECT * FROM jsonb_array_elements(spec -> i -> 'fk') LOOP
      parent := f ->> 'p';
      SELECT string_agg(format('p.%I = c.%I', r.val, c.val), ' AND ') INTO match_sql
        FROM jsonb_array_elements_text(f -> 'c') WITH ORDINALITY AS c(val, ord)
        JOIN jsonb_array_elements_text(f -> 'r') WITH ORDINALITY AS r(val, ord) USING (ord);
      SELECT string_agg(format('c.%I IS NOT NULL', c.val), ' AND ') INTO notnull_sql
        FROM jsonb_array_elements_text(f -> 'c') AS c(val);
      EXECUTE format(
        'SELECT count(*) FROM %I m JOIN public.%I c ON c.ctid = m.tid WHERE %s AND NOT EXISTS (SELECT 1 FROM %I pm JOIN public.%I p ON p.ctid = pm.tid WHERE %s)',
        'sg_m_' || t, t, notnull_sql, 'sg_m_' || parent, parent, match_sql) INTO cnt;
      IF cnt > 0 THEN
        violations := violations || format(E'\n  %s (%s) -> %s: %s row(s)', t, (SELECT string_agg(x, ',') FROM jsonb_array_elements_text(f -> 'c') AS x), parent, cnt);
      END IF;
    END LOOP;
  END LOOP;
  IF violations <> '' THEN
    RAISE EXCEPTION 'SMARTGIFT_DROP_CROSS_BUSINESS_REFERENCES: rows of this Business reference rows outside it:%', violations;
  END IF;

  -- 3. retained marketing-report evidence cannot be deleted by a data-only migration
  FOREACH t IN ARRAY retained LOOP
    IF coalesce((counts ->> t)::bigint, 0) > 0 THEN
      RAISE EXCEPTION 'SMARTGIFT_DROP_BLOCKED_RETAINED_MARKETING_REPORT_EVIDENCE: % has % row(s) for this Business; their delete triggers refuse by design',
        t, counts ->> t;
    END IF;
  END LOOP;

  -- 4. delete children first
  FOR i IN 0 .. n - 1 LOOP
    t := spec -> i ->> 't';
    EXECUTE format('DELETE FROM public.%I c USING %I m WHERE c.ctid = m.tid', t, 'sg_m_' || t);
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt <> (counts ->> t)::bigint THEN
      RAISE EXCEPTION 'SMARTGIFT_DROP_COUNT_MISMATCH: % deleted % row(s), expected %', t, cnt, counts ->> t;
    END IF;
    total := total + cnt;
    RAISE NOTICE 'SMARTGIFT_DROP: %: % row(s)', t, cnt;
  END LOOP;

  -- 5. the Business itself
  DELETE FROM public."Business" WHERE id = target_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'SMARTGIFT_DROP_COUNT_MISMATCH: Business deleted % row(s), expected 1', cnt;
  END IF;
  total := total + cnt;
  RAISE NOTICE 'SMARTGIFT_DROP: Business: 1 row(s); % row(s) in total', total;

  IF dry_run THEN
    RAISE EXCEPTION 'SMARTGIFT_DROP_DRY_RUN: % row(s) would be deleted; everything has been rolled back', total;
  END IF;
END
$smartgift_drop$;
