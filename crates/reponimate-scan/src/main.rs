//! reponimate-scan: the CPU-heavy part of repository ingestion, in Rust.
//!
//! Walks a cloned repository in parallel, applies the same exclusion and security rules as the
//! TypeScript fallback (src/repo/security.ts), redacts credential-like strings and prints JSON:
//! `{ "files": [{path, bytes, lines, text}], "skipped": [{path, reason}], "redactions": n, "totalBytes": n }`.
//!
//! Usage: reponimate-scan <repo-dir> [--max-file-bytes N] [--max-total-bytes N] [--max-files N]

use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;

#[derive(Serialize)]
struct FileOut {
    path: String,
    bytes: u64,
    lines: usize,
    text: String,
}

#[derive(Serialize)]
struct Skipped {
    path: String,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanOut {
    files: Vec<FileOut>,
    skipped: Vec<Skipped>,
    redactions: usize,
    total_bytes: u64,
}

struct Limits {
    max_file_bytes: u64,
    max_total_bytes: u64,
    max_files: usize,
}

const EXCLUDED_DIRS: &[&str] = &[
    ".git", "node_modules", "vendor", "dist", "build", "out", "coverage", ".next", ".nuxt", "target",
    "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache", ".pytest_cache", ".gradle", ".idea",
    ".vscode", "bower_components", "Pods", ".cache", ".turbo", ".yarn", "third_party", "site-packages",
];

const BINARY_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svgz", "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z",
    "rar", "jar", "war", "class", "so", "dylib", "dll", "exe", "bin", "o", "a", "wasm", "mp3", "mp4", "wav",
    "ogg", "mov", "avi", "webm", "ttf", "otf", "woff", "woff2", "eot", "psd", "sqlite", "db", "pyc", "onnx",
    "pt", "safetensors", "h5", "pkl", "npy",
];

