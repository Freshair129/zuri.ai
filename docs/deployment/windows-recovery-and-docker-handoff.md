---
version: "0.1.0"
created_at: "2026-10-06,ATHER"
last_update: "2026-10-06,ATHER"
status: "current"
superseded_by: null
attributes:
  domain: "platform-control"
  doc_type: "deployment-guide"
  scope: "Preserve the existing inaccessible database before Windows reinstall, restore it and resume Docker deployment and the Go Marketing pilot"
---

# Windows ใหม่ → กู้ฐาน Zuri-AI เดิม → deploy Docker

**จุดพัก ณ 2026-10-06:** เจ้าของยืนยันว่าฐาน Zuri-AI เดิมอยู่เครื่องอื่นที่ยังเข้าถึงไม่ได้ และให้เก็บคู่มือนี้บน GitHub เพื่อกลับมาทำหลังติดตั้ง Windows ใหม่. รอบนี้ทำเอกสาร/commit/push เท่านั้น; ไม่มี backup, restore, migration, Docker deployment หรือ report send จริง. Engine/version/schema, path, credentials, Business และ URL ของฐานนั้นยังเป็น UNKNOWN.

คู่มือนี้เป็น handoff สำหรับ [Docker deployment runbook](docker-ngrok.md), ไม่เปลี่ยน ADR-057/ADR-058 หรือออก requirement ใหม่. ปฏิบัติการกับฐานจริงเป็น C-3 / HIGH และต้องเริ่มจาก target ที่ตรวจจริง. ห้ามสร้าง seed/demo แล้วเรียกว่าเป็นฐานเดิม.

## ก่อนติดตั้ง Windows ใหม่

**เก็บฐานและ private config ออกจากดิสก์ที่จะ format ก่อน** — GitHub เก็บ source/migrations/คู่มือ แต่ไม่เก็บข้อมูลในฐาน, Docker volumes, attachment bytes หรือ `.env`. ถ้ายังเข้าถึงเครื่องเดิมไม่ได้และไม่มี backup ที่ตรวจแล้ว ให้รักษาดิสก์ข้อมูลเดิมไว้ก่อน; การลง Windows ไม่สามารถสร้างข้อมูลเดิมกลับจาก repository ได้.

เมื่อเครื่อง/ดิสก์เดิมเข้าถึงได้ ให้บันทึก private inventory ลง storage ที่ไม่ถูก format:

| สิ่งที่เก็บ | สิ่งที่ต้องตรวจ |
|---|---|
| Identity ของ runtime | ชื่อเครื่อง, checkout, release commit/image digest, active Compose project/files/profiles, URL และ port จริง |
| ฐานข้อมูล | engine/major version, local volume/bind path หรือ external provider, schema/migration ledger, Tenant/Business UUID เดิม, จำนวนข้อมูลและ retained evidence |
| Private configuration | `apps/server/.env`, `.env.docker`, applicable overlay config/credential mounts, TLS CA, session secret, ngrok identity/domain; รวม external credential store ที่ runtime อ้างถึง |
| Persisted files | attachment/blob roots, archive mounts และ named volumes ที่ใช้งานจริง; เก็บไฟล์กับ DB reference เป็นชุดเดียวกัน |
| Backup manifest | เวลา capture, engine/tool versions, consistent-backup method, bytes, SHA-256, schema/row counts, private file inventory และ restore-drill result |

Inventory ต้องไม่พิมพ์ credential หรือ full `docker inspect`/rendered Compose environment ไปใน log/chat. ใช้ `docker ps -a`, `docker volume ls` และตรวจ Mounts เฉพาะ container ที่ระบุจริง; volume name ต้องมาจากการ inspect ไม่เดาจาก folder name. สำรอง private config แบบ encrypted/offline และส่งผ่านช่องทาง private เท่านั้น; ห้าม push ขึ้น GitHub แม้เป็น private repo.

## เลือกวิธีสำรองตามฐานที่พบจริง

