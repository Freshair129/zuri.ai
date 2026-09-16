// @req FR-252 — immutable reviewed source defaults, imported as a fresh canonical document.
// @spec ADR-097
// @tested tests/unit/pricing-engine.test.js
// Source: SmartGift config/pricing_rules_formula.yaml; infinities serialize as null unbounded tiers.
export const SOURCE_SHA256 = "fe511dccfaae6c02fe48d6f830aa7632824823efa4dbfde68a0cb848ca081538"
export const SOURCE_RULES = {
  "version": "2026.09.11-v4",
  "contract_reference": "smartgift://b2b/pricing-rules-formula/v1",
  "last_updated": "2026-09-10T00:00:00+07:00",
  "updated_by": "zuri_ai_pricing_control_plane",
  "tenant_id": "Org-EtohGroup",
  "business_id": "SmartGift",
  "vault_id": "vlt-catalog-product",
  "currency_exchange_rates": {
    "cny_to_thb": 5,
    "usd_to_thb": 34
  },
  "logistics_density_and_freight": {
    "density_threshold_kg_per_cbm": 400,
    "min_chargeable_cbm": 0.01,
    "sea_threshold_cbm": 5,
    "seasonality_peak_months": [
      9,
      10,
      11,
      12,
      1
    ],
    "auto_force_truck_in_peak": true,
    "inland_china_freight": {
      "implemented_basis": "per_set",
      "default_rate_cny_per_set": 2,
      "rate_cny_per_cbm": 150,
      "min_charge_cny": 50
    }
  },
  "price_rounding": {
    "ladder_price_step_thb": 10
  },
  "profit_floors_thb": {
    "small_order_floor": 5000,
    "standard_floor": 3000
  },
  "profit_floors": [
    {
      "max_qty": 20,
      "thb": 5000
    },
    {
      "max_qty": null,
      "thb": 3000
    }
  ],
  "profit_floors_by_kind": {
    "set": [
      {
        "min_qty": 100,
        "thb": 20000
      }
    ],
    "single": [
      {
        "min_qty": 50,
        "thb": 3000
      }
    ]
  },
  "small_order_factors": [
    {
      "max_qty": 20,
      "sof": 1.5
    },
    {
      "max_qty": 50,
      "sof": 1.4
    },
    {
      "max_qty": 100,
      "sof": 1.3
    },
    {
      "max_qty": 300,
      "sof": 1.2
    },
    {
      "max_qty": 499,
      "sof": 1.1
    },
    {
      "max_qty": null,
      "sof": 1
    }
  ],
  "markup_bands_standard": [
    {
      "max_cost_thb": 250,
      "markup_multiplier": 3
    },
    {
      "max_cost_thb": 350,
      "markup_multiplier": 2.73
    },
    {
      "max_cost_thb": 500,
      "markup_multiplier": 2.62
    },
    {
      "max_cost_thb": 650,
      "markup_multiplier": 2.45
    },
    {
      "max_cost_thb": null,
      "markup_multiplier": 2.14
    }
  ],
  "standard_quote_profile": {
    "name": "ทั่วไป",
    "basis": "factory",
    "anchor_qty": 500,
    "breaks": [
      10,
      20,
      50,
      100,
      300,
      500,
      1000
    ],
    "factors": [
      1,
      0.9,
      0.85,
      0.8,
      0.77,
      0.75,
      0.73
    ],
    "markup_source": "markup_bands_standard",
    "note": "บริษัทเล็ก · freelance ตัวแทนประกัน · นายหน้า"
  },
  "corporate_quote_profile": {
    "name": "องค์กร",
    "basis": "landed",
    "flat_markup": 1.47,
    "anchor_qty": 1000,
    "breaks": [
      100,
      300,
      500,
      1000
    ],
    "factors": [
      0.8,
      0.77,
      0.75,
      0.73
    ],
    "reference_goods_type": "electronic_tisi",
    "note": "รัฐวิสาหกิจ · กสทช. · ไทยคม",
    "package_profit_guardrails": {
      "min_package_profit_thb": 20000,
      "target_package_profit_thb": 30000
    }
  },
  "logo_methods": {
    "flat": {
      "unit": "thb_per_position_per_piece",
      "default_rate_thb": 10
    },
    "hotstamp": {
      "unit": "usd_per_position",
      "setup_usd": 11.3,
      "per_piece_over_100_usd": [
        {
          "max_qty": 100,
          "usd": 0
        },
        {
          "max_qty": 499,
          "usd": 0.081
        },
        {
          "max_qty": 999,
          "usd": 0.065
        },
        {
          "max_qty": null,
          "usd": 0.048
        }
      ]
    },
    "hotstamp_text": {
      "unit": "usd_per_position",
      "flat_usd": 4.84
    },
    "engrave": {
      "unit": "usd_per_piece_per_position",
      "per_piece_usd": [
        {
          "max_qty": 9,
          "usd": 0.17
        },
        {
          "max_qty": 99,
          "usd": 0.081
        },
        {
          "max_qty": 299,
          "usd": 0.05
        },
        {
          "max_qty": 499,
          "usd": 0.035
        },
        {
          "max_qty": null,
          "usd": 0.02
        }
      ]
    },
    "silk": {
      "unit": "usd_per_position_per_color",
      "flat_usd_up_to_qty": 350,
      "flat_usd": 13,
      "per_piece_usd_above": 0.04
    },
    "uv": {
      "unit": "usd_per_piece_per_position",
      "per_piece_usd": null
    },
    "none": {
      "unit": "none"
    }
  },
  "logo_positions_rule": {
    "pieces_from_code_last_digit": true,
    "extra_positions": 2,
    "min_positions": 1
  },
  "lead_time_working_days": {
    "artwork_confirm": {
      "min": 2,
      "max": 2
    },
    "sample": {
      "min": 3,
      "max": 5
    },
    "production": [
      {
        "max_qty": 500,
        "min": 7,
        "max": 7
      },
      {
        "max_qty": null,
        "min": 15,
        "max": 15
      }
    ],
    "freight": {
      "truck": {
        "min": 7,
        "max": 10
      },
      "sea": {
        "min": 21,
        "max": 30
      }
    }
  },
  "srp_benchmark_rules": {
    "srp_adder_thb": 1530,
    "median_category_margin_percent": 38,
    "moq_breaks": [
      10,
      20,
      50,
      100,
      300,
      500,
      1000
    ]
  },
  "shipping_rate_matrix": {
    "guangzhou_shenzhen": {
      "truck": {
        "general": {
          "ELITE": {
            "cbm": 5900,
            "kg": 15
          },
          "GOLD": {
            "cbm": 6400,
            "kg": 16
          },
          "SILVER": {
            "cbm": 6900,
            "kg": 18
          },
          "MEMBER": {
            "cbm": 7400,
            "kg": 19
          }
        },
        "electronic_tisi": {
          "ELITE": {
            "cbm": 6400,
            "kg": 16
          },
          "GOLD": {
            "cbm": 6900,
            "kg": 18
          },
          "SILVER": {
            "cbm": 7400,
            "kg": 19
          },
          "MEMBER": {
            "cbm": 7900,
            "kg": 20
          }
        }
      },
      "sea": {
        "general": {
          "ELITE": {
            "cbm": 3900,
            "kg": 10
          },
          "GOLD": {
            "cbm": 4400,
            "kg": 11
          },
          "SILVER": {
            "cbm": 4900,
            "kg": 13
          },
          "MEMBER": {
            "cbm": 5400,
            "kg": 14
          }
        },
        "electronic_tisi": {
          "ELITE": {
            "cbm": 4400,
            "kg": 11
          },
          "GOLD": {
            "cbm": 4900,
            "kg": 13
          },
          "SILVER": {
            "cbm": 5400,
            "kg": 14
          },
          "MEMBER": {
            "cbm": 5900,
            "kg": 15
          }
        }
      }
    },
    "yiwu": {
      "truck": {
        "general": {
          "ELITE": {
            "cbm": 6400,
            "kg": 16
          },
          "GOLD": {
            "cbm": 6900,
            "kg": 18
          },
          "SILVER": {
            "cbm": 7400,
            "kg": 19
          },
          "MEMBER": {
            "cbm": 7900,
            "kg": 20
          }
        },
        "electronic_tisi": {
          "ELITE": {
            "cbm": 6900,
            "kg": 18
          },
          "GOLD": {
            "cbm": 7400,
            "kg": 19
          },
          "SILVER": {
            "cbm": 7900,
            "kg": 20
          },
          "MEMBER": {
            "cbm": 8400,
            "kg": 21
          }
        }
      },
      "sea": {
        "general": {
          "ELITE": {
            "cbm": 3900,
            "kg": 10
          },
          "GOLD": {
            "cbm": 4400,
            "kg": 11
          },
          "SILVER": {
            "cbm": 4900,
            "kg": 13
          },
          "MEMBER": {
            "cbm": 5400,
            "kg": 14
          }
        },
        "electronic_tisi": {
          "ELITE": {
            "cbm": 4400,
            "kg": 11
          },
          "GOLD": {
            "cbm": 4900,
            "kg": 13
          },
          "SILVER": {
            "cbm": 5400,
            "kg": 14
          },
          "MEMBER": {
            "cbm": 5900,
            "kg": 15
          }
        }
      }
    }
  },
  "sources": {
    "shipping_rate_matrix": {
      "level": "file_only",
      "origin": "data-pipeline/01_raw/04_shipping_rates_cbm/LK-กวางโจว.jpg, LK-อี้อู.jpg",
      "confirmed_by": "docs/change-requests/CR-005-SHIPPING-RATE-MATRIX-AND-OMNICHANNEL-AGENT-CONNECTORS.md#2",
      "note": "lane 04 ยังไม่มี archiver จึงไม่มี version/SHA-256"
    },
    "logistics_density_and_freight": {
      "level": "file_only",
      "origin": "CR-005 §2 (density switch 400 kg/CBM)"
    },
    "small_order_factors": {
      "level": "undocumented",
      "origin": "ช่วง 1.1–1.5 จากข้อความในใบราคาโรงงาน lane 02",
      "note": "ตารางว่าจำนวนไหนได้ตัวคูณเท่าไรเป็นการสมมติ ยังไม่ยืนยันกับโรงงาน"
    },
    "markup_bands_standard": {
      "level": "undocumented",
      "note": "ค้นทั้งรีโปแล้วไม่พบใบราคา เอกสาร หรือบันทึกการตัดสินใจที่เป็นต้นทาง"
    },
    "profit_floors": {
      "level": "undocumented",
      "note": "ไม่พบเอกสารว่าใครกำหนดและเมื่อไหร่"
    },
    "profit_floors_by_kind": {
      "level": "owner_directive",
      "origin": "Boss ระบุด้วยวาจา 2026-09-11: เซ็ตจากโรงงาน 100 ชุด กำไรห้ามต่ำกว่า 20,000 · สินค้าเดี่ยว 50 ชิ้น กำไรไม่ต่ำกว่า 3,000",
      "note": "ยืนยันแล้วว่าเป็นยอดรวมต่อออเดอร์ (ไม่ใช่ต่อหน่วย) และเสริมของเดิมไม่ใช่แทนที่"
    },
    "standard_quote_profile": {
      "level": "code_only",
      "origin": "price-boss/pricing.html · src/cascade_engine/pricing_calculator.py",
      "note": "เพิ่มเข้าไฟล์นี้ครั้งแรกใน v2 เดิมไม่มีที่ใดนอกจากโค้ด"
    },
    "corporate_quote_profile": {
      "level": "registered",
      "origin": "config/pricing_rules_formula.yaml v1 (sha f4473230…)"
    },
    "logo_methods": {
      "level": "undocumented",
      "origin": "ใบราคาโรงงาน lane 02 (ยังไม่ระบุไฟล์และหน้า)",
      "note": "เพิ่มเข้าไฟล์นี้ครั้งแรกใน v2 · UV ไม่มีเรทประกาศจึงเป็น null"
    },
    "logo_positions_rule": {
      "level": "code_only",
      "origin": "คอมเมนต์ในโค้ด อ้างตัวอย่างของเจ้าของ: เซ็ต 7 ชิ้น สกรีน 9 จุด"
    },
    "lead_time_working_days": {
      "level": "code_only"
    },
    "currency_exchange_rates": {
      "level": "owner_directive",
      "origin": "Boss ชี้ขาด 2026-09-11 ให้ใช้ 34.00 — ตรงกับ SPEC-FULL-ENTERPRISE-SCHEMA-2026-09-10 §3 fx_rate_thb_per_usd",
      "note": "เดิม 32.50 ขัดกับ spec และชุดข้อมูลที่ validate แล้ว · เอนจินเดิมคำนวณ fx × 6.5 แทน ซึ่งตรงกันเฉพาะตอน fx = 5"
    }
  }
}
