; 闪电Flash 安装向导自定义：完成页文案
;
; electron-builder 会自动把 buildResourcesDir（本项目为 build/）下的 installer.nsh
; include 进 NSIS 脚本，位置在 MUI_PAGE_FINISH 之前，因此这里定义的 MUI_FINISHPAGE_*
; 宏参数会生效（见 NSIS MUI2 Contrib/Modern UI 2/Pages/Finish.nsh）。
;
; 「运行程序」勾选框由 runAfterFinish 配置产生，MUI2 默认即为勾选状态
; （Finish.nsh 中只有定义 MUI_FINISHPAGE_RUN_NOTCHECKED 才会取消勾选），无需额外定义。
; $\r$\n 是 NSIS 的换行转义。

!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "闪电Flash 已安装到本机。$\r$\n$\r$\n「运行 闪电Flash」已默认勾选，点击「完成」即可立即打开程序。"
!define MUI_FINISHPAGE_RUN_TEXT "运行 闪电Flash"
