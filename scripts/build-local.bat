@echo off
REM 使用本地 electron 缓存进行构建，避免重复下载

echo ========================================
echo 使用本地缓存构建 Windows 安装包
echo ========================================

REM 设置 electron-builder 缓存目录
set ELECTRON_BUILDER_CACHE=%USERPROFILE%\.cache\electron-builder

echo.
echo 生成图标并构建安装包...
call npm run dist:win:local
if errorlevel 1 (
    echo [错误] 构建失败
    exit /b 1
)

echo.
echo ========================================
echo 构建完成！安装包位于 release 目录
echo ========================================
dir /B release\*.exe
