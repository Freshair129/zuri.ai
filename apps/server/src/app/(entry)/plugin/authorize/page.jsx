// @req FR-123 — the plugin consent screen. `GET /api/plugin/auth/authorize`
// renders this and mints nothing; only the POST this form submits mints a code.
// Every fact on the page is server-derived — the plugin's registered name, the
// capabilities the plugin's own viewer resolves to, the target the code will be
// sent to, and the signed-in account — so nothing a caller puts in the query
// string can be read as a check that was made.
// @spec ADR-052 D4, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-consent-view.test.js, tests/e2e/fr123-plugin-consent.spec.js
import { readPluginConsent } from '@/modules/identity/plugin-consent-access'

export const dynamic = 'force-dynamic'

const ACCESS_LABEL = { read: 'อ่านอย่างเดียว', write: 'เขียน' }

function Refusal({ title, detail }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-[22px] font-bold leading-8 tracking-tight">{title}</h1>
      <p className="mt-2 text-[13px] leading-5 text-muted">{detail}</p>
    </main>
  )
}

export default async function PluginAuthorizePage({ searchParams }) {
  const result = await readPluginConsent(searchParams)

  if (result.state === 'INVALID_REQUEST') {
    // No redirect_uri is echoed and none is followed: the field that would say
    // where to go is the field that failed.
    return (
      <Refusal
        title="คำขอเชื่อมต่อไม่ถูกต้อง"
        detail="คำขอนี้ไม่ผ่านการตรวจสอบของเซิร์ฟเวอร์ ไม่มีการอนุมัติสิทธิ์ใด ๆ เกิดขึ้น กรุณาเริ่มการเชื่อมต่อใหม่จากปลั๊กอินของคุณ"
      />
    )
  }
  if (result.state !== 'READY') {
    return (
      <Refusal
        title="ยังตรวจสอบเซสชันไม่ได้ในขณะนี้"
        detail="ระบบเซสชันไม่พร้อมใช้งานชั่วคราว จึงยังไม่สามารถแสดงหน้าอนุมัติได้ กรุณาลองใหม่อีกครั้ง"
      />
    )
  }

  const { consent } = result
  const accountLabel = consent.account.displayName || consent.account.code || consent.account.id

  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-xs font-semibold" style={{ color: 'var(--action-primary)' }}>อนุมัติการเชื่อมต่อปลั๊กอิน</p>
      <h1 className="mt-0.5 text-[26px] font-bold leading-9 tracking-tight">
        อนุญาตให้ <span data-testid="plugin-name">{consent.pluginName}</span> ทำงานแทนคุณหรือไม่?
      </h1>
      <p className="mt-2 text-[13px] leading-5 text-muted">
        การกดอนุมัติจะออกรหัสอนุญาตใช้ครั้งเดียว อายุ 60 วินาที ส่งไปยังปลายทางที่ลงทะเบียนไว้ด้านล่างเท่านั้น
        ปลั๊กอินจะไม่ได้รับรหัสผ่านหรือคุกกี้เซสชันของคุณ
      </p>

      <section className="card mt-5 p-4" aria-labelledby="consent-account">
        <h2 id="consent-account" className="text-[13px] font-bold">บัญชีที่กำลังให้สิทธิ์</h2>
        <p className="mt-1 text-sm" data-testid="consent-account">{accountLabel}</p>
      </section>

      <section className="card mt-3 p-4" aria-labelledby="consent-capabilities">
        <h2 id="consent-capabilities" className="text-[13px] font-bold">สิทธิ์ที่ปลั๊กอินจะได้รับ</h2>
        {consent.capabilities.length === 0 ? (
          <p className="mt-2 text-xs text-muted" data-testid="consent-capabilities-empty">
            บัญชีนี้ยังไม่มีสิทธิ์เข้าถึงธุรกิจใด ปลั๊กอินจะไม่ได้รับสิทธิ์ใด ๆ
          </p>
        ) : (
          <ul className="mt-2 grid gap-1" data-testid="consent-capabilities">
            {consent.capabilities.map((entry) => (
              <li key={entry.capability} className="text-sm">
                <span className="font-semibold">{entry.capability}</span>
                <span className="ml-2 text-xs text-muted">
                  {ACCESS_LABEL[entry.access] || entry.access}
                  {entry.requiresApproval ? ' · ต้องขออนุมัติซ้ำก่อนเขียนจริงทุกครั้ง' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted">
          รายการนี้คำนวณจากสิทธิ์จริงของบัญชีคุณบนเซิร์ฟเวอร์ ไม่ได้มาจากสิ่งที่ปลั๊กอินร้องขอ
        </p>
      </section>

      <section className="card mt-3 p-4" aria-labelledby="consent-target">
        <h2 id="consent-target" className="text-[13px] font-bold">ปลายทางที่จะได้รับรหัส</h2>
        <p className="mt-1 break-all text-sm" data-testid="consent-redirect-uri">{consent.redirectUri}</p>
        <p className="mt-1 text-[11px] text-muted">
          client_id {consent.clientId} · installation {consent.installationId}
        </p>
      </section>

      <form method="POST" action="/api/plugin/auth/authorize" className="mt-5 flex flex-wrap items-center gap-2">
        <input type="hidden" name="csrf_token" value={consent.csrfToken} />
        <input type="hidden" name="request_token" value={consent.requestToken} />
        <button type="submit" name="decision" value="approve" className="btn btn-primary">
          อนุมัติการเชื่อมต่อ
        </button>
        <button type="submit" name="decision" value="deny" className="btn">
          ปฏิเสธ
        </button>
      </form>
      <p className="mt-2 text-[11px] text-muted">
        คำขออนุมัตินี้มีอายุ 5 นาที หากหมดอายุให้เริ่มการเชื่อมต่อใหม่จากปลั๊กอิน
      </p>
    </main>
  )
}
