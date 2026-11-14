# Hardware & Workload Performance Audit

**ระบบ:** `D:\zuri-ai` บน Windows 10 Pro  
**ช่วงเก็บหลักฐาน:** 2026-08-21 08:29–08:41 ICT (+07:00)  
**ขอบเขต:** read-only audit; ไม่ kill process, ไม่ reboot, ไม่เปลี่ยน configuration, ไม่ติดตั้ง third-party software และไม่เริ่ม heavy workload จริง

## 1. Executive Summary

### สิ่งที่ยืนยันได้

- เครื่องมี CPU Intel Core i7-8700K (6C/12T), RAM ประมาณ 32 GB และ GPU RTX 3060
- `D:\zuri-ai` อยู่บน `D:` ซึ่ง map ไปยัง HDD WDC 2 TB ไม่ใช่ SSD
- baseline สดช่วงสั้นไม่ใช่ภาวะหนัก: CPU เฉลี่ยประมาณ 28.7% ตาม `% Processor Time` / 37.2% ตาม `% Processor Utility`, disk รวมประมาณ 20.9%, queue ของ processor เป็น 0
- baseline สดมี memory commit ประมาณ 62.5%, committed ประมาณ 40.4 GB, available memory ประมาณ 10.7 GB และ page reads ประมาณ 22.7/s: เป็นแรงกดดันระดับปานกลาง แต่ยังไม่ใช่หลักฐานว่า RAM หมดในช่วงเก็บตัวอย่าง
- มี historical evidence จริงของ virtual-memory pressure: Resource Exhaustion Detector 39 เหตุการณ์ในช่วง 30 วัน และเคยพบ `llama-server.exe` ใช้ working set สูงสุดประมาณ 25.6 GB
- มี historical storage evidence จริง: `disk` Event ID 153/154 และ 157 เกี่ยวกับการ retry, hardware error และ surprise removal ของ logical Disk 6/0/2/5 ตามลำดับ แต่ยัง map หมายเลข event เหล่านี้กับ drive ปัจจุบันไม่ได้

### ข้อสรุปเชิงสาเหตุ

ข้อจำกัดที่น่าจะมีผลจริงคือ **memory/commit pressure ในช่วงที่มี LLM, VM, IDE หรือ build workload พร้อมกัน** และ **ความเสี่ยงด้าน storage/latency จาก HDD ที่เก็บ project และ SQLite artifacts**. อย่างไรก็ตาม ยังไม่มี historical performance counter หรือการ capture ขณะ workload หนัก จึงยังยืนยันไม่ได้ว่า CPU หรือ HDD เป็น bottleneck ต่อเนื่องในช่วงที่ผู้ใช้เห็น 100%.

### ระดับความเสี่ยง

- **สูง:** historical low-virtual-memory events และ process memory collision; historical disk hardware-error/retry/surprise-removal events
- **ปานกลาง:** project/runtime/data paths อยู่บน HDD `D:`; live short sample พบ write latency ของ `D:` สูงสุดประมาณ 318 ms และ queue สูงสุด 9
- **ยังพิสูจน์ไม่ได้:** CPU sustained saturation, disk sustained saturation, ตำแหน่งจริงของ GenesisBlock/RAG store, และสาเหตุรากของ application crashes

## 2. System Inventory

| รายการ | หลักฐานที่พบ |
|---|---|
| OS | Windows 10 Pro, build 19045, ติดตั้ง 2021-02-19 |
| Last boot | 2026-08-19 23:08:21 ICT |
| Mainboard | MSI MS-7B48 / Z370-A PRO, BIOS American Megatrends 2.30 (2017-12-21) |
| CPU | Intel Core i7-8700K @ 3.70 GHz, 6 cores / 12 logical processors |
| RAM | รวมประมาณ 31.96 GB; inventory snapshot เหลือประมาณ 11.51 GB |
| GPU | NVIDIA GeForce RTX 3060, driver `32.0.16.1088`, status OK |
| Power plan | Balanced |
| Hypervisor | `HypervisorPresent = true`; Hyper-V ตรวจพบ hypervisor; WSL2 มี Ubuntu และ `docker-desktop` |
| Pagefile | `C:\pagefile.sys`, allocated 28,672 MB; current usage 1,140 MB; peak 3,941 MB |
| TPM / Secure Boot | ตรวจยืนยันไม่ได้จาก non-admin shell / firmware API ที่มีอยู่ จึงไม่นับเป็น FACT ว่าเปิดหรือปิด |

