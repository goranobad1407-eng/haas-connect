use std::time::Duration;
use tokio::time::timeout;

use crate::models::AvailabilityStatus;

/// Check whether a filesystem path is accessible, with a hard timeout.
///
/// Design intent:
/// - On Windows, accessing an offline mapped drive or UNC path can block for
///   30–90 seconds in the OS. We must never do that on the UI thread.
/// - We use `spawn_blocking` so the synchronous `std::fs::metadata` call runs
///   on a dedicated thread pool thread.
/// - `tokio::time::timeout` wraps the entire `spawn_blocking` future. When it
///   fires, we return `Timeout` immediately to the caller. The background thread
///   may still be stuck — we accept that trade-off. At the app's scale the
///   leaked thread will eventually be cleaned up by the OS or by the thread
///   pool shrinking.
/// - Timeout is configurable (default 3 seconds from config).
pub async fn check_path_availability(path: String, timeout_secs: u64) -> AvailabilityStatus {
    let check = tokio::task::spawn_blocking(move || {
        // `metadata()` must traverse the path; it will block on dead network shares.
        // We deliberately avoid `Path::exists()` because it swallows errors.
        std::fs::metadata(&path)
    });

    match timeout(Duration::from_secs(timeout_secs), check).await {
        // Check completed within time limit.
        Ok(Ok(Ok(_metadata))) => AvailabilityStatus::Online,

        // Path is not accessible (doesn't exist, permission denied, etc.)
        Ok(Ok(Err(_io_err))) => AvailabilityStatus::Offline,

        // spawn_blocking thread panicked.
        Ok(Err(_join_err)) => AvailabilityStatus::Error,

        // Timed out — path is likely an unreachable network share.
        Err(_elapsed) => AvailabilityStatus::Timeout,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn online_for_existing_path() {
        // The temp directory always exists.
        let tmp = std::env::temp_dir().to_string_lossy().to_string();
        let status = check_path_availability(tmp, 5).await;
        assert_eq!(status, AvailabilityStatus::Online);
    }

    #[tokio::test]
    async fn offline_for_nonexistent_path() {
        let bogus = "C:/this/path/does/not/exist/haas_test_xyz".to_string();
        let status = check_path_availability(bogus, 5).await;
        assert_eq!(status, AvailabilityStatus::Offline);
    }
}
