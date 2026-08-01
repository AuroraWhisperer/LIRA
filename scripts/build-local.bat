@echo off
REM 使用本地 electron 缓存进行构建，避免重复下载

echo ========================================
echo 使用本地缓存构建 Windows 安装包
echo ========================================

REM 设置 electron 缓存目录（使用本地 node_modules 中的 electron）
set ELECTRON_SKIP_BINARY_DOWNLOAD=1

REM 设置 electron-builder 缓存目录
set ELECTRON_BUILDER_CACHE=%USERPROFILE%\.cache\electron-builder

REM 如果已有 release 目录，使用其中的 electron
if exist "release\win-unpacked" (
    echo [跳过] 检测到本地已有 electron 构建
)

REM 清理旧的构建输出（可选）
REM if exist "release\*.exe" del /Q "release\*.exe"

echo.
echo [1/2] 生成图标...
call npm run make:icon
if errorlevel 1 (
    echo [错误] 图标生成失败
    exit /b 1
)

echo.
echo [2/2] 构建安装包...
call electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist
if errorlevel 1 (
    echo [错误] 构建失败
    exit /b 1
)

echo.
echo ========================================
echo 构建完成！安装包位于 release 目录
echo ========================================
dir /B release\*.exe