หมายเหตุ: ค่า virtualization บาง field จาก `Win32_Processor` รายงานไม่สอดคล้องกับ `Win32_ComputerSystem` และ `systeminfo`; ใช้ผลจาก hypervisor/system-level เป็นหลักว่า virtualization ทำงานอยู่

## 3. Storage Mapping

| Volume | File system / ขนาด | Free | Physical mapping | Media จาก API | ความหมายต่อ workload |
|---|---:|---:|---|---|---|
| `C:` | NTFS 232.28 GB | 32.84 GB (~14.1%) | Disk 0 → WDC WDS250G2B0A SSD 250 GB | SSD | OS/pagefile; free space ค่อนข้างตึงแต่ยังใช้งานได้ |
| `D:` | NTFS 1,863.01 GB | 676.87 GB (~36.3%) | Disk 2 → WDC WD20EZRX-00D8PB 2 TB | HDD | **`D:\zuri-ai` อยู่ที่นี่**; project, Prisma/SQLite และ migration artifacts ใช้ path นี้ |
| `G:` | NTFS 931.51 GB | 265.53 GB (~28.5%) | Disk 1 → WDC WD10EZEX-00RKKA0 1 TB | Unspecified/Fixed | มี Docker/ซอฟต์แวร์บางส่วน; media type จาก API ยังไม่ชัดพอที่จะเรียก SSD/HDD |
| `O:` | NTFS 2,794.52 GB | 1,659.92 GB (~59.4%) | Disk 3 → Intel Raid 0 Volume ~3 TB | HDD aggregate | มี Steam listener; member disks ของ RAID ไม่ถูกเปิดเผยโดย standard cmdlet |

ข้อสังเกตสำคัญ: ทุก disk รายงาน `BusType = RAID`. `Get-StorageReliabilityCounter` และ failure-predict status ไม่คืนข้อมูล จึงยังไม่มี SMART/health telemetry ระดับ physical member จากชุดเครื่องมือมาตรฐานนี้

## 4. Historical Evidence

### Event Log และ Reliability

- System log มีประมาณ 44,770 records; Application log มีประมาณ 19,186 records ในช่วงที่ยังเก็บอยู่
- Resource Exhaustion Detector มี 39 เหตุการณ์ Event ID 2004 ในช่วงประมาณ 30 วัน
- WMI Reliability records มี 162 records ในช่วงเดียวกัน และมี 45 records ที่เป็น Application Error/Hang ที่เกี่ยวข้อง
- `Microsoft-Windows-WHEA-Logger/Operational`, `Windows Error Reporting/Operational` และ `ReliabilityAnalysisComponent/Operational` ไม่พบเป็น channel ที่ใช้งานได้ในเครื่องนี้

### Storage events

- `disk` Event ID 154: 64 errors ในวันที่ 2026-07-24; message ระบุ I/O ที่ logical block ล้มเหลวด้วย hardware error บน **Disk 6**
- `disk` Event ID 153: 3 warnings; I/O ของ Disk 6 ถูก retry
- `disk` Event ID 157: 3 warnings; Disk 0, Disk 2 และ Disk 5 ถูก surprise removed
- ไม่มีหลักฐานพอที่จะบอกว่า Disk 6 คือ `D:`, `G:`, `O:` หรือ physical disk ใดใน inventory ปัจจุบัน เพราะหมายเลข device และ topology อาจเปลี่ยนไปแล้ว

### Memory/resource events

Process observations จาก Event ID 2004 มี 117 รายการ โดยค่าสูงสุดที่พบ:

