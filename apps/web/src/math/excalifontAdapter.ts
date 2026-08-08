/** Typed application boundary around the checksummed JavaScript-only Excalifont adapter. */
// The checksummed handoff is JavaScript-only; keep Chalkboard's type boundary
// outside the atomically replaced vendor directory.
// @ts-expect-error No declaration file is shipped in the verified handoff.
import { installMathLiveAdapter as installVendoredAdapter } from '../vendor/excalifont/mathlive-adapter.js';

interface MathLiveAdapterInstallation {
  disconnect(): void;
}

/** Installs the verified adapter and returns its complete teardown handle. */
export const installMathLiveAdapter =
  installVendoredAdapter as () => MathLiveAdapterInstallation;
