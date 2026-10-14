const REFUSAL_MESSAGES = Object.freeze({
  GOODS_RECEIPT_SELF_POST_FORBIDDEN: 'บัญชีที่สร้างใบสั่งซื้อนี้รับของด้วยตนเองไม่ได้โดยปริยาย ให้ผู้ใช้อื่นบันทึกรับของ หรือเลือกยืนยันรับของด้วยตนเองสำหรับใบสั่งซื้อนี้ แล้วลองอีกครั้ง',
  PAYMENT_SELF_VERIFY_FORBIDDEN: 'บัญชีที่บันทึกการชำระรายการนี้ตรวจสอบด้วยตนเองไม่ได้โดยปริยาย ให้ผู้ใช้อื่นตรวจสอบ หรือเลือกยืนยันตรวจการชำระนี้ด้วยตนเองสำหรับรายการนี้ แล้วลองอีกครั้ง',
})

export function selfVerificationRefusalMessage(code) {
  return REFUSAL_MESSAGES[code] ?? null
}