| Process | จำนวน observations | Peak working set | ค่าเฉลี่ยโดยประมาณ |
|---|---:|---:|---:|
| `llama-server.exe` | 14 | 25.587 GB | 16.405 GB |
| `rust-analyzer.exe` | 15 | 3.522 GB | 3.483 GB |
| `vmmem` | 17 | 6.410 GB | 2.763 GB |
| `dota2.exe` | 3 | 6.484 GB | 5.763 GB |
| `node.exe` | 22 | 2.156 GB | 1.565 GB |
| `rustc.exe` | 11 | 2.763 GB | 1.908 GB |
| `LINE.exe` | 29 | 1.438 GB | 1.203 GB |

มี SCM 7023 ที่ระบุ `vmms` ran out of memory และ WER service ระบุ paging file too small ในบางเหตุการณ์ ประเด็นนี้ยืนยัน virtual-memory/commit pressure ในอดีต แต่ไม่ยืนยันว่า physical RAM หมดทุกครั้ง

### SRUM / PerfMon history

- ไม่พบ `C:\Windows\System32\sru\SRUDB.dat`; จึงดึง historical per-app CPU/disk จาก SRUM ไม่ได้
- `C:\PerfLogs` ว่าง; ไม่พบ `.blg`, `.etl` หรือ `.csv` ที่ใช้เป็น historical performance capture ในขอบเขตที่ตรวจ
- `logman query` และ `logman query -ets` ไม่พบ Data Collector Set หรือ active collector
- shell ที่ใช้ audit ไม่ได้รันด้วย Administrator จึงยังไม่ได้สร้าง/เริ่ม `Workload_Bottleneck_Baseline`

## 5. Current Baseline Resource Usage

การ capture สดใช้ `Get-Counter` โดยตรง 4 samples ห่างกัน 2 วินาที จึงเป็น **near-idle/normal activity snapshot ไม่ใช่ heavy workload benchmark**.

| Counter | Average | Max / last | Interpretation |
|---|---:|---:|---|
| CPU `% Processor Time` | 28.735% | 38.675% / 30.045% | ยังไม่ใช่ CPU saturation |
| CPU `% Processor Utility` | 37.181% | 49.729% / 36.825% | มี background activity แต่ไม่เต็ม |
| System processor queue | 0 | 0 | ไม่พบ CPU run-queue pressure ในช่วงสั้น |
| Committed bytes in use | 62.517% | ~62.7% | memory/commit pressure ระดับปานกลาง |
| Available memory | ~10,724 MB | ~10,697 MB | ยังมี headroom แต่ไม่ใช่ idle ที่โล่ง |
| Disk total active time | 20.861% | 31.481% / 13.16% | ไม่ sustained saturation |
| Disk total average queue | 0.834 | current max 9 | มี burst สั้น ๆ |
| Disk total average read latency | ~23 ms | ~40 ms | สูงกว่า SSD แต่ไม่ใช่หลักฐาน queue ยาวต่อเนื่อง |
| Disk total average write latency | ~5 ms | ~10 ms | aggregate ถูกลดทอนโดย disk อื่นที่ idle |

## 6. Heavy Workload Evidence

ไม่มี heavy workload ที่ผู้ใช้อนุมัติให้เริ่ม และไม่มี historical BLG/ETL/SRUM ให้ replay. ดังนั้นตัวเลข 100% CPU / 100% disk / RAM 70–75% ที่ผู้ใช้เคยสังเกตเป็น **USER-REPORTED OBSERVATION** ไม่ใช่ counter ที่ audit นี้ capture ได้

หลักฐานที่ใกล้เคียง heavy workload ที่สุดเป็น historical event:

- `llama-server.exe` เคยขึ้นถึง 25.6 GB working set
- `rust-analyzer.exe` เคยอยู่ราว 3.5 GB ต่อเนื่องในหลาย observations
- มี `vmmem`, Docker/WSL2, Node, IDE และ tool processes อยู่ในเครื่องเดียวกัน
- ปัจจุบันพบ `D:\zuri-ai` dev server และ script processes ทำงานอยู่ แต่ไม่ได้อยู่ในช่วง workload stress ที่ควบคุมตัวแปร

