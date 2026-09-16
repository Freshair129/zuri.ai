// @spec SEC-025 — protect the Desktop credential at rest with the current Windows user's DPAPI.
use base64::{engine::general_purpose::STANDARD, Engine};

#[cfg(windows)]
fn crypt(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI allocates output; copy it before freeing with LocalFree on both paths.
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err("ไม่สามารถอ่านหรือบันทึกกุญแจสำหรับบัญชี Windows นี้ได้".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}
#[cfg(not(windows))]
fn crypt(_bytes: &[u8], _protect: bool) -> Result<Vec<u8>, String> {
    Err("การเก็บกุญแจแบบปลอดภัยรุ่นนี้รองรับ Windows เท่านั้น".into())
}
pub fn protect(raw: &str) -> Result<String, String> {
    Ok(format!(
        "dpapi:{}",
        STANDARD.encode(crypt(raw.as_bytes(), true)?)
    ))
}
pub fn unprotect(stored: &str) -> Result<String, String> {
    let encoded = stored
        .strip_prefix("dpapi:")
        .ok_or("รูปแบบกุญแจที่บันทึกไว้ไม่ถูกต้อง")?;
    let bytes = STANDARD.decode(encoded).map_err(|_| "อ่านกุญแจที่บันทึกไว้ไม่ได้")?;
    String::from_utf8(crypt(&bytes, false)?).map_err(|_| "อ่านกุญแจที่บันทึกไว้ไม่ได้".into())
}
#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_round_trip_and_tamper_refusal() {
        let raw = "edgk_synthetic_test_credential";
        let sealed = super::protect(raw).unwrap();
        assert!(!sealed.contains(raw));
        assert_eq!(super::unprotect(&sealed).unwrap(), raw);
        assert!(super::unprotect("dpapi:dGFtcGVyZWQ=").is_err());
    }
}