struct Rules {
    generated: Vec<Regex>,
    secret_files: Vec<Regex>,
    env_example: Regex,
    redactions: Vec<(Regex, &'static str)>,
}

impl Rules {
    fn new() -> Self {
        let r = |s: &str| Regex::new(s).expect("valid regex");
        Rules {
            generated: [
                r"\.min\.(js|css)$", r"\.map$", r"(^|/)package-lock\.json$", r"(^|/)yarn\.lock$",
                r"(^|/)pnpm-lock\.yaml$", r"(^|/)Cargo\.lock$", r"(^|/)poetry\.lock$", r"(^|/)go\.sum$",
                r"(^|/)composer\.lock$", r"\.pb\.go$", r"_pb2\.py$", r"\.generated\.", r"(^|/)Gemfile\.lock$", r"\.snap$",
            ]
            .iter()
            .map(|s| r(s))
            .collect(),
            secret_files: [
                r"(^|/)\.env(\..*)?$", r"\.pem$", r"\.key$", r"\.p12$", r"\.pfx$", r"(^|/)id_(rsa|dsa|ed25519|ecdsa)$",
                r"(^|/)\.npmrc$", r"(^|/)\.pypirc$", r"(^|/)credentials(\.json)?$", r"(^|/)\.netrc$", r"secrets?\.(ya?ml|json)$",
            ]
            .iter()
            .map(|s| r(s))
            .collect(),
            env_example: r(r"\.env\.(example|sample|template)$"),
            redactions: vec![
                (r(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), "[REDACTED PRIVATE KEY]"),
                (r(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"), "[REDACTED GITHUB TOKEN]"),
                (r(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b"), "[REDACTED GITHUB TOKEN]"),
                (r(r"\bsk-[A-Za-z0-9_-]{20,}\b"), "[REDACTED API KEY]"),
                (r(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED AWS KEY]"),
                (r(r"\bAIza[0-9A-Za-z_-]{35}\b"), "[REDACTED GOOGLE KEY]"),
                (r(r"\bxox[abpr]-[A-Za-z0-9-]{10,}\b"), "[REDACTED SLACK TOKEN]"),
                (r(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"), "[REDACTED JWT]"),
                (
                    r(r#"(?i)((?:api[_-]?key|secret|password|passwd|token|auth)["']?\s*[:=]\s*["'])([^"'\s]{8,})(["'])"#),
                    "${1}[REDACTED]${3}",
                ),
            ],
        }
    }

    fn is_secret(&self, p: &str) -> bool {
        !self.env_example.is_match(p) && self.secret_files.iter().any(|r| r.is_match(p))
    }

    fn redact(&self, text: &str) -> (String, usize) {
        let mut out = text.to_string();
        let mut count = 0;
        for (re, rep) in &self.redactions {
            let n = re.find_iter(&out).count();
            if n > 0 {
                count += n;
                out = re.replace_all(&out, *rep).into_owned();
            }
        }
        (out, count)
    }
}

fn is_binary_ext(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| BINARY_EXT.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Collects candidate files in sorted order (matching the TypeScript walker) without reading them.
fn walk(root: &Path, dir: &Path, rel: &str, excluded: &HashSet<&str>, out: &mut Vec<(String, PathBuf, u64)>, skipped: &mut Vec<Skipped>) {
    let mut entries: Vec<_> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(Result::ok).collect(),
        Err(_) => return,
    };
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().into_owned();
        let rel_path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let ft = match e.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            let inside = fs::canonicalize(e.path()).ok().map(|p| p.starts_with(root)).unwrap_or(false);
            let reason = if inside { "symlink (not followed)" } else { "symlink escapes repository" };
            skipped.push(Skipped { path: rel_path, reason: reason.into() });
            continue;
        }
        if ft.is_dir() {
            if !excluded.contains(name.as_str()) {
                walk(root, &e.path(), &rel_path, excluded, out, skipped);
            }
            continue;
        }
        if ft.is_file() {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push((rel_path, e.path(), size));
        }
    }
}

fn parse_flag(args: &[String], name: &str, default: u64) -> u64 {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(root_arg) = args.get(1).filter(|a| !a.starts_with("--")) else {
        eprintln!("usage: reponimate-scan <repo-dir> [--max-file-bytes N] [--max-total-bytes N] [--max-files N]");
        std::process::exit(2);
    };
    let limits = Limits {
        max_file_bytes: parse_flag(&args, "--max-file-bytes", 512 * 1024),
        max_total_bytes: parse_flag(&args, "--max-total-bytes", 40 * 1024 * 1024),
        max_files: parse_flag(&args, "--max-files", 5000) as usize,
    };
    let root = match fs::canonicalize(root_arg) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("cannot open {root_arg}: {e}");
            std::process::exit(1);
        }
    };
    let rules = Rules::new();
    let excluded: HashSet<&str> = EXCLUDED_DIRS.iter().copied().collect();
    let mut candidates = Vec::new();
    let mut skipped = Vec::new();
    walk(&root, &root, "", &excluded, &mut candidates, &mut skipped);

    // Apply cheap path rules and limits sequentially so results are deterministic.
    let mut accepted: Vec<(String, PathBuf, u64)> = Vec::new();
    let mut total: u64 = 0;
    for (rel, abs, size) in candidates {
        if accepted.len() >= limits.max_files {
            skipped.push(Skipped { path: rel, reason: "file count limit".into() });
            continue;
        }
        if rules.is_secret(&rel) {
            skipped.push(Skipped { path: rel, reason: "possible secret file".into() });
            continue;
        }
        if is_binary_ext(&abs) {
            continue;
        }
        if rules.generated.iter().any(|r| r.is_match(&rel)) {
            skipped.push(Skipped { path: rel, reason: "generated or lock file".into() });
            continue;
        }
        if size > limits.max_file_bytes {
            skipped.push(Skipped { path: rel, reason: format!("larger than {} KB", limits.max_file_bytes / 1024) });
            continue;
        }
        if total + size > limits.max_total_bytes {
            skipped.push(Skipped { path: rel, reason: "total size limit".into() });
            continue;
        }
        total += size;
        accepted.push((rel, abs, size));
    }

    // Read, sniff and redact in parallel.
    let workers = thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(16);
    let rules = std::sync::Arc::new(rules);
    let accepted_paths: Vec<String> = accepted.iter().map(|(rel, _, _)| rel.clone()).collect();
    let jobs = std::sync::Arc::new(std::sync::Mutex::new(accepted.into_iter().enumerate().collect::<Vec<_>>()));
    let (tx, rx) = mpsc::channel::<(usize, Option<FileOut>, usize)>();
    let mut handles = Vec::new();
    for _ in 0..workers {
        let jobs = jobs.clone();
        let rules = rules.clone();
        let tx = tx.clone();
        handles.push(thread::spawn(move || loop {
            let job = jobs.lock().unwrap().pop();
            let Some((idx, (rel, abs, size))) = job else { break };
            let Ok(buf) = fs::read(&abs) else {
                let _ = tx.send((idx, None, 0));
                continue;
            };
            if buf.iter().take(8000).any(|&b| b == 0) {
                let _ = tx.send((idx, None, 0));
                continue;
            }
            let text = String::from_utf8_lossy(&buf);
            if text.split('\n').any(|l| l.chars().count() > 1000) {
                let _ = tx.send((idx, None, usize::MAX));
                continue;
            }
            let (red, n) = rules.redact(&text);
            let lines = red.split('\n').count();
            let _ = tx.send((idx, Some(FileOut { path: rel, bytes: size, lines, text: red }), n));
        }));
    }
    drop(tx);
    let mut results: Vec<(usize, FileOut)> = Vec::new();
    let mut redactions = 0;
    let mut total_bytes = 0;
    let mut minified: Vec<usize> = Vec::new();
    for (idx, file, n) in rx {
        if file.is_none() && n == usize::MAX {
            minified.push(idx);
            continue;
        }
        if let Some(f) = file {
            redactions += n;
            total_bytes += f.bytes;
            results.push((idx, f));
        }
    }
    for h in handles {
        let _ = h.join();
    }
    results.sort_by_key(|(i, _)| *i);
    minified.sort();
    for idx in minified {
        skipped.push(Skipped { path: accepted_paths[idx].clone(), reason: "minified (line longer than 1000 characters)".into() });
    }
    let out = ScanOut { files: results.into_iter().map(|(_, f)| f).collect(), skipped, redactions, total_bytes };
    let stdout = std::io::stdout();
    let lock = stdout.lock();
    serde_json::to_writer(lock, &out).expect("write json");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_tokens_and_assignments() {
        let rules = Rules::new();
        let (out, n) = rules.redact("token = \"abcdefghijkl\"\nkey ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert!(!out.contains("abcdefghijkl"));
        assert!(!out.contains("ghp_aaaa"));
        assert_eq!(n, 2);
    }

    #[test]
    fn secret_paths() {
        let rules = Rules::new();
        assert!(rules.is_secret(".env"));
        assert!(rules.is_secret("deploy/id_rsa"));
        assert!(!rules.is_secret(".env.example"));
        assert!(!rules.is_secret("src/env.ts"));
    }

    #[test]
    fn binary_extensions() {
        assert!(is_binary_ext(Path::new("logo.PNG")));
        assert!(!is_binary_ext(Path::new("main.rs")));
    }
}
