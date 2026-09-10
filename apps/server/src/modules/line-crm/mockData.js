// LineCRM-MCP Comprehensive Seed & Mock Data
// @req FR-091, FR-146, FR-151, FR-152, FR-153
// @spec SDD-050, ADR-060, ADR-061

export const INITIAL_STATS = {
  totalMembers: 2458,
  membersGrowth: 12.4,
  newFollowersToday: 128,
  followersGrowth: 18.7,
  messagesToday: 1124,
  messagesGrowth: 9.6,
  totalPoints: 78650,
  pointsGrowth: 6.2,
  activeCampaigns: 7,
  aiTasksToday: 32,
  aiTasksPending: 12,
  webhookSuccessRate: 94.3,
  webhookTotal: 3726,
  webhookSuccess: 3512,
  webhookFail: 142,
  webhookPending: 72,
  pushQuotaUsed: 12458,
  pushQuotaTotal: 30000,
  broadcastOpenRate: 62.9,
  broadcastClickRate: 10.1,
  broadcastConversionRate: 2.61,
  broadcastConversionCount: 325,
}

export const TIERS = {
  bronze: { name: 'Bronze', count: 1245, percentage: 50.6, avgPoints: 68, color: '#CD7F32', bg: '#FFF5EB' },
  silver: { name: 'Silver', count: 768, percentage: 31.2, avgPoints: 356, color: '#64748B', bg: '#F1F5F9' },
  gold: { name: 'Gold', count: 328, percentage: 13.3, avgPoints: 1245, color: '#D97706', bg: '#FEF3C7' },
  platinum: { name: 'Platinum', count: 117, percentage: 4.9, avgPoints: 3865, color: '#0284C7', bg: '#E0F2FE' },
}

export const TOP_ACTIVE_USERS = [
  { id: '1', name: 'คุณบีม', tier: 'VIP', messages: 48, points: 1250, avatar: 'บีม', color: 'bg-purple-600' },
  { id: '2', name: 'Krittapong P.', tier: 'Gold', messages: 32, points: 860, avatar: 'KP', color: 'bg-amber-600' },
  { id: '3', name: 'Nattaya S.', tier: 'Silver', messages: 28, points: 620, avatar: 'NS', color: 'bg-slate-600' },
  { id: '4', name: 'Pimchanok R.', tier: 'Bronze', messages: 24, points: 410, avatar: 'PR', color: 'bg-orange-700' },
]