## 7. CPU Analysis

### FACT

- CPU มี 6C/12T
- live total CPU อยู่ประมาณ 23–39% ใน sample
- processor queue เป็น 0
- process snapshot พบ activity จาก `vmmem`, Desktop Window Manager, Defender, Docker Desktop, hardware monitor, LINE และ Node-related processes

### ข้อวิเคราะห์

ยังไม่มีหลักฐานว่า CPU เป็นคอขวดหลักในช่วงที่เก็บตัวอย่าง และไม่มี historical per-core/per-process CPU counter จึงตอบไม่ได้ว่า 100% ที่ผู้ใช้เห็นเป็น CPU saturation จริงหรือเป็น counter ของ process/core ที่ตีความต่างกัน

## 8. Memory Analysis

### FACT

- RAM ทางกายภาพประมาณ 32 GB
- live commit ใช้ประมาณ 62.5%; committed ประมาณ 40.4 GB จาก commit limit ประมาณ 64.38 GB
- available memory ประมาณ 10.7–11.5 GB
- page reads ประมาณ 22.7/s ในช่วง sample
- pagefile อยู่ที่ `C:` ขนาด allocated 28 GB
- historical Event ID 2004 รวม 39 ครั้ง; `llama-server.exe` เป็น process ที่มี peak สูงสุด

### ข้อวิเคราะห์

ปัญหาหลักเป็น **commit/working-set collision เมื่อ workload หนักชนกัน** มากกว่าข้อสรุปว่า RAM เสียหรือ RAM ไม่พอโดยถาวร. การเพิ่ม RAM อาจช่วยได้ แต่ควรยืนยันด้วย capture ขณะ workload จริงก่อน เพราะ pagefile และ current commit limit ยังมี headroom ใน snapshot นี้

## 9. Storage I/O Analysis

### FACT

- `D:` เป็น HDD และเป็นที่อยู่ของ project `D:\zuri-ai`
- live sample ของ `D:` มี active time เฉลี่ยประมาณ 54.7% และ average queue ประมาณ 0.547
- `D:` มี read latency เฉลี่ยประมาณ 21 ms และ write latency เฉลี่ยประมาณ 80 ms; write latency สูงสุดประมาณ 318 ms ในช่วงสั้น
- `G:` active time เฉลี่ยประมาณ 25.5% และ read latency เฉลี่ยประมาณ 18 ms
- `O:` แทบ idle ใน sample
- historical disk hardware error/retry/surprise removal events มีจริง แต่ physical mapping ยังไม่ทราบ

### ข้อวิเคราะห์

HDD `D:` เป็น bottleneck candidate ที่มีน้ำหนัก โดยเฉพาะเมื่อ Node build, Prisma/SQLite, migration JSONL, indexing และ file scanning เกิดพร้อมกัน แต่ short sample ยังไม่พอเรียกว่า sustained disk bottleneck. ค่า queue และ latency ควรเก็บซ้ำในช่วง workload จริงแบบ 15–30 นาที

## 10. Background Automation Analysis

พบ activity ที่สามารถสร้าง resource floor หรือ contention ได้:

- WSL2: Ubuntu stopped และ `docker-desktop` running; มี `vmmem`, Docker Desktop และ `com.docker.backend`
- Ollama app/server ทำงานอยู่ (`ollama.exe serve` ที่ loopback port 11434)
- Node/Next dev server ของ `D:\zuri-ai` ฟังที่ port 3100 และมี script processes หลายตัว
- LINE, Claude/IDE tooling, Defender และ LibreHardwareMonitor/MSI Afterburner ทำงานอยู่
- Steam listener อยู่บน `O:`
- scheduled task `MSIAfterburner` อยู่ในสถานะ Running; `TokenMonitorCodeUsageSync` อยู่ Ready ไม่ใช่ Running ณ ตอนตรวจ
- มี service/agent อื่น เช่น Docker, SSH agent, Claude VM service, OneSync และ monitoring/listener processes

