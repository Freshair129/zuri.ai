// @req FR-146, FR-151, FR-152, FR-153 — LINE Studio Enterprise Presets & Schemas
// @spec SDD-060, SDD-061 — Official Node Types, Layouts & Template Specifications

export const MOCK_FLOW_NODE_TYPES = [
  { id: "start", name: "เริ่มต้น", icon: "play", color: "text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700" },
  { id: "message", name: "ข้อความ", icon: "message-square", color: "text-blue-500 bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700" },
  { id: "quick_reply", name: "Quick Reply", icon: "zap", color: "text-purple-500 bg-purple-50 dark:bg-purple-950/40 border-purple-300 dark:border-purple-700" },
  { id: "flex", name: "Flex", icon: "layout-template", color: "text-orange-500 bg-orange-50 dark:bg-orange-950/40 border-orange-300 dark:border-orange-700" },
  { id: "condition", name: "เงื่อนไข", icon: "git-branch", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700" },
  { id: "liff", name: "LIFF", icon: "globe", color: "text-cyan-500 bg-cyan-50 dark:bg-cyan-950/40 border-cyan-300 dark:border-cyan-700" },
  { id: "push", name: "Push", icon: "send", color: "text-rose-500 bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700" },
  { id: "api_call", name: "API Call", icon: "terminal", color: "text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700" },
  { id: "variable", name: "Variable", icon: "file-code", color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700" },
  { id: "wait", name: "Wait", icon: "clock", color: "text-slate-500 bg-slate-50 dark:bg-slate-950/40 border-slate-300 dark:border-slate-700" },
  { id: "end", name: "จบ", icon: "square", color: "text-red-500 bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700" }
];

export const MOCK_INITIAL_FLOW = {
  id: "flow-new-001",
  name: "Conversation Flow",
  nodes: [
    {
      id: "node-1",
      type: "start",
      title: "START",
      subtitle: "Follow Event",
      x: 180,
      y: 220,
      config: { trigger: "follow_event" }
    },
    {
      id: "node-2",
      type: "message",
      title: "MESSAGE",
      subtitle: "ยินดีต้อนรับ",
      x: 520,
      y: 220,
      config: {
        text: "ยินดีต้อนรับสู่ LINE Official Account ครับ! สอบถามข้อมูลเพิ่มเติมหรือกดเมนูด้านล่างได้เลยครับ 🎉"
      }
    }
  ],
  edges: [
    { id: "e1-2", from: "node-1", to: "node-2" }
  ]
};

export const MOCK_FLEX_TEMPLATES = [
  {
    id: "hero-card",
    name: "Hero Card",
    category: "welcome",
    type: "bubble",
    title: "LINE STUDIO",
    subtitle: "Design your LINE OA with Studio",
    heroImage: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80",
    primaryButtonText: "เปิดเว็บ",
    primaryButtonUrl: "https://zuri.ai",
    themeColor: "#06C755",
    json: {
      type: "bubble",
      hero: {
        type: "image",
        url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80",
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "LINE STUDIO",
            weight: "bold",
            size: "xl",
            color: "#06C755"
          },
          {
            type: "text",
            text: "Design your LINE OA with Studio",
            size: "sm",
            color: "#888888",
            margin: "md"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: {
              type: "uri",
              label: "เปิดเว็บ",
              uri: "https://zuri.ai"
            }
          }
        ]
      }
    }
  },
  {
    id: "product-card",
    name: "Product Card",
    category: "e-commerce",
    type: "bubble",
    title: "สินค้าแนะนำ",
    price: "฿ 599",
    subtitle: "สินค้าคุณภาพดี จัดส่งรวดเร็ว",
    heroImage: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
    button1Text: "สอบถาม",
    button2Text: "สั่งซื้อ",
    themeColor: "#06C755",
    json: {
      type: "bubble",
      hero: {
        type: "image",
        url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "สินค้าแนะนำ",
            weight: "bold",
            size: "xl"
          },
          {
            type: "text",
            text: "฿ 599",
            weight: "bold",
            size: "lg",
            color: "#06C755",
            margin: "sm"
          },
          {
            type: "text",
            text: "สินค้าคุณภาพดี จัดส่งรวดเร็ว",
            size: "xs",
            color: "#aaaaaa",
            margin: "sm"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "secondary",
            action: {
              type: "message",
              label: "สอบถาม",
              text: "สนใจสินค้าชิ้นนี้ครับ"
            }
          },
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: {
              type: "uri",
              label: "สั่งซื้อ",
              uri: "https://zuri.ai"
            }
          }
        ]
      }
    }
  },
  {
    id: "order-status",
    name: "Order Status",
    category: "e-commerce",
    type: "bubble",
    title: "สถานะออเดอร์",
    subtitle: "กำลังจัดส่งพัสดุ",
    trackingNumber: "TH8829102938",
    price: "฿ 1,250",
    themeColor: "#E8820C",
    json: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "สถานะออเดอร์",
            weight: "bold",
            size: "lg",
            color: "#E8820C"
          },
          {
            type: "text",
            text: "กำลังจัดส่งพัสดุ",
            size: "sm",
            color: "#06C755",
            margin: "sm",
            weight: "bold"
          },
          {
            type: "separator",
            margin: "md"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            spacing: "sm",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "เลขพัสดุ", size: "sm", color: "#888888" },
                  { type: "text", text: "TH8829102938", size: "sm", align: "end", weight: "bold" }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "ยอดชำระ", size: "sm", color: "#888888" },
                  { type: "text", text: "฿ 1,250", size: "sm", align: "end", color: "#06C755", weight: "bold" }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#E8820C",
            action: {
              type: "uri",
              label: "ติดตามพัสดุแบบเรียลไทม์",
              uri: "https://zuri.ai"
            }
          }
        ]
      }
    }
  }
];

export const MOCK_TEMPLATE_LIBRARY = [
  {
    id: "tpl-1",
    name: "Welcome Flow - Basic",
    category: "welcome",
    type: "flow",
    typeIcon: "zap",
    typeColor: "text-amber-500 bg-amber-500/10",
    isOfficial: true,
    description: "general · flow",
    usageCount: 0,
    tags: ["welcome", "general"]
  },
  {
    id: "tpl-2",
    name: "Order Status Card",
    category: "e-commerce",
    type: "flex",
    typeIcon: "layout-template",
    typeColor: "text-blue-500 bg-blue-500/10",
    isOfficial: true,
    description: "e-commerce · flex",
    usageCount: 0,
    tags: ["e-commerce", "tracking"]
  },
  {
    id: "tpl-3",
    name: "Emergency Report Flow",
    category: "emergency",
    type: "flow",
    typeIcon: "zap",
    typeColor: "text-rose-500 bg-rose-500/10",
    isOfficial: true,
    description: "government · flow",
    usageCount: 0,
    tags: ["emergency", "sos"]
  },
  {
    id: "tpl-4",
    name: "Appointment Booking",
    category: "healthcare",
    type: "flow",
    typeIcon: "zap",
    typeColor: "text-teal-500 bg-teal-500/10",
    isOfficial: true,
    description: "healthcare · flow",
    usageCount: 0,
    tags: ["healthcare", "booking"]
  },
  {
    id: "tpl-5",
    name: "Restaurant Rich Menu",
    category: "restaurant",
    type: "richmenu",
    typeIcon: "smartphone",
    typeColor: "text-orange-500 bg-orange-500/10",
    isOfficial: true,
    description: "restaurant · richmenu",
    usageCount: 0,
    tags: ["restaurant", "menu"]
  }
];
