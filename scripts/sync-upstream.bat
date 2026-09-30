@echo off
echo ========================================================
echo Syncing warex-api to warex-api-vercel (Preserving Vercel files)
echo ========================================================
node scripts\sync-upstream.js
pause
