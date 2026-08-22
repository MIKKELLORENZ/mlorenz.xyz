@echo off
REM pull_champion.cmd — the Windows entry point for the scheduled champion pull.
REM
REM Two reasons this file exists rather than pointing Task Scheduler at the shell
REM script directly. Task Scheduler cannot run a .sh; and `bash` on PATH here
REM resolves to the WindowsApps WSL shim, which has no Linux image installed and
REM exits instantly with an empty log, so Git Bash has to be named outright.
REM
REM Kept to ONE simple command with no nested quoting. An earlier version
REM timestamped the log from here and cmd tore the escaped quotes apart, leaving
REM it trying to execute a fragment of a date format string. The timestamp is
REM the shell script's job.
cd /d "%~dp0"
"C:\Program Files\Git\bin\bash.exe" -c "./pull_champion.sh >> training/watch.log 2>&1"
