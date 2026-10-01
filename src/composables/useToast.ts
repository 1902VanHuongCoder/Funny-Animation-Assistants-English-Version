import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastMessage {
    id: string
    message: string
    type: ToastType
    duration: number
}

// Global toast state
const toasts = ref<ToastMessage[]>([])
let toastIdCounter = 0

export function useToast() {
    /**
     * Show toast message
     * @param message Message content
     * @param type Message type
     * @param duration Duration (ms), 0 means do not auto close
     */
    function showToast(
        message: string,
        type: ToastType = 'info',
        duration = 3000
    ) {
        const id = `toast-${++toastIdCounter}`
        const toast: ToastMessage = {
            id,
            message,
            type,
            duration
        }

        toasts.value.push(toast)

        // Auto remove
        if (duration > 0) {
            setTimeout(() => {
                removeToast(id)
            }, duration)
        }

        return id
    }

    /**
     * Remove specified toast
     */
    function removeToast(id: string) {
        const index = toasts.value.findIndex(t => t.id === id)
        if (index !== -1) {
            toasts.value.splice(index, 1)
        }
    }

    /**
     * Clear all toasts
     */
    function clearAllToasts() {
        toasts.value = []
    }

    // Convenience methods
    function success(message: string, duration = 2000) {
        return showToast(message, 'success', duration)
    }

    function error(message: string, duration = 3000) {
        return showToast(message, 'error', duration)
    }

    function warning(message: string, duration = 3000) {
        return showToast(message, 'warning', duration)
    }

    function info(message: string, duration = 3000) {
        return showToast(message, 'info', duration)
    }

    return {
        toasts,
        showToast,
        removeToast,
        clearAllToasts,
        success,
        error,
        warning,
        info
    }
}
