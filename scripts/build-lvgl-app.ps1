param(
    [string]$BuildDir = "",
    [switch]$CleanConfigure
)

$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $BuildDir) {
    $BuildDir = Join-Path $RootDir "build\lvgl_app-windows"
}
$BuildDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($BuildDir)

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Find-CommandName {
    param([string[]]$Names)

    foreach ($Name in $Names) {
        if (Get-Command $Name -ErrorAction SilentlyContinue) {
            return $Name
        }
    }
    return $null
}

Require-Command "cmake"

$generator = "Ninja"
if (-not (Get-Command "ninja" -ErrorAction SilentlyContinue)) {
    throw "Required command 'ninja' was not found on PATH. Install Ninja before running the Windows-native LVGL build."
}

$ccache = Find-CommandName @("ccache", "sccache")

$lvglDir = Join-Path $RootDir "third_party\lvgl"
if (-not (Test-Path (Join-Path $lvglDir "CMakeLists.txt"))) {
    Require-Command "git"
    New-Item -ItemType Directory -Force -Path (Join-Path $RootDir "third_party") | Out-Null
    & git clone --depth 1 --branch v9.2.2 https://github.com/lvgl/lvgl.git $lvglDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to fetch LVGL source."
    }
}

if ($CleanConfigure -and (Test-Path $BuildDir)) {
    Remove-Item -LiteralPath $BuildDir -Recurse -Force
}

$cmakeArgs = @(
    "-S", (Join-Path $RootDir "lvgl_app"),
    "-B", $BuildDir,
    "-G", $generator,
    "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"
)

if ($ccache) {
    $cmakeArgs += "-DCMAKE_C_COMPILER_LAUNCHER=$ccache"
}

& cmake @cmakeArgs
if ($LASTEXITCODE -ne 0) {
    throw "CMake configure failed."
}

$jobs = [Environment]::ProcessorCount
if ($jobs -lt 1) {
    $jobs = 2
}

& cmake --build $BuildDir --target walnut-lvgl-preview --parallel $jobs
if ($LASTEXITCODE -ne 0) {
    throw "LVGL build failed."
}

Write-Output (Join-Path $BuildDir "walnut-lvgl-preview.exe")
