[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$trackedFiles = @(
    git -C $repositoryRoot ls-files | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

if ($LASTEXITCODE -ne 0) {
    throw 'Unable to enumerate tracked Git files.'
}

$errors = [System.Collections.Generic.List[string]]::new()
$licenseCandidates = @('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md', 'COPYING.txt')
$licensePresent = $licenseCandidates | Where-Object { Test-Path -LiteralPath (Join-Path $repositoryRoot $_) } | Select-Object -First 1
if (-not $licensePresent) {
    $errors.Add('Missing root license file. Select the project license before public release.')
}

$packageManifestPath = Join-Path $repositoryRoot 'package.json'
$cargoManifestPath = Join-Path $repositoryRoot 'src-tauri/Cargo.toml'
$packageLicense = $null
$cargoLicense = $null

if (Test-Path -LiteralPath $packageManifestPath) {
    $packageManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $packageManifestPath | ConvertFrom-Json
    $packageLicense = [string]$packageManifest.license
    if ([string]::IsNullOrWhiteSpace($packageLicense) -or $packageLicense -eq 'UNLICENSED') {
        $errors.Add('package.json must contain the selected SPDX license identifier.')
    }
} else {
    $errors.Add('Missing project manifest: package.json')
}

if (Test-Path -LiteralPath $cargoManifestPath) {
    $cargoManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $cargoManifestPath
    $cargoLicenseMatch = [regex]::Match($cargoManifest, '(?m)^\s*license\s*=\s*"([^"]+)"')
    if ($cargoLicenseMatch.Success) {
        $cargoLicense = $cargoLicenseMatch.Groups[1].Value
    }
    if ([string]::IsNullOrWhiteSpace($cargoLicense) -or $cargoLicense -eq 'UNLICENSED') {
        $errors.Add('src-tauri/Cargo.toml must contain the selected SPDX license identifier.')
    }
} else {
    $errors.Add('Missing project manifest: src-tauri/Cargo.toml')
}

if (-not [string]::IsNullOrWhiteSpace($packageLicense) -and
    -not [string]::IsNullOrWhiteSpace($cargoLicense) -and
    $packageLicense -ne $cargoLicense) {
    $errors.Add("License mismatch: package.json uses '$packageLicense' and Cargo.toml uses '$cargoLicense'.")
}

$forbiddenPathPattern = '^(node_modules|dist|src-tauri/target|src-tauri/gen/schemas|Idea Workspace|promo|video-studio|\.logs|\.artifacts|\.audit|\.pnpm-store)(/|$)'
$forbiddenExtensionPattern = '\.(exe|msi|msix|appx|pdb|dmp)$'
$secretPatterns = @(
    'sk-(?!TEST-ONLY-)[A-Za-z0-9._-]{16,}',
    'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY',
    'Bearer\s+[A-Za-z0-9._~+/-]{20,}'
)
$machinePathPatterns = @(
    '[A-Za-z]:\\Users\\[^\\\s]+',
    'D:\\brainstorm'
)
$maximumFileBytes = 10MB
$maximumScannedTextBytes = 2MB
$binaryExtensions = @('.png', '.ico', '.icns', '.jpg', '.jpeg', '.gif', '.webp', '.pdf')

foreach ($relativePath in $trackedFiles) {
    $normalizedPath = $relativePath -replace '\\', '/'
    if ($normalizedPath -match $forbiddenPathPattern) {
        $errors.Add("Forbidden tracked path: $normalizedPath")
        continue
    }
    if ($normalizedPath -match $forbiddenExtensionPattern) {
        $errors.Add("Forbidden tracked binary: $normalizedPath")
    }

    $absolutePath = Join-Path $repositoryRoot $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
        continue
    }

    # PowerShell treats dotfiles as hidden on Unix runners. `Test-Path` sees
    # them, but `Get-Item` requires `-Force` to resolve entries such as
    # `.editorconfig` and `.gitignore` consistently across platforms.
    $item = Get-Item -Force -LiteralPath $absolutePath
    if ($item.Length -gt $maximumFileBytes) {
        $errors.Add("Tracked file exceeds 10 MiB: $normalizedPath ($($item.Length) bytes)")
    }

    if ($item.Length -gt $maximumScannedTextBytes -or $binaryExtensions -contains $item.Extension.ToLowerInvariant()) {
        continue
    }

    $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $absolutePath -ErrorAction SilentlyContinue
    if ($null -eq $content) {
        continue
    }
    foreach ($pattern in $secretPatterns) {
        if ($content -match $pattern) {
            $errors.Add("Possible credential pattern in: $normalizedPath")
            break
        }
    }
    foreach ($pattern in $machinePathPatterns) {
        if ($content -match $pattern) {
            $errors.Add("Machine-specific absolute path in: $normalizedPath")
            break
        }
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { [Console]::Error.WriteLine($_) }
    exit 1
}

Write-Host "Repository boundary audit passed for $($trackedFiles.Count) tracked files."
