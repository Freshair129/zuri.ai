---
version: "0.2.0b"
created_at: "2026-08-23T03:15:00+07:00, ATHER"
last_update: "2026-08-23T03:24:00+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-plugin-platform"
  scope: "P2 plugin authentication and capability boundary"
  doc_type: "technical-design"
  parent_spec: "docs/ZURI-PLUGIN-PLATFORM-SPEC.md"
  state_owner: "zuri-ai"
---

# P2 Authentication and Capability Design

## 1. Decision

P2 จะ implement เฉพาะ boundary ที่ตรวจสอบได้และไม่มี side effect เอง:

1. สร้าง authorization transaction แบบ PKCE ใน memory ของ plugin
2. รับ authorization-code exchange ผ่าน `PluginAuthTransport` ที่ inject ได้
3. ตรวจ server-issued grant, installation binding และ expiry ก่อนเก็บ session ชั่วคราว
4. ค้นหา capability ผ่าน transport เดียวกัน และ validate policy snapshot/expiry
5. revoke local session ทันที และ fail closed เมื่อ remote revoke หรือ capability lookup ใช้งานไม่ได้
6. มี default transport ที่ปฏิเสธทุกคำขอ เพราะ live plugin endpoint ยังไม่เป็น canonical contract

Plugin จะไม่รับหรือสร้าง `tenantId`, `businessId`, `membershipId`, `role` หรือ
`policySnapshotId` จาก harness เพื่อใช้เป็น authority. Scope เหล่านี้ต้องมาจากผลลัพธ์ที่
Zuri resolve ฝั่ง server และทุก command ต้องถูกตรวจซ้ำที่ Zuri.

## 2. Canonical Zuri evidence

การตรวจ source ปัจจุบันของ `D:\zuri-ai` พบว่า:

| Source | สิ่งที่ยืนยันได้ |
|---|---|
| `docs/appendices/A-api-spec.md` | `/api/auth/login` ใช้ credential login และ signed HttpOnly session cookie |
| `src/modules/identity/auth-service.js` | session token ถูกสร้างด้วย server secret และมีอายุจำกัด |
| `src/modules/identity/session-port.js` | request identity มาจาก trusted session adapter หรือ session cookie |
| `src/app/api/mcp/route.js` | MCP ต้องมี authenticated viewer และ `Mcp-Session-Id` เป็น protocol continuation |
| `src/modules/project-manager/mcp/transport.js` | MCP session id ไม่ใช่ authorization grant; viewer ต้องมาจาก request ที่ authenticate แล้ว |

ยังไม่พบ canonical device/plugin authorization-code endpoint, token exchange endpoint,
หรือ device-bound revocation contract. ดังนั้นห้ามทำสิ่งต่อไปนี้เป็น P2 implementation:

- ส่ง email/password ของผู้ใช้จาก plugin ไป `/api/auth/login`
- คัดลอกหรือ persist browser session cookie เข้า plugin
- เดา endpoint, token format, refresh flow หรือ DPoP header
- ต่อ Zuri PostgreSQL หรือ PM state โดยตรง
- ใช้ MCP `Mcp-Session-Id` เป็น bearer authorization

## 3. Transport-neutral contract

### 3.1 Authorization transaction

`PluginAuthManager.beginAuthorization()` สร้าง `requestId`, `state`, PKCE
`codeVerifier` และ S256 `codeChallenge`. ค่าเหล่านี้อยู่ใน bounded in-memory map และ
หมดอายุภายในเวลาสั้น ๆ. Adapter ภายนอกเป็นผู้เปิด authorization UI ตาม transport ที่ได้รับอนุมัติ.

`exchangeAuthorizationCode()` จะตรวจ request id, state, redirect URI, installation id และ
อายุ transaction ก่อนเรียก transport. Transaction ถูกใช้ครั้งเดียวแม้ exchange จะล้มเหลว.

### 3.2 Server-issued grant

Transport ต้องคืน grant ที่มีอย่างน้อย:

