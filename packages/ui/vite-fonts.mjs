/**
 * The licences of the fonts styles.css bundles (packages/ui/src/fonts), for a host's Vite build to
 * ship beside them: the OFL and the Bitstream Vera licence both ask that the licence travel with
 * the font files. Add `fontLicences()` to the build's plugins; it writes them under `fonts/`.
 */
import { readFileSync } from 'node:fs';

const LICENCES = ['IBMPlex-OFL.txt', 'JetBrainsMono-OFL.txt', 'TauSymbols-LICENSE.txt'];

export function fontLicences() {
  return {
    name: 'tau-font-licences',
    apply: 'build',
    generateBundle() {
      for (const name of LICENCES) {
        this.emitFile({
          type: 'asset',
          fileName: `fonts/${name}`,
          source: readFileSync(new URL(`./src/fonts/${name}`, import.meta.url)),
        });
      }
    },
  };
}
