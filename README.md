# DropZone

Direct backup full-stack solution built with Bun.

**Author:** Xeoxaz <Xeoxaz@outlook.com>

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Storage Requirements (Linux-only)

- This project is configured for Linux-only filesystem storage.
- Default storage root is `/mnt/vault-01`.
- Upload data is stored under `/mnt/vault-01/uploads`.
- You can override the root with `DROPZONE_STORAGE_ROOT`.

One-time permissions setup (required if mount is root-owned):

```bash
sudo mkdir -p /mnt/vault-01/uploads
sudo chown -R $(id -u):$(id -g) /mnt/vault-01/uploads
```

Example:

```bash
DROPZONE_STORAGE_ROOT=/mnt/vault-01 bun run index.ts
```

DropZone is a comprehensive full-stack application for direct backup operations.