สิ่งเหล่านี้ยืนยันว่าระบบไม่ได้อยู่ใน clean idle state แต่ยังไม่สามารถคำนวณ “ค่าใช้จ่ายต่อวัน” หรือจัดอันดับตัวใดเป็น culprit ได้จาก snapshot สั้น

## 11. Workload Contention Analysis

### Resource collision ที่ยืนยันได้

1. `D:\zuri-ai` และ SQLite/migration artifacts อยู่บน HDD เดียวกับ project runtime
2. WSL2/Docker ใช้ VM memory และมี backend ที่ทำ I/O แยกจาก Node workload
3. Ollama/LLM tooling เคยใช้ memory สูงมากใน historical events
4. Dev server, test/inspection Node scripts และ agent tooling รันพร้อมกันในเครื่องเดียวกัน

### สิ่งที่ยังเป็น HYPOTHESIS

เมื่อ RAG ingestion หรือ migration ทำ file scan, SQLite write, embedding call และ index update พร้อมกับ Docker/Ollama/IDE indexing จะเกิด contention บน memory และ disk queue ได้. ยังไม่มี synchronized before/after capture จึงยังไม่ควรอ้างว่า collision นี้เป็นสาเหตุของอาการ 100% ในทุกครั้ง

## 12. Node.js / Graph RAG Findings

### Paths และ components ที่พบ

- `src/modules/knowledge/gbdb-rag-service.js`: รับ `embeddingProvider`, เรียก `db.addNode`, เรียก `db.flushIndex()` ต่อ item ใน `ingestKnowledgeItem`, และใช้ `db.hybridSearch`
- `src/modules/knowledge/smartgift-rag-pipeline.js`: สร้าง collection `smartgift`, วน categories/products/policies แบบ sequential, เรียก embedding ต่อ item, เพิ่ม node/edge และ flush index ตอนจบ
- `src/modules/knowledge/project-graph.js`: ใช้ Prisma reads หลายชุด โดยบางส่วนใช้ `Promise.all`; เป็น graph projection จาก business/project/customer data
- `src/modules/knowledge/genesisblockdb-sink.js`: client ของ GenesisBlock ถูก inject เข้ามา; source comment อ้างถึง real NAPI-RS client ที่ `G:\GenesisBlock_Dev\GenesisBlock` แต่ module นี้ไม่ได้เปิด store/path เอง
- `src/modules/agent/runtime.js`: ใช้ injected `graphTraverse` หรือ fallback เป็น Prisma; ไม่พบ concrete graph storage path ใน runtime ที่ตรวจ

### ผลต่อ performance

- `gbdb-rag-service.js` ที่ flush ต่อ item มีความเสี่ยงด้าน latency amplification หาก backend index flush มี disk/fsync cost สูง
- SmartGift pipeline ลด flush เหลือท้าย pipeline แล้ว แต่ยังทำ embedding และ per-item node/edge operations แบบ sequential ซึ่งลด throughput เมื่อข้อมูลโต
- SQLite/Prisma files และ migration artifacts อยู่บน HDD `D:`; เป็น known path overlap แต่ยังไม่รู้ว่า GenesisBlock store จริงอยู่ drive ใด
- ไม่พบ configuration ที่ระบุจำนวน worker/concurrency หรือ batch size จาก source ที่ตรวจ; จึงไม่ปรับค่าหรือสรุปว่า setting ใดผิด

## 13. Errors / Reliability Findings

### Application failures ที่ยืนยันได้

- `python.exe` Application Error 1000 จำนวน 18 records, มี exception code `0xc0000005` ในหลายรายการ
- `llama-server.exe` Application Error 1000 จำนวน 14 records, มี `ucrtbase.dll`/`KERNELBASE.dll` และ exception codes หลายแบบ เช่น `0xc0000409`, `0xe06d7363`, `0xc0000005`
- มี Application Hang ของ Antigravity IDE, Docker Desktop, Claude, Dota2 และอื่น ๆ
- PostgreSQL service มี SCM 7000 จาก executable/file ที่หาไม่พบ; TeamViewer มี dependency/AFD errors; มี service timeout บางรายการ