export const CHAT_CONVERSATIONS = [
  {
    id: 'conv-1',
    name: 'Nataya S.',
    lineUserId: 'U27f599...e258a',
    tier: 'Silver',
    avatar: 'NS',
    avatarBg: 'bg-slate-600',
    status: 'online',
    unread: 2,
    time: '14:25',
    lastMessage: 'สนใจสมัครแพ็กเกจ Pro Plan ค่ะ',
    phone: '061-xxx-xxxx',
    email: 'nataya.s@example.com',
    lineHandle: '@nataya.s',
    points: 1124,
    pointsValue: '฿1,124 บาท',
    totalSpent: '฿8,650',
    orderCount: 12,
    tags: ['VIP', 'สนใจสินค้า: CRM', 'ใช้งานประจำ', 'ตอบไลน์บ่อย'],
    category: 'inbox',
    messages: [
      { id: 'm1', sender: 'customer', text: 'สวัสดีค่ะ สนใจสมัครแพ็กเกจ Pro Plan ค่ะ อยากทราบว่าราคาต่อเดือนเท่าไหร่ และมีเงื่อนไขอย่างไรบ้างคะ', time: '14:23' },
      { id: 'm2', sender: 'agent', text: 'สวัสดีครับคุณ Nataya 👋\nแพ็กเกจ Pro Plan ราคา 1,490 บาท/เดือน หรือ 14,900 บาท/ปี (ประหยัด 17%) สิทธิประโยชน์หลัก ๆ มีดังนี้ค่ะ', time: '14:24', status: 'read' },
      {
        id: 'm3',
        sender: 'agent',
        type: 'flex',
        flexData: {
          title: 'แพ็กเกจ Pro Plan',
          features: [
            'สมาชิกไม่จำกัด',
            'ระบบ CRM & Automation ครบทุกฟีเจอร์',
            'AI MCP Assist ช่วยตอบแชท & แนะนำลูกค้า',
            'แดชบอร์ดวิเคราะห์ข้อมูลขั้นสูง',
            'API Calls 10,000 ครั้ง/เดือน'
          ]
        },
        time: '14:24',
        status: 'read'
      },
      { id: 'm4', sender: 'customer', text: 'ถ้าสมัครรายปี มีส่วนลดพิเศษไหมคะ', time: '14:25' },
      { id: 'm5', sender: 'agent', text: 'สมัครรายปีได้รับส่วนลด 17% ครับ เหลือเพียง 14,900 บาท จากปกติ 17,880 บาทครับ 🎉', time: '14:25', status: 'read' },
      {
        id: 'm6',
        sender: 'agent',
        type: 'file',
        filename: 'Pro_Plan_Overview.pdf',
        filesize: '1.2 MB',
        time: '14:25',
        status: 'read'
      }
    ],
    activities: [
      { id: 'a1', title: 'สั่งซื้อแพ็กเกจ Pro Plan', meta: '1 ก.ค. 2569 10:15', value: '฿14,900', type: 'order' },
      { id: 'a2', title: 'สะสมแต้ม', meta: '31 ส.ค. 2569 18:22', value: '+250', type: 'points_add' },
      { id: 'a3', title: 'แลกของรางวัล', meta: '28 ส.ค. 2569 16:05', value: '-450', type: 'points_redeem' },
      { id: 'a4', title: 'เปิดแคมเปญ', meta: '27 ส.ค. 2569 09:42', value: 'ดูโปร', type: 'campaign' },
    ]
  },
  {
    id: 'conv-2',
    name: 'Krittapong P.',
    lineUserId: 'U88a102...f411b',
    tier: 'Gold',
    avatar: 'KP',
    avatarBg: 'bg-amber-600',
    status: 'online',
    unread: 1,
    time: '14:21',
    lastMessage: 'ขอใบเสร็จรับเงินย้อนหลังครับ',
    phone: '089-xxx-xxxx',
    email: 'krittapong.p@example.com',
    lineHandle: '@krittapong',
    points: 860,
    pointsValue: '฿860 บาท',
    totalSpent: '฿12,400',
    orderCount: 18,
    tags: ['Gold Member', 'B2B Client'],
    category: 'inbox',
    messages: [
      { id: 'kp1', sender: 'customer', text: 'ขอใบเสร็จรับเงินย้อนหลังเดือนที่แล้วครับ เลขที่คำสั่งซื้อ ORD-2569-0893', time: '14:21' }
    ],
    activities: []
  },
  {
    id: 'conv-3',
    name: 'Pimchanok R.',
    lineUserId: 'U33c914...d299c',
    tier: 'Bronze',
    avatar: 'PR',
    avatarBg: 'bg-orange-700',
    status: 'offline',
    unread: 1,
    time: '14:12',
    lastMessage: 'เปลี่ยนเบอร์โทรศัพท์ใหม่ค่ะ',
    phone: '092-xxx-xxxx',
    email: 'pimchanok@example.com',
    lineHandle: '@pim_r',
    points: 410,
    pointsValue: '฿410 บาท',
    totalSpent: '฿3,200',
    orderCount: 4,
    tags: ['Bronze Member'],
    category: 'pending',
    messages: [
      { id: 'pr1', sender: 'customer', text: 'แจ้งเปลี่ยนเบอร์โทรศัพท์ใหม่ค่ะ จากเดิม 081 เป็น 092 ค่ะ', time: '14:12' }
    ],
    activities: []
  },
  {
    id: 'conv-4',
    name: 'Anan K.',
    lineUserId: 'U44d188...a991e',
    tier: 'Silver',
    avatar: 'AK',
    avatarBg: 'bg-slate-600',
    status: 'offline',
    unread: 0,
    time: '13:58',
    lastMessage: 'สอบถามวิธีแลกของรางวัลครับ',
    phone: '084-xxx-xxxx',
    email: 'anan.k@example.com',
    lineHandle: '@anan_k',
    points: 768,
    pointsValue: '฿768 บาท',
    totalSpent: '฿5,800',
    orderCount: 7,
    tags: ['Silver Member', 'รอของรางวัล'],
    category: 'followup',
    messages: [
      { id: 'ak1', sender: 'customer', text: 'สอบถามวิธีแลกของรางวัลในเมนู Member Portal ครับ', time: '13:58' }
    ],
    activities: []
  },
  {
    id: 'conv-5',
    name: 'Sudarat M.',
    lineUserId: 'U55e201...b882f',
    tier: 'Gold',
    avatar: 'SM',
    avatarBg: 'bg-amber-600',
    status: 'online',
    unread: 2,
    time: '13:45',
    lastMessage: 'คะแนนไม่ขึ้น ต้องทำยังไงคะ',
    phone: '086-xxx-xxxx',
    email: 'sudarat.m@example.com',
    lineHandle: '@sudarat_m',
    points: 1350,
    pointsValue: '฿1,350 บาท',
    totalSpent: '฿15,200',
    orderCount: 22,
    tags: ['Gold Member', 'High Value'],
    category: 'inbox',
    messages: [
      { id: 'sm1', sender: 'customer', text: 'ซื้อของแล้วคะแนนไม่ขึ้นค่ะ ต้องทำยังไงคะ', time: '13:45' }
    ],
    activities: []
  },
  {
    id: 'conv-6',
    name: 'Worapong T.',
    lineUserId: 'U66f332...c773a',
    tier: 'Silver',
    avatar: 'WT',
    avatarBg: 'bg-slate-600',
    status: 'offline',
    unread: 0,
    time: '13:30',
    lastMessage: 'ขอรายละเอียดแพ็กเกจหน่อยครับ',
    phone: '083-xxx-xxxx',
    email: 'worapong@example.com',
    lineHandle: '@worapong',
    points: 520,
    pointsValue: '฿520 บาท',
    totalSpent: '฿4,100',
    orderCount: 5,
    tags: ['Silver Member'],
    category: 'closed',
    messages: [
      { id: 'wt1', sender: 'customer', text: 'ขอรายละเอียดแพ็กเกจหน่อยครับ', time: '13:30' }
    ],
    activities: []
  },
]

