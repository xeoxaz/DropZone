# DropZone

Linux-only direct backup app built with Bun and vault-backed storage with intelligent file deduplication.

**Author:** Xeoxaz <Xeoxaz@outlook.com>

## Features

- **Hash-Based Deduplication**: Automatic detection of duplicate files using SHA-256 hashing
- **SQLite Integration**: Fast, file-based database with zero configuration
- **Space Savings**: Store unique files only once, saving vault space
- **Multiple Upload Modes**: MultiStream, ChunkLine (chunked), and ArcPack support
- **Operator-Friendly**: Editable filenames for incoming uploads
- **Linux-optimized**: Designed for Linux filesystem mounts and vault-backed storage

## Installation

Install dependencies:

```bash
bun install
```

No database setup required - SQLite database is created automatically on first run!

## Storage Requirements (Linux-only)

- This project is configured for Linux-only filesystem storage.
- Default storage root is `/mnt/vault-01`.
- Upload data is stored under `/mnt/vault-01/uploads`.
- Database file is stored at `/mnt/vault-01/uploads/dropzone.db`.
- Override the root with `DROPZONE_STORAGE_ROOT` environment variable.

One-time permissions setup for vault storage:

```bash
# The uploads subdirectory should already exist and be owned by you
# If not, create it:
sudo mkdir -p /mnt/vault-01/uploads
sudo chown -R $(id -u):$(id -g) /mnt/vault-01/uploads
```

For local development (files stored in project directory):

```bash
# Remove or comment out DROPZONE_STORAGE_ROOT in .env
# Storage will default to ./uploads and ./dropzone.db in the project directory
```

## Running DropZone

```bash
bun run index.ts
# or use the npm scripts:
bun run start      # Start server
bun run dev        # Start with auto-reload
bun run typecheck  # Type-check without running
```

Override storage root:

```bash
DROPZONE_STORAGE_ROOT=/mnt/vault-01 bun run index.ts
```

## How Deduplication Works

1. When a file is uploaded, DropZone calculates its SHA-256 hash
2. The hash is checked against the `stored_files` table in SQLite
3. **If duplicate**: The file is NOT saved again. Instead, an upload record is created that references the existing physical file
4. **If unique**: The file is saved to disk and records are created in both `stored_files` and `upload_records` tables

**Benefits:**
- Multiple operators can upload the same file, but only one copy is stored
- All upload attempts are tracked with original filenames and timestamps
- File browser shows all uploads with duplicate indicators
- Significant vault space savings on commonly uploaded files

DropZone is a comprehensive full-stack application for direct backup operations.
