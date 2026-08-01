@echo off
set DEBUG=electron-builder
set DEBUG_COLORS=true
npx electron-builder --win nsis --x64 %*