Event Log ยืนยันว่า process/service ล้มเหลวหรือ hang แต่ไม่ได้พิสูจน์ root cause ของแต่ละ crash. ไม่ควรสรุปว่า crash เหล่านี้เกิดจาก hardware โดยตรง

## 14. Evidence Table

| เวลา | Workload | CPU | RAM/commit | Disk / latency | Process | Evidence class |
|---|---|---:|---:|---|---|---|
| 2026-08-21 08:34 | current baseline; no stress workload | 28.7% avg; utility 37.2% | available ~11.5 GB | total active 20.9%; `D:` active 54.7%; `D:` write avg ~80 ms, max ~318 ms; queue max 9 | `vmmem`, Docker, Defender, Node/dev tools | FACT: direct performance counters |
| 2026-08-21 08:41 | current baseline | ไม่ได้เก็บคู่กับ CPU sample | commit 62.5%; committed ~40.4 GB; available ~10.7 GB; page reads ~22.7/s | ไม่ได้เก็บคู่กับ memory sample | system-wide | FACT: direct performance counters |
| 2026-07-24 21:13–21:21 | unknown historical workload | N/A | N/A | Disk 6 retry/hardware error; 64 ID 154 + ID 153 | unidentified Disk 6 | FACT: System Event Log |
| 2026-07-24 22:33 | unknown historical workload | N/A | N/A | Disk 0/2/5 surprise removed | historical device ids | FACT: System Event Log; mapping unresolved |
| 2026-08-05–08-19 | memory pressure windows | N/A | low virtual memory / resource exhaustion | N/A | `llama-server`, `vmmem`, `node`, `rustc`, `rust-analyzer` | FACT: Resource Exhaustion Detector |
| เวลาไม่ทราบ | workload ที่ผู้ใช้เคยพบ | ผู้ใช้รายงาน 100% | ผู้ใช้รายงาน 70–75% | ผู้ใช้รายงาน 100% | ไม่ได้ระบุ capture | OBSERVATION: user-reported, not independently captured |

## 15. Findings and Severity

| Severity | Finding | Confidence | Next proof |
|---|---|---|---|
| High | เคยเกิด commit/virtual-memory pressure เมื่อ process memory สูง | สูงสำหรับ historical event; ต่ำสำหรับทุก workload | capture commit, hard faults, pagefile และ process working set ขณะ workload จริง |
| High | เคยมี disk hardware error/retry/surprise removal | สูงสำหรับ event; ต่ำสำหรับการระบุ physical disk ปัจจุบัน | elevated disk/RAID topology, vendor diagnostics, backup/restore test |
| Medium | `D:` HDD เป็น active project/runtime path และมี latency burst | ปานกลาง | 15–30 นาที PerfMon + per-process I/O ใน workload เดิม |
| Medium | Docker/WSL2/Ollama/IDE/Node มี resource contention potential | ปานกลาง | controlled A/B capture เปิด/ปิด workload ทีละกลุ่ม |
| Low/Info | current CPU sample ไม่ได้เต็ม | สูงเฉพาะช่วง sample | repeat during user-reported 100% window |
| Unknown | GenesisBlock/RAG store อยู่ drive ใดและใช้ backend mode ใดจริง | ต่ำ/ยังไม่มี runtime path | inspect explicit runtime config/handles under approved, read-only capture |

## 16. Facts vs Hypotheses