| Engine/topology | วิธีเก็บข้อมูลเดิม | ข้อจำกัด |
|---|---|---|
| PostgreSQL local/Docker | full logical dump พร้อม schema/data/constraints/triggers/ACLs; เก็บ role definitions/extension inventory แบบ private ด้วย; backup persisted files แยก | บันทึก major version; client `pg_dump` ต้องรองรับ source server. ไม่สมมติว่า Compose default PostgreSQL 16 รับ dump จากรุ่นใหม่กว่าได้ |
| PostgreSQL external เช่น Supabase | verified provider backup หรือ full dump และ private connection/CA inventory; restore rehearsal ใน isolated target | ข้อมูลอาจยังอยู่ provider หลังลง Windows; อย่านำ empty local volume ไปแทน external DB หรือ sync โดยไม่มี mapping |
| SQLite local | ใช้ SQLite Backup API/consistent backup เก็บ whole database; หรือ cold backup หลังหยุดผู้เขียนทั้งหมด รวม journal/WAL/SHM ที่เกี่ยวข้อง | ต้องเก็บ policy/binding/report, linked AuditEvent, scopes, indexes และ triggers ครบ; copy `.db` ขณะเขียนหรือ legacy JSON อย่างเดียวไม่เป็น restore proof |
| Docker Desktop เปิดไม่ได้ | ปิด Docker Desktop ให้สนิท แล้วเก็บ whole VM disk จาก configured disk-image location รวม WSL distribution backup ถ้ามี | ชื่อ/path แตกต่างตาม backend/version. ตรวจของจริงตาม [Docker backup guide](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/); ไม่ยึด fixed C: path หรือ copy VM disk ขณะ engine ใช้งาน |

Container image ไม่รวมข้อมูลใน attached volume. Logical DB backup เป็นหลักสำหรับย้าย engine ที่เข้ากันได้; VM/volume copy เป็นสำเนาเพิ่ม ไม่ใช่หลักฐานว่า restored application อ่านข้อมูลได้. ตรวจ checksum หลังย้ายไฟล์ แล้ว restore ใน target แยกที่ยืนยันว่า empty; เปรียบเทียบ schema, counts/content hashes, UUID/FK, ACL/RLS, functions/triggers และ persisted files ก่อนใช้เป็นฐานจริง.

ตัวอย่าง PostgreSQL ด้านล่างเป็น template สำหรับ target ที่ตรวจและตั้ง private libpq service/passfile แล้วเท่านั้น; ไม่ใส่ URL/password ใน command arguments:

```powershell
# Set private libpq service/passfile for the verified source first.
pg_dump --version
pg_dump --format=custom --file '<verified-backup-directory>/zuri-ai.dump'
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; stop recovery' }
pg_restore --list '<verified-backup-directory>/zuri-ai.dump'
Get-FileHash -Algorithm SHA256 -LiteralPath '<verified-backup-directory>/zuri-ai.dump'
```