export const LOYALTY_RULES = [
  { id: 'rule-1', name: 'ซื้อสินค้า', desc: 'ทุก 25 บาท = 1 แต้ม', icon: 'ShoppingCart', enabled: true },
  { id: 'rule-2', name: 'โบนัสวันเกิด', desc: '+500 แต้ม/ปี', icon: 'Gift', enabled: true },
  { id: 'rule-3', name: 'รีวิวสินค้า', desc: '+50 แต้ม/รีวิว', icon: 'Star', enabled: true },
  { id: 'rule-4', name: 'แนะนำเพื่อน', desc: '+100 แต้ม/คน (ปิดอยู่)', icon: 'Users', enabled: false },
]

export const REWARDS = [
  { id: 'rew-1', name: 'ส่วนลด ฿100', points: 500, redeemed: 342, icon: 'Tag', color: 'bg-amber-100 text-amber-600' },
  { id: 'rew-2', name: 'เสื้อยืดพรีเมียม', points: 1200, redeemed: 87, icon: 'Shirt', color: 'bg-emerald-100 text-emerald-600' },
  { id: 'rew-3', name: 'บัตรกาแฟ ฿150', points: 700, redeemed: 213, icon: 'Coffee', color: 'bg-purple-100 text-purple-600' },
  { id: 'rew-4', name: 'ฟรีค่าจัดส่ง', points: 300, redeemed: 521, icon: 'Gift', color: 'bg-rose-100 text-rose-600' },
]

