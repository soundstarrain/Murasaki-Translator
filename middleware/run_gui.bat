@echo off
cd /d %~dp0
title Murasaki Translator GUI
echo Starting Streamlit Interface...
echo Ensure you have streamlit installed: pip install streamlit
echo.
streamlit run app.py
pause
