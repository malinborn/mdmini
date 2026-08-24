---
name: md-mini-install
description: Build and install md-mini app to /Applications with CLI symlink. Use when user wants to build, install, update, or deploy md-mini on their Mac.
user_invocable: true
---

# md-mini Build & Install

Build the md-mini Tauri app and install it to /Applications with a `mdmini` CLI command.

## Steps

1. Kill any running dev server on port 1420:
   ```bash
   lsof -ti:1420 | xargs kill -9 2>/dev/null || true
   ```

2. Run the install script from the project root:
   ```bash
   cd /Users/maximkovalevskij/playground/md-mini && bash scripts/install.sh
   ```

3. Verify the install:
   ```bash
   which mdmini && mdmini --version 2>/dev/null || echo "Installed at $(readlink /usr/local/bin/mdmini)"
   ```

4. Report result to user: installed version, path, usage examples:
   - `mdmini` — open empty editor
   - `mdmini README.md` — open file
   - `mdmini file1.md file2.md` — open multiple files

## Notes

- Requires `sudo` for the symlink creation (script will prompt)
- Build takes 1-3 minutes (Rust compilation)
- If the app is currently running, close it first or it may not replace cleanly
- The symlink points to `/Applications/md-mini.app/Contents/MacOS/md-mini`