export const POINT_TRANSACTIONS = [
  { id: 'pt-1', member: 'กิตติพงศ์ ป.', tier: 'VIP', type: 'received', desc: 'ซื้อสินค้า ORD-2569-0893', points: '+250', balance: '1,245', time: '11 ส.ค. 2569 10:15' },
  { id: 'pt-2', member: 'ณัฐชยาน์ ส.', tier: 'Silver', type: 'redeemed', desc: 'แลกส่วนลด ฿100', points: '-450', balance: '328', time: '11 ส.ค. 2569 09:42' },
  { id: 'pt-3', member: 'พิมพัชรน จ.', tier: 'VIP', type: 'received', desc: 'โบนัสวันเกิด', points: '+500', balance: '3,865', time: '10 ส.ค. 2569 00:00' },
  { id: 'pt-4', member: 'ธนวัฒน์ ค.', tier: 'Bronze', type: 'received', desc: 'รีวิวสินค้า', points: '+50', balance: '768', time: '10 ส.ค. 2569 14:20' },
  { id: 'pt-5', member: 'อริสรา พ.', tier: 'VIP', type: 'redeemed', desc: 'แลกของรางวัล: เสื้อยืด', points: '-1,200', balance: '2,450', time: '9 ส.ค. 2569 16:08' },
  { id: 'pt-6', member: 'ชนิตา ท.', tier: 'Bronze', type: 'received', desc: 'แนะนำเพื่อน', points: '+100', balance: '512', time: '9 ส.ค. 2569 11:00' },
]

export const CAMPAIGNS = [
  { id: 'c-1', name: 'โปรโมชั่นเดือนสิงหาคม', format: 'Flex Message · รูปภาพ', status: 'sending', statusText: 'กำลังส่ง', target: 'สมาชิก VIP + Gold', sent: '2,458', opened: '1,842 (74.9%)', clicked: '356 (14.5%)', scheduled: '11 ส.ค. 2569 09:00' },
  { id: 'c-2', name: 'แจ้งเตือนแต้มใกล้หมดอายุ', format: 'ข้อความ', status: 'scheduled', statusText: 'ตั้งเวลา', target: 'แต้ม > 500', sent: '-', opened: '-', clicked: '-', scheduled: '15 ส.ค. 2569 10:00' },
  { id: 'c-3', name: 'สินค้าใหม่มาแล้ว', format: 'Carousel', status: 'completed', statusText: 'เสร็จสิ้น', target: 'ทั้งหมด', sent: '2,458', opened: '1,536 (62.5%)', clicked: '289 (11.8%)', scheduled: '5 ส.ค. 2569 14:00' },
  { id: 'c-4', name: 'อวยพรวันเกิด (อัตโนมัติ)', format: 'Flex Message', status: 'sending', statusText: 'กำลังส่ง', target: 'วันเกิดเดือนนี้', sent: '128', opened: '112 (87.5%)', clicked: '45 (35.2%)', scheduled: 'ทุกวัน 08:00' },
  { id: 'c-5', name: 'แบบสอบถามความพึงพอใจ', format: 'ข้อความ + ปุ่ม', status: 'draft', statusText: 'ร่าง', target: 'ซื้อใน 30 วัน', sent: '-', opened: '-', clicked: '-', scheduled: 'ยังไม่กำหนด' },
]