Archive listing/checksum ไม่แทน restore drill. ใช้ admin ที่จำเป็นเฉพาะ backup/restore; application ใช้ restricted runtime เดิม. เก็บ original dump แบบ read-only; อย่าใช้ `--no-privileges` แล้วถือว่าสิทธิ์ยังเหมือนเดิม. ไม่ restore ทับ occupied target, ไม่ `db:reset`/`db:clean`, ไม่ลบ volume และไม่ downgrade major version. ดู [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html) และ [SQLite Backup API](https://www.sqlite.org/backup.html).

## หลัง Windows ใหม่พร้อม

1. ติดตั้ง Git, Docker Desktop + WSL 2/Linux containers ตาม [Windows installation guide](https://docs.docker.com/desktop/setup/install/windows-install/). ตรวจ `docker version`, `docker compose version`, `wsl --version`. ยังไม่เปิด web/worker/ngrok ระหว่างตรวจ restore.
2. Clone source ใน directory ใหม่ที่ยืนยันว่าไม่มี WIP; อ่าน AGENTS และเลือก exact approved release SHA. Main ที่มี merged Marketing receiver ใน checkpoint นี้คือ `fd9ca7c606fbe0fd69d35467802f56916675fd7a`; ต้องตรวจ commit ที่จะใช้จริงอีกครั้ง ไม่ถือว่า GitHub main ในอนาคตมี runtime/DB parity อัตโนมัติ. คู่มือ branch/PR นี้ต้อง merge หรือเลือก branch นี้ก่อน จึงจะมีไฟล์เมื่อ clone.
3. ย้าย verified backup และ private config ผ่าน private storage. Map drive/path/mount ของ Windows ใหม่กับของเดิมอย่างชัดเจน; อย่า copy `.env.example` ทับ private config. ค่า credential/session secret/identity เดิมให้คงไว้; ไม่ bootstrap Person/OWNER หรือ rotate code เพื่อแก้ config ที่หาย.
4. ระบุ actual engine, server version, schema ledger, target location และ existing Business/initiative ก่อน restore/migration. Restore rehearsal ลง empty isolated DB/project ก่อน ตรวจ preservation แล้วเสนอ concrete actual-target operation. สำรอง actual target ก่อนเปลี่ยนทุกครั้ง.
5. ทำ schema compatibility review ตาม [database migration discipline](../DB-MIGRATION-NOTES.md#migration-discipline--production-columns-come-from-supabasemigrations-only) และ ADR-057. ใช้ additive migration ที่ตรง engine/ledger เท่านั้น; ห้ามใช้ SQLite SQL กับ PostgreSQL หรือ `prisma db push` แทน reviewed lineage ของ existing production.

คำสั่ง discovery สำหรับ new checkout (ต้องแทน placeholder ก่อนใช้):

```powershell
git clone https://github.com/Freshair129/zuri.ai '<new-empty-checkout>'
Set-Location '<new-empty-checkout>/apps/server'
git rev-parse HEAD
docker version
docker compose version
docker compose config --services
```

ตรวจ config privately; ไม่ใช้ `docker compose config` แบบแสดงทั้งหมดใน public log เพราะอาจ render secrets. ทุก checkout ของ repo ใช้ Compose `name: zuri-ai` เดียวกัน: isolated restore project ต้องกำหนด `-p` ที่ตรวจแล้วและ ports/config/volumes/domain แยก. ห้ามเปิด worktree อีกอันแล้วสมมติว่า containers แยกกัน.

## Docker deployment gate

**Docker production ปัจจุบันใช้ PostgreSQL.** `NODE_ENV=production` ถูกตั้งใน Compose และ `requireProductionDatabaseUrl` ปฏิเสธ SQLite. ถ้าฐานเดิมเป็น SQLite ให้กู้ whole SQLite เพื่อรักษาข้อมูลก่อน แล้วออก concrete SQLite→PostgreSQL migration plan แยก; ไม่แก้ production guard หรือเปลี่ยน provider เพื่อให้เริ่มติดโดยไม่ตรวจข้อมูล. Legacy JSON export/import ปฏิเสธเมื่อมี Marketing policy/binding/report หรือ payload ที่ไม่รองรับ ตาม approved receiver custody contract; ห้าม bypass guard หรือ drop custody เพื่อย้ายฐาน.

สำหรับ existing PostgreSQL ให้รักษา native schema/role/permission lineage เดิม. Bundled `local-db` มี `db-migrate` แบบ schema push สำหรับ bootstrap; อย่าเปิด profile นี้อย่างไม่ตรวจ schema เพราะ restore existing production ไม่ใช่ empty bootstrap. ถ้า major version ต่างจาก bundled 16 หรือจำเป็นต้องเปลี่ยน topology ให้เสนอ target/config plan ก่อน start. External database ไม่ถูก migrate อัตโนมัติเมื่อ container เริ่ม.

เมื่อ restore/migration และ restricted runtime checks ผ่านแล้ว:

1. ตรวจ exact Compose files/profiles/image/source/config ที่อนุมัติ; build หรือเลือก verified immutable image. Image publication ปัจจุบัน suspended จึงห้ามสมมติว่า GHCR `latest` เท่ากับ source ที่เลือก.
2. Start web ตาม [existing Docker runbook](docker-ngrok.md). คำสั่ง `docker compose up` ต้องใช้ reviewed configuration เท่านั้น; ไม่เริ่ม LINE/knowledge/scheduler workers ระหว่าง rehearsal. หากระบบจริงใช้ LINE overlay ต้องรักษา overlay/credential mount และ owner-approved one-writer switch ก่อนเปิดรับงานเดิม; explicit `-f` ต้องระบุทุกไฟล์ที่จำเป็น.
3. ตรวจ local `/api/health`, correct Business/native data, login/read/authorized-write behavior, persisted files และ schema. ตรวจ HTTPS `/api/health` อีกครั้งก่อนเปิด traffic; ngrok รักษา Host header และ `PUBLIC_BASE_URL` ต้องตรง origin.
4. บันทึก source/image digest, Compose identity, DB identity/schema, backup SHA-256, counts/preservation, check results และ cutover time ใน private receipt; commit เฉพาะ sanitized evidence. Public traffic/provider calls เริ่มตาม target-specific approval หลังตรวจครบ.

ถ้า start/read/preservation ไม่ผ่าน ให้หยุด candidate web/workers และเก็บ failure evidence; รักษา original backup และ source DB ไว้. ไม่ rollback source ให้เก่าลงโดยสมมติว่ารับ schema ใหม่ได้ และไม่ restore ทับฐานใช้งานจริง. เลือก fix-forward หรือ restore cutover ที่ตรวจแล้วตาม actual schema.

## กลับมาทำ Zuri-Go Marketing pilot

Go [FEAT-015](https://github.com/Freshair129/zuri-go/tree/main/docs/features/FEAT-015-marketing-report-exchange) มี Local/Production schema 12 และ Go production code deployed; ทั้งสองฐานแยกกัน ไม่ sync จากการย้ายเครื่อง. Source pilot คือ existing Go Local/operator/Business เดิม ไม่ใช่ Go Production. Read-only source preview ผ่านสอง campaigns; ยังไม่มี association/preparation/report/send. Go backups/config ต้องรักษาแยกจาก Zuri-AI; อย่าชี้ Go migrator 012 ไปยัง parent DB.

**Marketing exchange ยังไม่พร้อมบน Docker production PostgreSQL:** `marketingReportDatabase()` คืน null สำหรับ PostgreSQL; receiver รับรองเฉพาะ native SQLite/Prisma 5.22 และ route ปฏิเสธเป็น `REPORT_RECEIVER_UNAVAILABLE` เมื่อไม่มี qualified client. PostgreSQL mirror migration เป็น custody/portability artifact ไม่ใช่ receiver qualification. ต้องออก approved PostgreSQL receiver scope + native transaction/concurrency/lock/permission/replay/backup acceptance ก่อน provision/enable/send ไปยัง Docker target. Docker web health หรือ migration success ไม่ปิด gate นี้.

เมื่อ qualified receiver พร้อมและ verified database เดิมกลับมาแล้ว ให้ resume ตาม Go Local pilot: exact target mapping → reviewed report-only binding/private credential → prepare และตรวจ sanitized preview → อนุมัติรายงานหนึ่งฉบับ → freeze/explicit send → strict matching durable receipt ทั้งสองฝั่ง. Retain evidence/receipt ขั้นต่ำ 90 วันจาก acceptedAt; UNKNOWN ไม่เป็น ACK และไม่มี automatic retry/schedule/purge. Target SQLite ที่แยกไว้จะใช้ได้เฉพาะเมื่อเจ้าของอนุมัติ topology นั้น; ไม่สร้างเพื่อ bypass Docker gate เอง.

## Resume packet หลังติดตั้งเสร็จ

ส่งข้อมูลที่ไม่ใช่ secret ให้ผู้ทำงานต่อ: เครื่องและ checkout path, actual engine/major/schema, private config locator, verified backup locator+checksum+restore-drill result, approved source SHA, app HTTPS origin และเลือก Business/initiative/campaign/week. ไม่ส่ง connection string/password/token หรือ backup contents ในแชต.

จุดเริ่มงานถัดไปคือ read-only target discovery ใหม่; ไม่มี automation เฝ้ารอหรือ migration/deployment ที่เริ่มเองเมื่อเครื่อง online. Owner แจ้งว่า Windows/backup พร้อมแล้วจึง resume. ใช้ตารางนี้บันทึกผลตามที่รันจริง:

| Gate | ตอนจัดทำคู่มือ | หลักฐานที่ต้องมีเมื่อ resume |
|---|---|---|
| Preserve old data/config before reinstall | NOT_RUN — source machine inaccessible | Verified off-disk backup/config and manifest |
| Restore rehearsal / actual restore | NOT_RUN | Same-engine schema/data/permission/file preservation |
| Docker application deployment | NOT_RUN | Exact image/source + health + Business/data/auth + HTTPS |
| PostgreSQL Marketing receiver | UNQUALIFIED / DISABLED | Approved scope and native receiver acceptance |
| Binding / actual report send | NOT_RUN | Exact mapping + preview approval + matching durable receipt |

## Version diff

0 → 0.1.0: adds owner-requested Windows recovery/Docker handoff, private backup custody, engine-specific restore and concrete resume gates; documents existing production PostgreSQL/SQLite receiver incompatibility without changing behavior. No application version/schema/source/runtime, credential or report changed. Documentation validation is recorded in the publishing PR; actual recovery/deployment remains NOT_RUN.
