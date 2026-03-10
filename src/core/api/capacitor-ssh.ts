import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

interface SSHDeployPlugin {
  deploy(options: {
    host: string
    sshPort?: number
    sshUser?: string
    sshPassword?: string
    smToken: string
    smPort?: number
  }): Promise<{
    success: boolean
    message: string
    existingToken?: string
    existingPort?: number
  }>
  addListener(
    event: 'deployLog',
    handler: (data: { log: string }) => void,
  ): Promise<PluginListenerHandle>
}

const isCapacitor = !!(window as unknown as { Capacitor?: unknown }).Capacitor

export const SSHDeploy = isCapacitor
  ? registerPlugin<SSHDeployPlugin>('SSHDeploy')
  : null

export { isCapacitor }