export const AUTOMATION_FLOWS = [
  {
    id: 'flow-1',
    name: 'ต้อนรับสมาชิกใหม่',
    runsToday: 128,
    steps: ['Follow OA', 'ส่งข้อความต้อนรับ', 'ติดแท็ก New', '+50 แต้ม'],
    enabled: true,
    icon: 'Sparkles',
    iconColor: 'bg-amber-100 text-amber-600'
  },
  {
    id: 'flow-2',
    name: 'ยืนยันคำสั่งซื้อ',
    runsToday: 342,
    steps: ['สร้างออเดอร์', 'Flex ใบสั่งซื้อ', 'ให้แต้มตามยอด'],
    enabled: true,
    icon: 'ShoppingCart',
    iconColor: 'bg-purple-100 text-purple-600'
  },
  {
    id: 'flow-3',
    name: 'ดึงลูกค้าที่หายไป (Win-back)',
    runsToday: 24,
    steps: ['ไม่ซื้อ 60 วัน', 'ส่งคูปองส่วนลด', 'ติดแท็ก Win-back'],
    enabled: true,
    icon: 'Zap',
    iconColor: 'bg-blue-100 text-blue-600'
  },
  {
    id: 'flow-4',
    name: 'แบบสอบถามหลังบริการ',
    runsToday: 0,
    steps: ['ปิดเคส 1 ชม.', 'ส่งแบบสอบถาม'],
    enabled: false,
    icon: 'FileText',
    iconColor: 'bg-slate-100 text-slate-600'
  }
]

export const MCP_TOOLS = [
  { id: 't1', name: 'crm.lookup_member', desc: 'ดึงข้อมูลสมาชิก 360°', enabled: true, icon: 'Users' },
  { id: 't2', name: 'loyalty.get_points', desc: 'เช็ค/ปรับแต้มสมาชิก', enabled: true, icon: 'Star' },
  { id: 't3', name: 'line.push_message', desc: 'ส่งข้อความผ่าน LINE OA', enabled: true, icon: 'MessageSquare' },
  { id: 't4', name: 'order.get_status', desc: 'ตรวจสถานะคำสั่งซื้อ', enabled: true, icon: 'ShoppingBag' },
  { id: 't5', name: 'crm.add_tag', desc: 'ติดแท็กอัตโนมัติ', enabled: true, icon: 'Tag' },
  { id: 't6', name: 'reward.redeem', desc: 'แลกของรางวัล · ปิดอยู่', enabled: false, icon: 'Gift' },
]

export const AI_TASK_QUEUE = [
  { id: 'task-1', name: 'สรุปบทสนทนา', target: 'แชท Nataya S. · เริ่ม 14:25', status: 'running', statusText: 'กำลังทำ' },
  { id: 'task-2', name: 'แนะนำสินค้าที่ใช่', target: 'Krittapong P. · 3 รายการ', status: 'queued', statusText: 'รอคิว' },
  { id: 'task-3', name: 'วิเคราะห์ความรู้สึก', target: 'ผลลัพธ์: เชิงบวก 😊', status: 'completed', statusText: 'เสร็จ' },
  { id: 'task-4', name: 'จัดหมวดหมู่ tickets', target: 'จัด 24 รายการ', status: 'completed', statusText: 'เสร็จ' },
]

