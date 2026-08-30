import { ConfigProvider, App as AntdApp, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AppLayout from '@renderer/components/layout/AppLayout'

/**
 * 应用根组件：Resonance HUD 主题（深色金调 / 纯直角 / 单一金色强调）
 * + zh_CN locale + 全局 message 上下文。
 */
export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          borderRadius: 0,
          colorPrimary: '#c9ac67',
          colorInfo: '#c9ac67',
          colorLink: '#c9ac67',
          colorTextBase: '#fafae9',
          colorBgLayout: '#14161a',
          colorBgContainer: '#1b1e23',
          colorBgElevated: '#1f2228',
          colorBorder: 'rgba(255, 255, 255, 0.14)',
          colorBorderSecondary: 'rgba(201, 172, 103, 0.16)',
          fontSize: 13
        },
        components: {
          Layout: {
            headerBg: 'transparent',
            siderBg: 'transparent',
            footerBg: 'transparent',
            bodyBg: '#14161a'
          },
          Tabs: {
            itemColor: 'rgba(250, 250, 233, 0.45)',
            itemHoverColor: '#fafae9',
            itemSelectedColor: '#e6cf95',
            inkBarColor: '#c9ac67'
          },
          Table: {
            headerBg: 'rgba(201, 172, 103, 0.08)',
            headerColor: '#e6cf95',
            rowHoverBg: 'rgba(201, 172, 103, 0.06)',
            borderColor: 'rgba(201, 172, 103, 0.14)',
            cellFontSize: 12
          },
          Switch: {
            colorPrimary: '#c9ac67',
            colorPrimaryHover: '#d9b45c'
          },
          Button: {
            primaryShadow: '0 0 12px rgba(201, 172, 103, 0.25)'
          },
          Progress: { defaultColor: '#c9ac67' },
          Tag: { defaultBg: 'rgba(201, 172, 103, 0.08)', defaultColor: '#e6cf95' }
        }
      }}
    >
      <AntdApp>
        <AppLayout />
      </AntdApp>
    </ConfigProvider>
  )
}
