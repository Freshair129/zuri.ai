// @req FR-024 — SmartGift Knowledge Catalog: seed products, categories, and business policies.
// @spec ADR-007 §P5 — Curated catalog for SmartGift (Business-01) with live-fact exclusion.

export const SMARTGIFT_CATEGORIES = [
  {
    id: 'cat:drinkware',
    type: 'Category',
    title: 'แก้วน้ำและกระบอกน้ำเก็บอุณหภูมิ (Drinkware)',
    description: 'กระบอกน้ำสแตนเลส แก้วเก็บความเย็น/ร้อน กระบอกน้ำรักษ์โลก สำหรับแจกเป็นของพรีเมียม',
  },
  {
    id: 'cat:tech_gadgets',
    type: 'Category',
    title: 'อุปกรณ์ไอทีและแกดเจ็ตพรีเมียม (Tech Gadgets)',
    description: 'Power Bank ไร้สาย, USB Flash Drive, ลำโพงบลูทูธพกพา, แท่นชาร์จไร้สาย สกรีนโลโก้องค์กร',
  },
  {
    id: 'cat:eco_friendly',
    type: 'Category',
    title: 'สินค้ารักษ์โลกและเป็นมิตรต่อสิ่งแวดล้อม (Eco-Friendly)',
    description: 'สมุดปกไม้ไผ่ ปากการีไซเคิล กระเป๋าผ้าแคนวาส ชุดช้อนส้อมพกพาจากฟางข้าวสาลี',
  },
  {
    id: 'cat:leather_stationery',
    type: 'Category',
    title: 'เครื่องหนังและชุดเครื่องเขียนผู้บริหาร (Executive & Leather)',
    description: 'กระเป๋าใส่นามบัตรหนังแท้ สมุดโน้ตหนัง PU ปกแข็ง ปากกาโลหะพรีเมียมพร้อมกล่องของขวัญ',
  },
]

export const SMARTGIFT_PRODUCTS = [
  {
    id: 'prod:sg-tumbler-500',
    type: 'Product',
    code: 'SG-TM-500',
    title: 'กระบอกน้ำสุญญากาศสแตนเลส 304 ขนาด 500ml',
    text: 'กระบอกน้ำเก็บอุณหภูมิร้อน-เย็นได้ 12-24 ชั่วโมง ผลิตจากสแตนเลสเกรดอาหาร 304 ฝาปิดแน่นป้องกันการรั่วซึม รองรับการสกรีนโลโก้ UV หรือเลเซอร์สลักชื่อ ขั้นต่ำ (MOQ): 50 ชิ้น สีที่มี: ขาว, ดำ, เงินด้าน, น้ำเงินเนวี่',
    moq: 50,
    leadTimeDays: 7,
    printingMethods: ['Laser Engraving', 'UV Color Print', 'Silkscreen'],
    categoryId: 'cat:drinkware',
  },
  {
    id: 'prod:sg-powerbank-10000',
    type: 'Product',
    code: 'SG-PB-10000',
    title: 'Power Bank ไร้สายความจุ 10,000mAh มาตรฐาน มอก.',
    text: 'แบตเตอรี่สำรองความจุ 10,000mAh รองรับชาร์จไว Fast Charge 22.5W และ Magnetic Wireless 15W ผิวสัมผัสเนื้อแมตต์พรีเมียม สกรีนโลโก้แบบ LED ติดไฟตอนใช้งาน ขั้นต่ำ (MOQ): 30 ชิ้น ได้มาตรฐาน มอก. พร้อมกล่องแพ็กเกจจิ้งหรู',
    moq: 30,
    leadTimeDays: 10,
    printingMethods: ['LED Logo Engrave', 'UV Full Color'],
    categoryId: 'cat:tech_gadgets',
  },
  {
    id: 'prod:sg-bamboo-notebook-set',
    type: 'Product',
    code: 'SG-ECO-001',
    title: 'ชุดสมุดโน้ตปกไม้ไผ่พร้อมปากการักษ์โลก (Eco Bamboo Set)',
    text: 'ชุดกิฟต์เซตรักษ์โลก สมุดโน้ตกระดาษถนอมสายตา Green Read ปกผลิตจากไม้ไผ่ธรรมชาติแท้ พร้อมปากกาไม้ไผ่กลไกกด บรรจุในกล่องกระดาษคราฟต์รีไซเคิล ขั้นต่ำ (MOQ): 50 ชิ้น เหมาะสำหรับงานประชุม สัมมนา และ CSR',
    moq: 50,
    leadTimeDays: 5,
    printingMethods: ['Laser Engraving', 'Silkscreen Eco Ink'],
    categoryId: 'cat:eco_friendly',
  },
  {
    id: 'prod:sg-leather-cardholder',
    type: 'Product',
    code: 'SG-LTH-002',
    title: 'กระเป๋าใส่นามบัตรหนังแท้เกรดพรีเมียม (Executive Cardholder)',
    text: 'ที่ใส่นามบัตรและบัตรเครดิตผลิตจากหนังแท้ตัดเย็บประณีต มีช่องใส่บัตร 6 ช่องพร้อมช่องกลาง ปั๊มจม (Emboss) หรือปั๊มฟอยล์ทอง/เงินโลโก้องค์กรได้ ขั้นต่ำ (MOQ): 30 ชิ้น มาพร้อมกล่องฝาครอบสีดำผูกริบบิ้น',
    moq: 30,
    leadTimeDays: 7,
    printingMethods: ['Blind Deboss', 'Gold/Silver Foil Stamp'],
    categoryId: 'cat:leather_stationery',
  },
]

