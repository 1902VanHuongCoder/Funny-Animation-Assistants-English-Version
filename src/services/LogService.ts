import { saveAs } from 'file-saver'

/**
 * Log service
 * Used to collect runtime logs and support export to file
 */
class LogService {
  private static instance: LogService
  private logs: string[] = []
  private isCollecting = false

  private constructor() {
    // Singleton
  }

  static getInstance(): LogService {
    if (!LogService.instance) {
      LogService.instance = new LogService()
    }
    return LogService.instance
  }

  /**
   * Start collecting logs
   */
  startCollection() {
    this.logs = []
    this.isCollecting = true
    this.addLog('========== Log Collection Started ==========')
    this.addLog(`Time: ${new Date().toLocaleString()}`)
  }

  /**
   * Stop collecting logs
   */
  stopCollection() {
    this.isCollecting = false
    this.addLog('========== Log Collection Ended ==========')
  }

  /**
   * Add log message
   */
  addLog(message: string) {
    if (!this.isCollecting) return
    this.logs.push(message)
  }

  /**
   * Export logs to file
   */
  exportLogs(filename = 'scene_preview_log.md') {
    if (this.logs.length === 0) return

    const content = this.logs.join('\n')
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    saveAs(blob, filename)
  }

  /**
   * Get current log content
   */
  getLogs(): string {
    return this.logs.join('\n')
  }
}

export const logService = LogService.getInstance()
