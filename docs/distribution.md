# md-mini Distribution Guide

> **Статус документа.** Разделы 1 и 4 описывают то, как релиз работает сейчас.
> Разделы 2 и 3 (Tauri Updater, GitHub Actions matrix) — нереализованный план
> времён 0.2.0: релизного CI в репозитории нет, `.github/workflows/` содержит
> только `deploy-site.yml`, а сборка идёт локально на машине владельца через
> скилл `/brew-release`. Не читать их как описание текущего процесса.

## Архитектуры

Один **universal** `.dmg` на обе архитектуры — Apple Silicon и Intel. Собирается
`npm run build:universal` (`tauri build --target universal-apple-darwin`); нужны
оба rustup-таргета:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

Universal выбран вместо двух отдельных `.dmg` потому, что он *упрощает* cask:
один URL и один `sha256` вместо ветки по `Hardware::CPU.arm?` с двумя хэшами.
Расплата — размер: измерено на 1.0.1, arm64-only был **7 МБ**, universal вышел
**15 МБ**. `lipo` склеивает только исполняемый файл, но в этом проекте именно он
и составляет почти весь вес — шрифты и веб-ассеты на его фоне малы, так что
рассчитывать на «меньше чем вдвое» не стоит.

Проверить, что x86_64 вообще собирается, не гоняя весь бандл:
`npm run check:x86`. Тесты под Intel-архитектурой (идут через Rosetta):
`cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-apple-darwin`.

## 1. Homebrew Tap (установка для юзеров)

Users install with:
```bash
brew tap USERNAME/md-mini && brew install --cask md-mini
```

### Setup

1. Create GitHub repo `homebrew-md-mini` (the `homebrew-` prefix makes `brew tap` work)

2. Create `Casks/md-mini.rb`:

```ruby
cask "md-mini" do
  version "0.1.0"

  # Universal build — no `Hardware::CPU.arm?` branch and no
  # `depends_on arch:`, both architectures take this same file.
  url "https://github.com/USERNAME/md-mini/releases/download/v#{version}/md-mini_#{version}_universal.dmg"
  sha256 "REPLACE_WITH_UNIVERSAL_SHA256"

  name "md-mini"
  desc "Minimalist live-preview markdown editor for macOS"
  homepage "https://github.com/USERNAME/md-mini"

  app "md-mini.app"

  postflight do
    # Install CLI wrapper
    script = <<~EOS
      #!/usr/bin/env bash
      APP="/Applications/md-mini.app"
      BIN="$APP/Contents/MacOS/md-mini"
      SOCK="/tmp/com_md_mini_app_si.sock"
      PENDING="/tmp/md-mini-pending-files"
      args=()
      for arg in "$@"; do
        if [[ "$arg" != -* && "$arg" != /* ]]; then
          arg="$(cd "$(dirname "$arg")" 2>/dev/null && pwd)/$(basename "$arg")"
        fi
        args+=("$arg")
      done
      if [ -S "$SOCK" ]; then
        "$BIN" "${args[@]}" 2>/dev/null
      else
        [ ${#args[@]} -gt 0 ] && printf '%s\\n' "${args[@]}" > "$PENDING"
        open "$APP"
      fi
    EOS
    File.write("/usr/local/bin/mdmini", script)
    FileUtils.chmod(0755, "/usr/local/bin/mdmini")
  end

  uninstall quit: "com.md-mini.app"

  zap trash: [
    "~/Library/Application Support/com.md-mini.app",
    "~/Library/Caches/com.md-mini.app",
    "/tmp/md-mini-pending-files",
    "/tmp/com_md_mini_app_si.sock",
  ],
  delete: "/usr/local/bin/mdmini"
end
```

3. Push, test: `brew tap USERNAME/md-mini && brew install --cask md-mini`

> **Official homebrew-cask** (без своего tap) — потребует 500+ звёзд на GitHub. Начинаем со своего tap, переезжаем позже.

---

## 2. Auto-Updates (Tauri Updater)

### Один раз: генерация ключей

```bash
npm run tauri signer generate -- --output ~/.tauri/md-mini.key
cat ~/.tauri/md-mini.key.pub  # → public key для tauri.conf.json
```