- opaque short-lived access token สำหรับ transport ที่อนุมัติแล้ว
- server-issued `sessionId` และ `principalId`
- server-confirmed `installationId`
- `expiresAt` ที่อยู่ในอนาคต

Grant ไม่ควรมี tenant/business authority ที่ plugin ต้องเชื่อเอง. Zuri ต้อง resolve
membership, business และ policy ใหม่ในแต่ละ request ตาม canonical server context.

### 3.3 Capability snapshot

Capability response ต้องมี:

- `policySnapshotId`
- `expiresAt`
- รายการ capability ที่ principal เรียกได้
- connector id/version เมื่อ capability ผูกกับ connector
- operation (`read` หรือ `write`), data class และ `requiresApproval`

Capability discovery เป็นข้อมูลสำหรับแสดงเครื่องมือและ UX เท่านั้น ไม่ใช่การอนุมัติ
mutation. Zuri ต้อง authorize command/connector call ซ้ำก่อน side effect.

## 4. Session state

```text
NO_SESSION
  -> AUTHORIZATION_PENDING
  -> AUTHENTICATED
  -> EXPIRED
  -> REVOKED
```

สถานะ `AUTHENTICATED` เก็บ credential ใน memory เท่านั้น. ไม่ persist, ไม่ log และไม่คืน
access token จาก session snapshot. เมื่อหมดอายุหรือ revoke ให้ล้าง credential ทันที.

Remote revoke ล้มเหลวก็ยังต้องหยุดคำขอใหม่ใน local process และคืน error แบบไม่เปิดเผย
credential. ผลลัพธ์นี้ยังไม่ถือเป็นหลักฐานว่า server revoke สำเร็จ; live revocation evidence
เป็น release gate แยกต่างหาก.

## 5. Security invariants

1. Default transport ต้อง fail closed และต้องไม่เรียก network เอง
2. Token/code/verifier ต้องไม่อยู่ใน error message, snapshot, command payload หรือ log
3. Installation mismatch, invalid grant, expired session และ expired capability ต้องถูกปฏิเสธ
4. ทุก command ที่ใช้ capability ต้องผ่าน server-side authentication/authorization ซ้ำ
5. Plugin ไม่เป็น owner ของ PM, pipeline, audit หรือ connector credential state
6. การ restart plugin ต้องทำให้ session หายและต้อง authenticate ใหม่

## 6. Acceptance criteria

| ID | Scenario | Expected result |
|---|---|---|
| P2-AUTH-001 | PKCE transaction ใหม่ | state และ challenge ถูกสร้าง, transaction bounded และใช้ครั้งเดียว |
| P2-AUTH-002 | state/redirect/installation ไม่ตรง | exchange ถูกปฏิเสธก่อนเรียก transport |
| P2-AUTH-003 | grant ถูกต้อง | session authenticated และไม่มี token ใน snapshot |
| P2-AUTH-004 | grant หมดอายุ/installation ผิด | ไม่สร้าง authenticated session |
| P2-AUTH-005 | capability snapshot ถูกต้อง | คืน capability ที่ validate แล้วเท่านั้น |
| P2-AUTH-006 | session/capability หมดอายุ | request ถูก fail closed |
| P2-AUTH-007 | local revoke | request ใหม่ถูกหยุดทันที แม้ remote revoke fail |
| P2-AUTH-008 | ไม่มี live transport | ไม่มี network side effect และคืน unavailable |

## 7. Release boundary

เอกสารนี้รองรับการ implement local/test boundary ของ P2 เท่านั้น. ยังไม่ใช่ production
authentication และยังไม่ปิด gate ต่อไปนี้:

- canonical Edge/plugin device authorization endpoint
- token audience, lifetime, refresh/rotation และ device binding
- live session revocation และ kill-switch evidence
- cross-tenant negative integration test กับ zuri-ai จริง
- security review และ canary approval

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | P2 auth/capability boundary derived from current zuri-ai session and MCP contracts | — | ATHER |
| 0.2.0b | 2026-08-23 | beta | Local PKCE/session/capability boundary implemented and verified; live adapter remains gated | — | ATHER |
