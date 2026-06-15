param(
    [string]$BuildDir = "",
    [string]$WorkspaceLvgl = "",
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

$runtime = Find-CommandName @("node", "bun")
if (-not $runtime) {
    throw "node or bun is required to generate LVGL screen workspace config."
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

if (-not $WorkspaceLvgl) {
    $WorkspaceLvgl = $env:WALNUT_SCREEN_WORKSPACE_LVGL
}
if ($WorkspaceLvgl -eq "prebuilt") {
    $workspaceHeader = Join-Path $RootDir "lvgl_app\generated\screen_workspace_config.h"
    $workspaceSource = Join-Path $RootDir "lvgl_app\generated\screen_workspace_config.c"
    if (-not (Test-Path $workspaceHeader) -or -not (Test-Path $workspaceSource)) {
        throw "Prebuilt workspace LVGL config is missing."
    }
} else {
    $previousWorkspaceLvgl = $env:WALNUT_SCREEN_WORKSPACE_LVGL
    try {
        $env:WALNUT_SCREEN_WORKSPACE_LVGL = $WorkspaceLvgl
        & $runtime (Join-Path $RootDir "scripts\generate-lvgl-screen-workspace-config.js")
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to generate LVGL screen workspace config."
        }
    } finally {
        $env:WALNUT_SCREEN_WORKSPACE_LVGL = $previousWorkspaceLvgl
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
