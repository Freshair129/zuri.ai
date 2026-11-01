---
status: approved
version: "0.1.0"
approval_scope: owner-requested implementation scope only
---

# Visual Office handoff client

The owner requested: “ลุยต่อ เชื่อมปุ่มส่ง handoff จาก Office UI เข้าตัวรับฝั่ง zuri.ai เลือก Business/Workspace ตามสิทธิ์จริง แล้วทดสอบ end-to-end ตั้งแต่ส่งไฟล์จนอ่าน IDs กลับจาก DB โดยไม่สร้างสถานะหรือ approval ปลอม”. This records the implementation mandate, not approval of unreviewed technical choices, a test result, deployment, a Business import or a permission grant.

The client shall transfer the design ZIP to a Zuri-origin page, list destinations from the current persisted session and OWNER scope, let the user choose and submit, and read committed IDs back for the resulting revision. The package must not supply Business or Workspace authority. Zuri's existing receiver checks, expected version, CSRF, idempotency, audit and design-only boundaries remain in force. Deployment origin configuration and external integrations require their own operational evidence. A lost connection or closed popup must not be represented as a confirmed success or failure.

Candidate requirement for independent review:

```text
| FR-295 | Visual Office handoff client transfers the design package to Zuri, lets a signed-in principal select an active Business Workspace under current OWNER authority for its active Business and Tenant, and reports registration only after reading the committed revision and its design ID mappings back from the scoped receiver. | planned |
```

This does not change the Visual Office MVP acceptance, create runtime Agents or grant permissions. Validation of the selected implementation and origin trust is separate from this request.
