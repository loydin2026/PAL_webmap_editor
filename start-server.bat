@echo off
chcp 65001 >nul
echo 正在启动仙剑地图编辑器服务器...
echo.

cd /d "%~dp0"

if not exist "server.js" (
    echo 错误：未找到 server.js 文件！
    pause
    exit /b 1
)

:: 跳过 npm install，直接运行
set NODE_EXE=node.exe

if exist "%NODE_EXE%" (
    "%NODE_EXE%" server.js
) else (
    echo 未找到 Node.js，请检查路径！
    pause
    exit /b 1
)

if errorlevel 1 (
    echo.
    echo 服务器启动失败！
    pause
)