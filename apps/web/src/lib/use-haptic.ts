// Tiny wrapper over the Vibration API. No-ops on devices that don't support
// vibration (iOS Safari, desktop) — never throws.
export function useHaptic() {
  return {
    tap: () => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10);
      }
    },
    success: () => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([15, 30, 15]);
      }
    },
    error: () => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([40, 40, 40]);
      }
    },
  };
}