Приватный ключ → GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`. **Не теряй — без него существующие установки не обновятся.**

### Добавить в проект

```bash
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

`src-tauri/Cargo.toml`:
```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

`src-tauri/tauri.conf.json` → plugins:
```json
"updater": {
  "pubkey": "YOUR_PUBLIC_KEY",
  "endpoints": ["https://github.com/USERNAME/md-mini/releases/latest/download/latest.json"],
  "dialog": false
}
```

`src-tauri/capabilities/default.json` → добавить `"updater:default"`, `"process:default"`

`src-tauri/src/lib.rs` → добавить плагины:
```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

Frontend — проверка на старте (`src/lib/updater.ts`):
```typescript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;
    const yes = confirm(`md-mini ${update.version} available. Install?`);
    if (!yes) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch { /* offline — ignore */ }
}
```

Вызвать из App.svelte через 10 секунд после запуска.

---

## 3. GitHub Actions (CI/CD)

`.github/workflows/release.yml` — триггерится на `v*` теги:

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - target: aarch64-apple-darwin
            runner: macos-latest
          - target: x86_64-apple-darwin
            runner: macos-13
    runs-on: ${{ matrix.runner }}
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: rustup target add ${{ matrix.target }}
      - run: npm ci
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'md-mini ${{ github.ref_name }}'
          releaseDraft: true
          args: --target ${{ matrix.target }}

  publish:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Generate latest.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          TAG=${{ github.ref_name }}; VERSION=${TAG#v}; sleep 30
          gh release download "$TAG" --pattern "*.sig" --dir ./sigs
          ARM_SIG=$(cat ./sigs/*aarch64*.sig 2>/dev/null || echo "")
          X64_SIG=$(cat ./sigs/*x64*.sig 2>/dev/null || echo "")
          cat > latest.json <<EOF
          {"version":"${TAG}","pub_date":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","platforms":{
            "darwin-aarch64":{"signature":"${ARM_SIG}","url":"https://github.com/${{ github.repository }}/releases/download/${TAG}/md-mini_${VERSION}_aarch64.app.tar.gz"},
            "darwin-x86_64":{"signature":"${X64_SIG}","url":"https://github.com/${{ github.repository }}/releases/download/${TAG}/md-mini_${VERSION}_x64.app.tar.gz"}}}
          EOF
          gh release upload "$TAG" latest.json --clobber
          gh release edit "$TAG" --draft=false
```

---

## 4. Release Checklist

Реальный процесс — локальная сборка, не CI. Обычно его прогоняет скилл
`/brew-release`; ниже то, что он делает, для случая «руками».

```bash
# 1. Bump version
vim src-tauri/tauri.conf.json package.json  # change "version"

# 2. Commit & tag
git add -A && git commit -m "chore: bump to 0.2.0"
git tag v0.2.0 && git push origin main --tags

# 3. Build the universal .dmg locally (owner-triggered — replaces the
#    installed md-mini if you then install it)
npm run build:universal
# → src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg

# 4. Publish, naming the asset so the cask URL matches
gh release create v0.2.0 --title v0.2.0 --notes "..." \
  "src-tauri/target/universal-apple-darwin/release/bundle/dmg/md-mini_0.2.0_universal.dmg"

# 5. Update the Homebrew cask — one sha256, no per-arch branch
shasum -a 256 src-tauri/target/universal-apple-darwin/release/bundle/dmg/md-mini_0.2.0_universal.dmg
# malinborn/homebrew-mdmini → Casks/mdmini.rb: version + sha256 + url

# 6. Verify
brew update && brew upgrade --cask mdmini && mdmini
```

Проверить на Intel без Intel-мака нельзя целиком, но `arch -x86_64` запустит
собранный universal `.app` под Rosetta на Apple Silicon — этого достаточно,
чтобы поймать «не тот слайс» и падение на старте.

---

## 5. Code Signing (потом)

Без Apple Developer Program ($99/год): Gatekeeper показывает "unidentified developer" при первом запуске. Homebrew снимает это автоматически. Для разработчиков — не проблема.

Когда делать: когда появятся non-developer юзеры. `tauri-action` поддерживает signing + notarization через env vars (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_TEAM_ID`).
