import { registerPlugin } from '@capacitor/core';

export type VixDiagnosticEntry = {
  id: string;
  timestamp: number;
  packageName: string;
  idleMs: number;
  typedReply: string;
  diagnosis: string;
};

export interface VixAccessibilityPluginInterface {
  isEnabled(): Promise<{ enabled: boolean }>;
  openSettings(): Promise<void>;
  getLog(): Promise<{ entries: VixDiagnosticEntry[] }>;
  clearLog(): Promise<void>;
  openApp(options: { packageNames: string[] }): Promise<{ opened: boolean; packageName?: string }>;
}

// On native Android this resolves to the real VixAccessibilityPlugin.kt.
// In a plain browser (e.g. `next dev`) there's no native implementation,
// so every call below is wrapped in try/catch by the caller.
const VixAccessibility = registerPlugin<VixAccessibilityPluginInterface>('VixAccessibility');

export default VixAccessibility;
