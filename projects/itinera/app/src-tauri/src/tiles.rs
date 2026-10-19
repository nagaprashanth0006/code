//! Serves `<app data>/tiles/<region>.pmtiles` with HTTP byte ranges, which is
//! how the PMTiles reader in MapLibre fetches the header, directories and
//! individual tiles. Only plain file names ending in `.pmtiles` are served.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{header, Request, Response, StatusCode};

const CORS: [(&str, &str); 3] = [
    ("Access-Control-Allow-Origin", "*"),
    ("Access-Control-Allow-Headers", "Range, If-Match"),
    ("Access-Control-Expose-Headers", "Content-Range, Content-Length, ETag"),
];

pub fn error(status: u16, message: &str) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain");
    for (k, v) in CORS {
        builder = builder.header(k, v);
    }
    builder.body(message.as_bytes().to_vec()).unwrap()
}

/// Parses a single `bytes=a-b`, `bytes=a-` or `bytes=-n` range against `size`.
pub fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.trim(), end.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            (size.saturating_sub(n), size.checked_sub(1)?)
        }
        (s, "") => (s.parse().ok()?, size.checked_sub(1)?),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(size.checked_sub(1)?)),
    };
    (start <= end && end < size).then_some((start, end))
}

fn valid_name(name: &str) -> bool {
    name.len() <= 100
        && name.ends_with(".pmtiles")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.contains("..")
}

pub fn serve(dir: &Path, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == "OPTIONS" {
        let mut builder = Response::builder().status(StatusCode::NO_CONTENT);
        for (k, v) in CORS {
            builder = builder.header(k, v);
        }
        return builder
            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
            .body(Vec::new())
            .unwrap();
    }

    let name = request.uri().path().trim_start_matches('/');
    if !valid_name(name) {
        return error(404, "not found");
    }
    let mut file = match File::open(dir.join(name)) {
        Ok(f) => f,
        Err(_) => return error(404, "not found"),
    };
    let size = match file.metadata() {
        Ok(m) => m.len(),
        Err(e) => return error(500, &e.to_string()),
    };

    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|v| parse_range(v, size));
    let (start, end, status) = match range {
        None => (0, size.saturating_sub(1), StatusCode::OK),
        Some(Some((s, e))) => (s, e, StatusCode::PARTIAL_CONTENT),
        Some(None) => {
            let mut r = error(416, "range not satisfiable");
            r.headers_mut().insert(
                header::CONTENT_RANGE,
                format!("bytes */{size}").parse().unwrap(),
            );
            return r;
        }
    };

    let len = if size == 0 { 0 } else { end - start + 1 };
    let mut body = vec![0u8; len as usize];
    if len > 0 {
        if let Err(e) = file
            .seek(SeekFrom::Start(start))
            .and_then(|_| file.read_exact(&mut body))
        {
            return error(500, &e.to_string());
        }
    }

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len);
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    for (k, v) in CORS {
        builder = builder.header(k, v);
    }
    builder.body(body).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-126", 1000), Some((0, 126)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=990-2000", 1000), Some((990, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=0-1,5-6", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn rejects_unsafe_names() {
        assert!(valid_name("lisbon.pmtiles"));
        assert!(!valid_name("../secrets.pmtiles"));
        assert!(!valid_name("a/b.pmtiles"));
        assert!(!valid_name("itinera.db"));
    }
}