| ประเภท | รายการ |
|---|---|
| FACT | `D:\zuri-ai` อยู่บน WDC 2 TB HDD (`D:`) |
| FACT | current sample CPU ~29–37%, disk total ~21%, processor queue 0 |
| FACT | historical Resource Exhaustion 39 events; `llama-server.exe` peak ~25.6 GB |
| FACT | historical disk errors/retries/surprise removal มีจริง แต่ mapping ยังไม่ครบ |
| FACT | SRUM database และ historical PerfMon files ไม่พร้อมใช้ |
| OBSERVATION | ผู้ใช้เห็น CPU/disk 100% และ RAM 70–75% ในบางช่วง |
| HYPOTHESIS | RAG/index/migration workload บน HDD ทำให้ queue/latency สูงเมื่อชนกับ Docker/Ollama/IDE |
| HYPOTHESIS | `flushIndex()` ต่อ item ใน GBDB RAG path ขยาย I/O latency ต่อ item |
| HYPOTHESIS | RAM เพิ่มจะช่วยได้มากกว่าการเปลี่ยน CPU เมื่อเกิด LLM/VM memory collision |
| UNKNOWN | event Disk 6/0/2/5 ตรงกับ physical drive ใดใน current RAID topology |
| UNKNOWN | concrete GenesisBlock database/store path และ active backend implementation |

## 17. Limitations

- ไม่มี historical Task Manager graph หรือ PerfMon log จึง reconstruct ช่วงที่ผู้ใช้เห็น 100% ไม่ได้
- ไม่มี SRUMDB.dat ใน `C:\Windows\System32\sru`
- ไม่มี `.blg/.etl/.csv` ที่ใช้งานได้ในขอบเขตที่ตรวจ
- shell ไม่ได้ elevated; TPM/Secure Boot, dirty-bit, RAID member mapping และบาง storage health counters จึง verify ไม่ได้
- standard Windows storage APIs คืน `BusType=RAID` และไม่คืน physical member detail ที่ต้องใช้ map Disk 6
- live process snapshot แรกที่ผ่าน WMI ถูกทิ้งเพราะมี audit instrumentation ปน; baseline ที่รายงานใช้ direct performance counters
- ไม่ได้เริ่ม workload หนักหรือเปลี่ยน process state ตาม safety boundary
- source code ระบุ injected GenesisBlock client แต่ไม่ระบุ concrete runtime store path; ห้ามใช้ source comment เป็นหลักฐานว่า `G:\GenesisBlock_Dev\GenesisBlock` เป็น active production store

## 18. Recommended Next Measurements

### 18.1 ทำเมื่อมี Administrator และมีช่วงเวลาสำหรับ capture

คำสั่งด้านล่างเป็น **template เท่านั้น; audit นี้ไม่ได้รัน**. ต้องรันใน elevated PowerShell และแจ้งผู้ดูแลเครื่องก่อน เพราะสร้างไฟล์/collector ใน `C:\PerfLogs`:

```powershell
New-Item -ItemType Directory -Force C:\PerfLogs | Out-Null

logman create counter Workload_Bottleneck_Baseline `
  -o C:\PerfLogs\Workload_Bottleneck_Baseline.blg `
  -f bincirc -si 00:00:05 -v mmddhhmm -max 2048 `
  -c "\Processor(_Total)\% Processor Time" `
     "\Processor Information(_Total)\% Processor Utility" `
     "\System\Processor Queue Length" `
     "\Memory\Available MBytes" `
     "\Memory\% Committed Bytes In Use" `
     "\Memory\Pages/sec" `
     "\Memory\Page Reads/sec" `
     "\PhysicalDisk(*)\% Disk Time" `
     "\PhysicalDisk(*)\Avg. Disk Queue Length" `
     "\PhysicalDisk(*)\Avg. Disk sec/Read" `
     "\PhysicalDisk(*)\Avg. Disk sec/Write" `
     "\PhysicalDisk(*)\Disk Reads/sec" `
     "\PhysicalDisk(*)\Disk Writes/sec" `
     "\Process(*)\% Processor Time" `
     "\Process(*)\Working Set" `
     "\Process(*)\IO Data Bytes/sec"

logman start Workload_Bottleneck_Baseline
# เก็บอย่างน้อย 15–30 นาที แล้วจึงหยุด
logman stop Workload_Bottleneck_Baseline
```

