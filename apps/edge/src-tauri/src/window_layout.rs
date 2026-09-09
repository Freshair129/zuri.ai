// @spec FR-150 — fit the Desktop client and native frame inside the monitor work area.
// Tests below cover DPI and taskbar/frame bounds.
use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize};

fn client_dimensions(
    work: (u32, u32),
    frame: (u32, u32),
    scale: f64,
) -> (PhysicalSize<u32>, PhysicalSize<u32>) {
    let available = (
        work.0.saturating_sub(frame.0).max(1),
        work.1.saturating_sub(frame.1).max(1),
    );
    let fit = |width: f64, height: f64| {
        PhysicalSize::new(
            ((width * scale).round() as u32).min(available.0),
            ((height * scale).round() as u32).min(available.1),
        )
    };
    (fit(1050.0, 680.0), fit(640.0, 480.0))
}

pub fn fit_to_work_area(app: &tauri::App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let work = monitor.work_area();
        let outer = window.outer_size()?;
        let inner = window.inner_size()?;
        let frame = (
            outer.width.saturating_sub(inner.width),
            outer.height.saturating_sub(inner.height),
        );
        let (size, minimum) = client_dimensions(
            (work.size.width, work.size.height),
            frame,
            window.scale_factor()?,
        );
        window.set_min_size(Some(minimum))?;
        window.set_size(size)?;
        window.set_position(PhysicalPosition::new(
            work.position.x + (work.size.width.saturating_sub(size.width + frame.0) / 2) as i32,
            work.position.y + (work.size.height.saturating_sub(size.height + frame.1) / 2) as i32,
        ))?;
    } else {
        window.set_min_size(Some(LogicalSize::new(640.0, 480.0)))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_native_frame_and_taskbar_at_each_scale() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let frame = ((16.0 * scale) as u32, (39.0 * scale) as u32);
            let (size, minimum) = client_dimensions((1920, 1040), frame, scale);
            assert!(size.width + frame.0 <= 1920);
            assert!(size.height + frame.1 <= 1040);
            assert!(minimum.width <= size.width && minimum.height <= size.height);
            assert_eq!(minimum.width, (640.0 * scale) as u32);
            assert_eq!(minimum.height, (480.0 * scale) as u32);
        }
    }

    #[test]
    fn small_work_area_does_not_force_a_window_off_screen() {
        let (size, minimum) = client_dimensions((800, 550), (24, 58), 1.5);
        assert_eq!(size, PhysicalSize::new(776, 492));
        assert_eq!(minimum, size);
        // Below the supported logical viewport, report limits in the UI; do not
        // hide the native buttons behind the taskbar to enforce a nominal minimum.
    }
}
