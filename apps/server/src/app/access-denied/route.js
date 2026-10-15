// @req FR-105 — give authenticated non-operators a clear, non-cached 403 response.
// @spec ADR-048 D2, SEC-020
// @tested tests/unit/platform-control-access-denied.test.js

export const dynamic = 'force-dynamic'

const DENIED_PAGE = `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <style>
      :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #20252d; background: #f4f6f8; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 1.25rem; }
      main { width: min(100%, 34rem); padding: clamp(1.5rem, 6vw, 2.5rem); border: 1px solid #d9dee5; border-radius: 1rem; background: #fff; box-shadow: 0 1rem 3rem rgb(25 35 50 / 9%); }
      h1 { margin: 0; font-size: clamp(1.5rem, 5vw, 2rem); line-height: 1.25; }
      p { color: #596273; line-height: 1.65; }
      nav { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.5rem; }
      a { min-height: 2.75rem; display: inline-flex; align-items: center; justify-content: center; padding: .65rem 1rem; border: 1px solid #cbd2dc; border-radius: .5rem; color: #343b46; font-weight: 650; text-decoration: none; }
      a:first-child { border-color: #b6530e; background: #b6530e; color: #fff; }
      a:focus-visible { outline: 3px solid #182f54; outline-offset: 3px; }
      @media (max-width: 26rem) { nav, a { width: 100%; } }
    </style>
    <title>ไม่มีสิทธิ์เข้าถึง | Zuri AI</title>
  </head>
  <body>
    <main>
      <h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
      <p>บัญชีนี้ไม่มีสิทธิ์เข้าถึงพื้นที่ควบคุม</p>
      <p>เข้าสู่ระบบด้วยบัญชีอื่นที่มีสิทธิ์ หรือกลับไปยังหน้าหลัก</p>
      <nav aria-label="ตัวเลือกการนำทาง">
        <a href="/login">เข้าสู่ระบบด้วยบัญชีอื่น</a>
        <a href="/">กลับหน้าหลัก</a>
      </nav>
    </main>
  </body>
</html>`

export function GET() {
  return new Response(DENIED_PAGE, {
    status: 403,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
