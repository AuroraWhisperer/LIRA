@echo off
REM QQ音乐API分析工具 - Windows快速开始脚本

echo ==========================================
echo   QQ音乐客户端API分析工具
echo ==========================================
echo.

REM 检查Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo X 未找到Node.js，请先安装 Node.js
    pause
    exit /b 1
)

node --version
echo.

echo 请选择操作：
echo.
echo 1. 启动代理服务器 (简单HTTP代理，不支持HTTPS解密)
echo 2. 分析捕获的请求 (从 captured-requests.jsonl)
echo 3. 解析HAR文件 (从Fiddler导出)
echo 4. 查看使用说明
echo.
echo 推荐流程：
echo   -^> 使用 Fiddler 抓包 (参考 FIDDLER-GUIDE.md)
echo   -^> 导出为 HAR 文件
echo   -^> 选择选项 3 解析HAR
echo   -^> 选择选项 2 分析请求
echo.

set /p choice="请输入选项 (1-4): "

if "%choice%"=="1" goto proxy
if "%choice%"=="2" goto analyze
if "%choice%"=="3" goto parse_har
if "%choice%"=="4" goto help
echo 无效的选项
pause
exit /b 1

:proxy
echo.
echo 启动代理服务器...
echo 配置系统代理: 127.0.0.1:8888
echo 按 Ctrl+C 停止
echo.
node proxy-server.js
goto end

:analyze
echo.
if not exist "captured-requests.jsonl" (
    echo X 未找到 captured-requests.jsonl
    echo 请先使用选项3解析HAR文件，或使用选项1启动代理
    pause
    exit /b 1
)
node analyze-requests.js
pause
goto end

:parse_har
echo.
set /p har_path="请输入HAR文件路径: "
if not exist "%har_path%" (
    echo X 文件不存在: %har_path%
    pause
    exit /b 1
)
node parse-har.js "%har_path%"
pause
goto end

:help
echo.
type README.md
echo.
echo 详细的Fiddler使用指南: FIDDLER-GUIDE.md
pause
goto end

:end
