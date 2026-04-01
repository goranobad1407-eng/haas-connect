use std::path::{Path, PathBuf};

use crate::models::{GcodeAnalysis, PreviewData, PreviewKind};

/// Read at most `max_bytes` from the start of a file as UTF-8.
/// Characters are decoded leniently — invalid bytes become `?`.
pub fn read_text_excerpt(path: &str, max_bytes: u64) -> Result<String, String> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|e| format!("Open error: {e}"))?;
    let mut buf = vec![0u8; max_bytes as usize];
    let n = file
        .read(&mut buf)
        .map_err(|e| format!("Read error: {e}"))?;
    buf.truncate(n);

    // Decode leniently.
    let text = String::from_utf8_lossy(&buf).into_owned();

    // If we hit the limit, add a truncation note.
    let text = if n as u64 >= max_bytes {
        format!("{text}\n\n… (preview truncated at {} KB)", max_bytes / 1024)
    } else {
        text
    };

    Ok(text)
}

/// Build a PreviewData for the given file path.
pub fn get_preview(path_str: &str, max_bytes: u64) -> Result<PreviewData, String> {
    let path = Path::new(path_str);

    if !path.exists() {
        return Err("File not found".into());
    }

    let title = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.to_string());

    if path.is_dir() {
        return Ok(PreviewData {
            kind: PreviewKind::Directory,
            title,
            content: None,
            metadata: None,
            size: None,
            error: None,
        });
    }

    let metadata = path.metadata().map_err(|e| e.to_string())?;
    let size = metadata.len();

    let extension = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();

    match extension.as_str() {
        ".nc" | ".tap" | ".cnc" => preview_gcode(path_str, title, size, max_bytes),
        ".txt" => preview_text(path_str, title, size, max_bytes),
        ".pdf" => preview_pdf(path_str, title, size),
        _ => Ok(PreviewData {
            kind: PreviewKind::Unsupported,
            title,
            content: None,
            metadata: Some(format!("Size: {}", crate::browser::format_size(size))),
            size: Some(size),
            error: None,
        }),
    }
}

fn preview_gcode(
    path: &str,
    title: String,
    size: u64,
    max_bytes: u64,
) -> Result<PreviewData, String> {
    let (content, read_err) = match read_text_excerpt(path, max_bytes) {
        Ok(c) => (c, None),
        Err(e) => (String::new(), Some(e)),
    };

    let analysis = analyze_gcode(&content);
    let metadata = format_gcode_analysis(&analysis, size);

    Ok(PreviewData {
        kind: PreviewKind::GcodeText,
        title,
        content: if content.is_empty() {
            None
        } else {
            Some(content)
        },
        metadata: Some(metadata),
        size: Some(size),
        error: read_err,
    })
}

fn preview_text(
    path: &str,
    title: String,
    size: u64,
    max_bytes: u64,
) -> Result<PreviewData, String> {
    let (content, read_err) = match read_text_excerpt(path, max_bytes) {
        Ok(c) => (c, None),
        Err(e) => (String::new(), Some(e)),
    };

    let metadata = format!("Size: {}", crate::browser::format_size(size));

    Ok(PreviewData {
        kind: PreviewKind::PlainText,
        title,
        content: if content.is_empty() {
            None
        } else {
            Some(content)
        },
        metadata: Some(metadata),
        size: Some(size),
        error: read_err,
    })
}

fn preview_pdf(path: &str, title: String, size: u64) -> Result<PreviewData, String> {
    // We do not bundle a PDF renderer. Read the first ~256 bytes to check
    // the PDF magic bytes, then report size. Opening happens in the default
    // viewer via the open_path_external command.
    let is_pdf = {
        use std::io::Read;
        let mut buf = [0u8; 5];
        std::fs::File::open(path)
            .and_then(|mut f| f.read_exact(&mut buf).map(|_| buf))
            .map(|b| b.starts_with(b"%PDF-"))
            .unwrap_or(false)
    };

    let metadata = if is_pdf {
        format!("PDF document — Size: {}", crate::browser::format_size(size))
    } else {
        format!(
            "File does not appear to be a valid PDF — Size: {}",
            crate::browser::format_size(size)
        )
    };

    Ok(PreviewData {
        kind: PreviewKind::Pdf,
        title,
        content: None,
        metadata: Some(metadata),
        size: Some(size),
        error: None,
    })
}

