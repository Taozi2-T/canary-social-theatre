# Changelog

## 1.3.1

- Shared main API request queue for coexistence with the PrivateHub video theatre extension.
- Foreground story generation waits for the shared queue; stale queued jobs are discarded.

## 1.3.0

- Read world info for theatre generation on both main and independent APIs.
- Capture per-reply activated entry snapshots without running another world scan.
- Optional per-chat selected books, excluding disabled entries, with macro substitution.
- World material budget, saved snapshots, read status, and 1.13.2 book-list compatibility.
- Discard book loads for stale jobs and defer requests if story generation starts during loading.

## 1.2.0

- Fetch compatible model lists automatically after endpoint/key changes, with refresh and dropdown selection.
- Preserve manual model IDs and discard responses from outdated connections.
- Model list timeout and error handling; session-only key and list storage.
- Clarify independent theatre memory and current character/worldbook context limits.

## 1.1.0

- Separate platform layouts for WeChat groups, Douban, Rednote, Douyin, WeChat Moments, X, and Instagram.
- Platform-specific typography, colors, media descriptions, metadata, and comment threads.
- Expandable comments and responsive mobile layouts.
- Optional media description field; existing saved scenes remain compatible.
- Self-contained offline preview and reproducible preview builder.

## 1.0.0

- Per-reply social theatre, main/independent APIs, saved scenes, retries, and HTML export.