หลัง capture ควร export เป็น CSV ด้วย `relog` และบันทึก timestamp ของ workload/app logs คู่กัน. ถ้า `Process(*)` กว้างเกินไป ให้เปลี่ยนเป็น process instances ที่พบจริง เช่น Node, `llama-server`, `vmmem`, Docker และ IDE เพื่อไม่ให้ collector เองสร้าง overhead มากเกินไป

### 18.2 A/B capture ที่แนะนำ

1. A: 15–30 นาทีในสภาพปกติ โดยไม่เริ่มงานหนักใหม่
2. B: งาน representative ที่ไม่ destructive และผู้ใช้อนุมัติเท่านั้น
3. เก็บ counters ชุดเดียวกัน, drive mapping เดิม, process list, commit limit, pagefile และ application timestamps
4. เปรียบเทียบ CPU saturation, disk queue/latency, hard faults/page reads และ per-process I/O; อย่าตัดสินจาก `% Disk Time` ตัวเดียว

### 18.3 สิ่งที่ควรตรวจเพิ่มแบบ read-only

- elevated `Get-Disk`, `Get-PhysicalDisk`, `Get-PnpDevice` และ Intel RAID/RST topology เพื่อ map historical Disk 6
- vendor health/SMART diagnostics หลังยืนยันว่าเครื่องมืออ่าน RAID member ได้ และต้องเก็บ backup ก่อนทดสอบที่มีความเสี่ยง
- ตรวจว่า active RAG/GenesisBlock runtime เปิดไฟล์หรือ volume ใดจริงด้วย process/file-handle evidence ที่อนุมัติแล้ว
- ทำ backup/restore verification เนื่องจากมี historical surprise-removal evidence

## 19. Remediation Options

### Zero-cost

- แยกเวลา LLM/Ollama, Docker/WSL2, IDE indexing, build/test และ migration/indexing ไม่ให้ชนกัน
- อย่าเปิด Steam/game หรือ scan/index ใหญ่พร้อมกับ RAG ingestion บน `D:`
- คุม batch/concurrency ของ Node ingestion และเก็บ per-stage timing; ยังไม่เปลี่ยนค่าใน audit นี้
- ปิด dev server/script ที่ไม่ใช้ด้วยการตัดสินใจของผู้ใช้เท่านั้น และเก็บ baseline ก่อน/หลัง
- รักษา free space ของ `C:` และหลีกเลี่ยงการให้ pagefile อยู่บน volume ที่มี I/O แข่งขันสูงกว่านี้

### Low-cost

- ย้าย active project, SQLite/Prisma DB, temp และ index ที่เขียนบ่อยจาก HDD `D:` ไป SSD/NVMe ที่ตรวจสุขภาพแล้ว
- แยก source/read volume กับ index/write/temp volume ถ้าทำได้
- ทำ backup ที่ตรวจ restore ได้ ก่อนแก้ RAID/storage layout
- ปรับ pipeline ให้ batch node/edge writes และลดการ flush ต่อ item หลังมี benchmark ยืนยันผลกระทบ

### Hardware Upgrade

ลำดับที่มีเหตุผลจากหลักฐานปัจจุบันคือ **SSD/NVMe สำหรับ active I/O path ก่อน**. เพิ่ม RAM เมื่อ capture ขณะ workload จริงยืนยันว่า commit เข้าใกล้ limit, page activity สูง และ process working sets ชนกันซ้ำ ๆ. ยังไม่มีหลักฐานจาก audit นี้ให้เปลี่ยน CPU/GPU เป็นอันดับแรก

### Cloud / Hybrid

พิจารณาเมื่อ workload ถูกวัดแล้วว่าต้องการ RAM/CPU/IOPS สูงเกินเครื่อง local จริง. ต้องวัด network latency, data transfer cost, privacy/tenant boundary และ embedding/model serving cost ก่อนย้าย RAG หรือ LLM ไป cloud; cloud ไม่ได้แก้ปัญหา source/SQLite/RAID ที่ยังอยู่บน local disk โดยอัตโนมัติ

---

**Audit status:** evidence-based, read-only, not a release/readiness sign-off.  
**การเปลี่ยนแปลงระบบจาก audit นี้:** ไม่มี