/// Analyse G-code content without any external regex library.
/// Parses only the first-pass content (up to max_bytes already applied upstream).
pub fn analyze_gcode(content: &str) -> GcodeAnalysis {
    let mut analysis = GcodeAnalysis::default();
    let mut g_set: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();
    let mut m_set: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();
    let mut x_vals: Vec<f64> = Vec::new();
    let mut y_vals: Vec<f64> = Vec::new();
    let mut z_vals: Vec<f64> = Vec::new();

    for line in content.lines() {
        analysis.line_count += 1;
        let stripped = strip_comment(line);
        let chars: Vec<char> = stripped.chars().collect();
        let len = chars.len();
        let mut i = 0;

        while i < len {
            match chars[i] {
                'G' | 'g' => {
                    if let Some(n) = parse_uint(&chars, i + 1) {
                        g_set.insert(n);
                    }
                }
                'M' | 'm' => {
                    if let Some(n) = parse_uint(&chars, i + 1) {
                        m_set.insert(n);
                    }
                }
                'X' | 'x' => {
                    if let Some(v) = parse_float(&chars, i + 1) {
                        x_vals.push(v);
                    }
                }
                'Y' | 'y' => {
                    if let Some(v) = parse_float(&chars, i + 1) {
                        y_vals.push(v);
                    }
                }
                'Z' | 'z' => {
                    if let Some(v) = parse_float(&chars, i + 1) {
                        z_vals.push(v);
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }

    analysis.g_codes = g_set.into_iter().collect();
    analysis.m_codes = m_set.into_iter().collect();
    analysis.x_range = minmax(&x_vals);
    analysis.y_range = minmax(&y_vals);
    analysis.z_range = minmax(&z_vals);
    analysis
}

fn format_gcode_analysis(a: &GcodeAnalysis, size: u64) -> String {
    let mut parts = Vec::new();

    parts.push(format!("Lines: {}", a.line_count));
    parts.push(format!("Size: {}", crate::browser::format_size(size)));

    if let Some((mn, mx)) = a.x_range {
        parts.push(format!("X: {mn:.3} to {mx:.3}"));
    }
    if let Some((mn, mx)) = a.y_range {
        parts.push(format!("Y: {mn:.3} to {mx:.3}"));
    }
    if let Some((mn, mx)) = a.z_range {
        parts.push(format!("Z: {mn:.3} to {mx:.3}"));
    }

    if !a.g_codes.is_empty() {
        let s: Vec<String> = a.g_codes.iter().map(|n| format!("G{n}")).collect();
        parts.push(format!("G-codes: {}", s.join(" ")));
    }
    if !a.m_codes.is_empty() {
        let s: Vec<String> = a.m_codes.iter().map(|n| format!("M{n}")).collect();
        parts.push(format!("M-codes: {}", s.join(" ")));
    }

    parts.join("\n")
}

/// Strip semicolon comments and leading/trailing whitespace from a G-code line.
fn strip_comment(line: &str) -> &str {
    let s = if let Some(pos) = line.find(';') {
        &line[..pos]
    } else {
        line
    };
    s.trim()
}

/// Parse an unsigned integer starting at `start` in a char slice.
fn parse_uint(chars: &[char], start: usize) -> Option<u32> {
    let mut i = start;
    // Skip whitespace between letter and number (rare in G-code but valid).
    while i < chars.len() && chars[i] == ' ' {
        i += 1;
    }
    let mut n: u32 = 0;
    let mut found = false;
    while i < chars.len() && chars[i].is_ascii_digit() {
        n = n
            .saturating_mul(10)
            .saturating_add(chars[i] as u32 - '0' as u32);
        found = true;
        i += 1;
    }
    if found {
        Some(n)
    } else {
        None
    }
}

/// Parse a signed decimal number starting at `start` in a char slice.
fn parse_float(chars: &[char], start: usize) -> Option<f64> {
    let mut i = start;
    while i < chars.len() && chars[i] == ' ' {
        i += 1;
    }
    let begin = i;
    if i < chars.len() && (chars[i] == '+' || chars[i] == '-') {
        i += 1;
    }
    let mut has_digit = false;
    while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
        if chars[i].is_ascii_digit() {
            has_digit = true;
        }
        i += 1;
    }
    if !has_digit {
        return None;
    }
    let s: String = chars[begin..i].iter().collect();
    s.parse::<f64>().ok()
}

fn minmax(vals: &[f64]) -> Option<(f64, f64)> {
    if vals.is_empty() {
        return None;
    }
    let mut mn = f64::INFINITY;
    let mut mx = f64::NEG_INFINITY;
    for &v in vals {
        if v < mn {
            mn = v;
        }
        if v > mx {
            mx = v;
        }
    }
    Some((mn, mx))
}

/// Open a file or directory in the OS default application.
/// On Windows this launches the Shell-associated default app for the resolved path.
pub fn open_in_default_app(path: &str) -> Result<(), String> {
    let target = resolve_open_target_path(path)?;
    let target_str = target.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        std::process::Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(&target_str)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open '{}': {e}", target.display()))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target_str)
            .spawn()
            .map_err(|e| format!("Failed to open '{}': {e}", target.display()))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&target_str)
            .spawn()
            .map_err(|e| format!("Failed to open '{}': {e}", target.display()))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("open_in_default_app: unsupported platform".into())
}

fn resolve_open_target_path(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);

    if !candidate.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    if candidate.is_absolute() {
        Ok(candidate.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(candidate))
            .map_err(|e| format!("Could not resolve path '{path}': {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gcode_analysis_basic() {
        let code = "G0 X10.0 Y20.5\nG1 Z-5.0\nM3\nM30\n";
        let a = analyze_gcode(code);
        assert_eq!(a.line_count, 4);
        assert!(a.g_codes.contains(&0));
        assert!(a.g_codes.contains(&1));
        assert!(a.m_codes.contains(&3));
        assert!(a.m_codes.contains(&30));
        assert_eq!(a.x_range, Some((10.0, 10.0)));
        assert_eq!(a.y_range, Some((20.5, 20.5)));
        assert_eq!(a.z_range, Some((-5.0, -5.0)));
    }

    #[test]
    fn gcode_analysis_multiple_x_values() {
        let code = "G1 X-10.0\nG1 X50.0\n";
        let a = analyze_gcode(code);
        let (mn, mx) = a.x_range.unwrap();
        assert!((mn - (-10.0)).abs() < 1e-6);
        assert!((mx - 50.0).abs() < 1e-6);
    }

    #[test]
    fn gcode_analysis_ignores_semicolon_comments() {
        let code = "G0 X5.0 ; this is X100.0 (should be ignored)\n";
        let a = analyze_gcode(code);
        // Only X5.0 should be parsed, not X100.0 after the comment.
        let (mn, mx) = a.x_range.unwrap();
        assert!((mn - 5.0).abs() < 1e-6);
        assert!((mx - 5.0).abs() < 1e-6);
    }

    #[test]
    fn gcode_analysis_empty_file() {
        let a = analyze_gcode("");
        assert_eq!(a.line_count, 0);
        assert!(a.g_codes.is_empty());
        assert!(a.x_range.is_none());
    }

    #[test]
    fn parse_negative_float() {
        let chars: Vec<char> = "-5.75".chars().collect();
        let v = parse_float(&chars, 0);
        assert_eq!(v, Some(-5.75));
    }

    #[test]
    fn parse_uint_basic() {
        let chars: Vec<char> = "21 ".chars().collect();
        assert_eq!(parse_uint(&chars, 0), Some(21));
    }

    #[test]
    fn strip_comment_removes_after_semicolon() {
        assert_eq!(strip_comment("G0 X5 ; comment"), "G0 X5");
        assert_eq!(strip_comment("M30"), "M30");
    }

    #[test]
    fn resolve_open_target_path_rejects_missing_path() {
        let result = resolve_open_target_path("C:/haas-connect/does-not-exist.pdf");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_open_target_path_accepts_existing_file() {
        let temp_file = std::env::temp_dir().join(format!(
            "haas-open-target-{}.txt",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        std::fs::write(&temp_file, "test").unwrap();
        let resolved = resolve_open_target_path(temp_file.to_string_lossy().as_ref()).unwrap();

        assert!(resolved.exists());

        let _ = std::fs::remove_file(temp_file);
    }
}