export const AUDIT_LOGS = [
  { id: 'log-1', time: '11 ส.ค. 2569 14:25:31', user: 'Admin Demo (Owner)', action: 'UPDATE', actionColor: 'bg-blue-100 text-blue-700', details: 'ปรับแต้มสมาชิก CUST-0001 +250', ip: '202.28.xx.14', status: 'สำเร็จ', statusColor: 'bg-emerald-100 text-emerald-700' },
  { id: 'log-2', time: '11 ส.ค. 2569 14:18:02', user: 'สมหญิง (Agent)', action: 'CREATE', actionColor: 'bg-emerald-100 text-emerald-700', details: 'สร้างคำสั่งซื้อ ORD-2569-0893', ip: '202.28.xx.51', status: 'สำเร็จ', statusColor: 'bg-emerald-100 text-emerald-700' },
  { id: 'log-3', time: '11 ส.ค. 2569 13:55:44', user: 'Admin Demo (Owner)', action: 'EXPORT', actionColor: 'bg-amber-100 text-amber-700', details: 'ส่งออกข้อมูลสมาชิก 2,458 รายการ', ip: '202.28.xx.14', status: 'สำเร็จ', statusColor: 'bg-emerald-100 text-emerald-700' },
  { id: 'log-4', time: '11 ส.ค. 2569 13:30:10', user: 'unknown', action: 'LOGIN', actionColor: 'bg-purple-100 text-purple-700', details: 'พยายามเข้าสู่ระบบ user admin', ip: '45.155.xx.203', status: 'ล้มเหลว ×3', statusColor: 'bg-rose-100 text-rose-700' },
  { id: 'log-5', time: '11 ส.ค. 2569 12:40:18', user: 'วิชัย (Manager)', action: 'DELETE', actionColor: 'bg-rose-100 text-rose-700', details: 'ลบแท็ก promo-old', ip: '202.28.xx.77', status: 'สำเร็จ', statusColor: 'bg-emerald-100 text-emerald-700' },
  { id: 'log-6', time: '11 ส.ค. 2569 11:20:05', user: 'สมหญิง (Agent)', action: 'UPDATE', actionColor: 'bg-blue-100 text-blue-700', details: 'แก้ไขเบอร์โทร CUST-0004', ip: '202.28.xx.51', status: 'สำเร็จ', statusColor: 'bg-emerald-100 text-emerald-700' },
  { id: 'log-7', time: '11 ส.ค. 2569 09:02:47', user: 'Admin Demo (Owner)', action: 'LOGIN', actionColor: 'bg-purple-100 text-purple-700', details: 'เข้าสู่ระบบสำเร็จ (2FA)', ip: '202.28.xx.14', status: 'สำเร็จ', statusColor: 'bg-emerald-100 text-emerald-700' },
]

export const CRM_MEMBERS_DIRECTORY = [
  { id: 'CUST-0001', name: 'กิตติพงศ์ ปราชญ์เมธี', lineUserId: 'U88a102...f411b', tier: 'Gold', points: 1245, spent: '฿18,900', orders: 24, phone: '089-123-4567', tags: ['VIP', 'B2B Client'], lastActive: '11 ส.ค. 2569 10:15', status: 'Active' },
  { id: 'CUST-0002', name: 'ณัฐชยาน์ สุวรรณรัตน์', lineUserId: 'U27f599...e258a', tier: 'Silver', points: 328, spent: '฿8,650', orders: 12, phone: '061-234-5678', tags: ['VIP', 'สนใจ CRM'], lastActive: '11 ส.ค. 2569 14:25', status: 'Active' },
  { id: 'CUST-0003', name: 'พิมพัชรน เจริญกิจ', lineUserId: 'U33c914...d299c', tier: 'Platinum', points: 3865, spent: '฿45,200', orders: 58, phone: '081-345-6789', tags: ['Top Spender', 'VIP Platinum'], lastActive: '10 ส.ค. 2569 18:40', status: 'Active' },
  { id: 'CUST-0004', name: 'ธนวัฒน์ คำดี', lineUserId: 'U44d188...a991e', tier: 'Bronze', points: 768, spent: '฿3,400', orders: 5, phone: '092-456-7890', tags: ['New Member'], lastActive: '10 ส.ค. 2569 14:20', status: 'Active' },
  { id: 'CUST-0005', name: 'อริสรา พัฒนพงษ์', lineUserId: 'U55e201...b882f', tier: 'Gold', points: 2450, spent: '฿22,100', orders: 31, phone: '086-567-8901', tags: ['High Value', 'Loyal'], lastActive: '9 ส.ค. 2569 16:08', status: 'Active' },
  { id: 'CUST-0006', name: 'ชนิตา ทรงศักดิ์', lineUserId: 'U66f332...c773a', tier: 'Bronze', points: 512, spent: '฿1,800', orders: 3, phone: '084-678-9012', tags: ['Referral'], lastActive: '9 ส.ค. 2569 11:00', status: 'Inactive' },
]