export const SMARTGIFT_POLICIES = [
  {
    id: 'policy:sg-sample-mockup',
    type: 'Policy',
    title: 'นโยบายการขึ้นตัวอย่างและการทำ Digital Proof (Sample & Mockup)',
    text: 'SmartGift บริการทำ Digital Mockup วางโลโก้บนสินค้าให้ลูกค้าตรวจสอบฟรีภายใน 24 ชม. หลังจากสรุปแบบแล้ว สามารถผลิตตัวอย่างจริง (Physical Sample) ได้โดยมีระยะเวลา 3-5 วันทำการก่อนเริ่มผลิตล็อตจริง',
  },
  {
    id: 'policy:sg-payment-terms',
    type: 'Policy',
    title: 'เงื่อนไขการชำระเงินและเครดิตเทอม (Payment Terms)',
    text: 'สำหรับการสั่งผลิตทั่วไป: ชำระมัดจำ 50% เมื่อยืนยันการสั่งผลิต และชำระส่วนที่เหลือ 50% ก่อนหรือในวันส่งมอบสินค้า สำหรับลูกค้านิติบุคคล/องค์กรขนาดใหญ่ สามารถพิจารณาเครดิตเทอม 30 วันได้หลังผ่านการตรวจสอบเอกสาร',
  },
  {
    id: 'policy:sg-shipping-delivery',
    type: 'Policy',
    title: 'เงื่อนไขการจัดส่งสินค้า (Delivery & Shipping)',
    text: 'บริการจัดส่งฟรีทั่วพื้นที่กรุงเทพฯ และปริมณฑล สำหรับยอดสั่งซื้อตั้งแต่ 10,000 บาทขึ้นไป สำหรับต่างจังหวัดจัดส่งผ่านขนส่งเอกชนควบคุมคุณภาพ (ค่าบริการตามระยะทางจริง) พร้อมรับประกันความเสียหายจากการขนส่ง 100%',
  },
  {
    id: 'policy:sg-urgent-orders',
    type: 'Policy',
    title: 'บริการงานด่วนพิเศษ (Express Production)',
    text: 'กรณีต้องการสินค้าด่วนภายใน 3-5 วันทำการ SmartGift มีบริการ Fast-Track สต็อกสินค้าพร้อมสกรีนด่วน โดยจะมีค่าบริการจัดการงานด่วนเพิ่มเติม 10-15% ขึ้นอยู่กับจำนวนและรูปแบบงานพิมพ์',
  },
]
