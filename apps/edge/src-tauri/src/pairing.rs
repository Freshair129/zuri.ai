// @spec FR-144, SEC-025 — only Rust keeps the one-use polling secret and returned device key.
use crate::commands::EdgePairingConfig;
use qrcode::{render::svg, QrCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub fn validate_origin(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value.trim()).map_err(|_| "กรุณาระบุที่อยู่ Zuri ที่ถูกต้อง")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("ใช้ HTTPS ของ Zuri หรือ localhost สำหรับทดสอบ และไม่ใส่ path เพิ่มเติม".into());
    }
    Ok(url.origin().ascii_serialization())
}
fn field(value: &Value, names: &[&str], required: bool) -> Result<String, String> {
    let mut found: Option<String> = None;
    for name in names {
        if let Some(item) = value.get(*name) {
            let text = item.as_str().ok_or("รูปแบบไฟล์จับคู่ไม่ถูกต้อง")?.trim().to_owned();
            if found.as_ref().is_some_and(|old| old != &text) {
                return Err("ไฟล์มีข้อมูลจับคู่ขัดแย้งกัน".into());
            }
            found = Some(text);
        }
    }
    let result = found.unwrap_or_default();
    if required && result.is_empty() {
        return Err("ไฟล์จับคู่ขาดชื่อเครื่อง กุญแจ หรือที่อยู่ Zuri".into());
    }
    Ok(result)
}
pub fn parse_pairing(value: &Value) -> Result<EdgePairingConfig, String> {
    let device_id = field(value, &["deviceId", "device_id"], true)?;
    let device_key = field(value, &["key", "token", "device_key"], true)?;
    let cloud_base_url = validate_origin(&field(
        value,
        &["apiBaseUrl", "cloudBaseUrl", "cloud_base_url"],
        true,
    )?)?;
    if device_id.len() > 120
        || !device_key.starts_with("edgk_")
        || device_key.len() < 20
        || device_key.len() > 200
    {
        return Err("ชื่อเครื่องหรือกุญแจจับคู่ไม่ถูกต้อง".into());
    }
    Ok(EdgePairingConfig {
        device_id,
        device_key,
        cloud_base_url,
        is_paired: true,
        business_name: field(value, &["businessName", "business_name"], false)?,
        ..Default::default()
    })
}
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|_| "ไม่สามารถเริ่มการเชื่อมต่อได้".into())
}
pub async fn json_response(mut response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    if status.as_u16() == 429 {
        return Ok(serde_json::json!({"state":"WAIT"}));
    }
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "เซิร์ฟเวอร์ไม่ยอมรับสิทธิ์ กรุณาเชื่อมต่อใหม่",
            404 => "เซิร์ฟเวอร์นี้ยังไม่มีระบบจับคู่รุ่นใหม่",
            410 => "คำขอหมดอายุหรือใช้แล้ว กรุณาเริ่มใหม่ หากไม่ได้รับกุญแจให้เพิกถอนกุญแจเดิมใน Zuri",
            _ => "ติดต่อ Zuri ไม่สำเร็จ กรุณาลองใหม่",
        }
        .into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "อ่านคำตอบจาก Zuri ไม่สำเร็จ")?
    {
        if bytes.len() + chunk.len() > 16384 {
            return Err("คำตอบจาก Zuri มีขนาดเกินกำหนด".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "คำตอบจาก Zuri ไม่ถูกต้อง".into())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub request_id: String,
    pub device_secret: String,
    pub approval_url: String,
    pub check_code: String,
    pub expires_at: String,
}
pub struct Pending {
    pub start: Started,
    pub origin: String,
    pub received: Option<EdgePairingConfig>,
}
#[derive(Serialize)]
pub struct PairingView {
    pub state: String,
    pub approval_url: String,
    pub qr_svg: String,
    pub check_code: String,
    pub expires_at: String,
    pub browser_opened: bool,
}
impl Pending {
    pub fn view(&self, browser_opened: bool) -> Result<PairingView, String> {
        let code =
            QrCode::new(self.start.approval_url.as_bytes()).map_err(|_| "สร้าง QR ไม่สำเร็จ")?;
        Ok(PairingView {
            state: "PENDING".into(),
            approval_url: self.start.approval_url.clone(),
            qr_svg: code.render::<svg::Color>().min_dimensions(240, 240).build(),
            check_code: self.start.check_code.clone(),
            expires_at: self.start.expires_at.clone(),
            browser_opened,
        })
    }
}
pub fn validate_start(start: &Started, origin: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(&start.approval_url).map_err(|_| "ลิงก์จับคู่ไม่ถูกต้อง")?;
    let token = |v: &str| {
        v.len() == 43
            && v.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    };
    let expires =
        chrono::DateTime::parse_from_rfc3339(&start.expires_at).map_err(|_| "วันหมดอายุไม่ถูกต้อง")?;
    let remaining = expires.timestamp() - chrono::Utc::now().timestamp();
    if url.origin().ascii_serialization() != origin
        || url.path() != "/edge/pair"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || !url.fragment().is_some_and(token)
        || !token(&start.device_secret)
        || !token(&start.request_id)
        || start.check_code.len() != 6
        || !start.check_code.bytes().all(|v| v.is_ascii_hexdigit())
        || !(1..=330).contains(&remaining)
    {
        return Err("ข้อมูลคำขอจับคู่ไม่ตรงกับเซิร์ฟเวอร์ที่เลือก".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn consumes_console_api_base_url_and_rejects_partial_or_conflicting_input() {
        let value: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/desktop-pairing-export.json"
        ))
        .unwrap();
        let cfg = parse_pairing(&value).unwrap();
        assert_eq!(cfg.cloud_base_url, "https://zuri.example");
        assert_eq!(cfg.device_id, "DEV-TEST");
        let mut bad = value.clone();
        bad["cloudBaseUrl"] = Value::from("https://other.example");
        assert!(parse_pairing(&bad).is_err());
        bad = value.clone();
        bad.as_object_mut().unwrap().remove("apiBaseUrl");
        assert!(parse_pairing(&bad).is_err());
        bad = value;
        bad["key"] = Value::Null;
        assert!(parse_pairing(&bad).is_err());
    }
    #[test]
    fn refuses_unsafe_origins() {
        for url in [
            "http://public.example",
            "https://user:pass@zuri.example",
            "https://zuri.example/path",
            "https://zuri.example?x=1",
            "file:///tmp",
            "https://zuri.example/#x",
        ] {
            assert!(validate_origin(url).is_err(), "{url}");
        }
        assert_eq!(
            validate_origin("http://127.0.0.1:3100/").unwrap(),
            "http://127.0.0.1:3100"
        );
    }
    #[test]
    fn qr_has_only_browser_capability_and_rejects_foreign_origin() {
        let mut start = Started {
            request_id: "r".repeat(43),
            device_secret: "d".repeat(43),
            approval_url: format!("https://zuri.example/edge/pair#{}", "b".repeat(43)),
            check_code: "ABC123".into(),
            expires_at: (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339(),
        };
        assert!(validate_start(&start, "https://zuri.example").is_ok());
        assert!(!start.approval_url.contains(&start.device_secret));
        start.expires_at = (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339();
        assert!(validate_start(&start, "https://zuri.example").is_err());
        start.expires_at = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
        start.approval_url = format!("https://other.example/edge/pair#{}", "b".repeat(43));
        assert!(validate_start(&start, "https://zuri.example").is_err());
    }
}
