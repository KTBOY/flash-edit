import { Typography } from 'antd'
import { SITE_URL, strings } from '@renderer/locales/zh'
import { getApi } from '@renderer/services/ipc.service'
import { useGameStore } from '@renderer/store/useGameStore'

/**
 * 关于区：开发 / 运行时版本 / 个人网站。
 * 网址走主进程 shell.openExternal（http/https 白名单），在系统默认浏览器打开。
 */
export default function AboutSection() {
  const appInfo = useGameStore((s) => s.appInfo)

  return (
    <div className="about-rows">
      <div className="about-row">
        <span className="k">{strings.settings.aboutDevLabel}</span>
        <span className="v">{strings.settings.aboutDev}</span>
      </div>
      <div className="about-row">
        <span className="k">{strings.settings.aboutRuntimeLabel}</span>
        <span className="v">
          Electron {appInfo?.electron ?? strings.settings.aboutRuntimeUnknown}
        </span>
      </div>
      <div className="about-row">
        <span className="k">{strings.settings.aboutSiteLabel}</span>
        <span className="v">
          <Typography.Link onClick={() => getApi().openExternal(SITE_URL)}>
            {SITE_URL}
          </Typography.Link>
        </span>
      </div>
    </div>
  )
}
