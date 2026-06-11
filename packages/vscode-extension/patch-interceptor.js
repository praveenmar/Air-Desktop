const fs = require('fs');
let content = fs.readFileSync('interceptor.js', 'utf8');

const injectionRegex = /\/\/ --- SHADOW PROOF PIPELINE INJECTION ---[\s\S]*?\/\/ ---------------------------------------/;
const newInjection = `// --- SHADOW PROOF PIPELINE INJECTION ---
      let selectorProofPacketV0 = undefined;
      try {
        if (globalThis.__AIR_SELECTOR_ENGINE__?.assembleSelectorProofPacketV0) {
          const proofs = [];
          
          const testId = element.getAttribute ? element.getAttribute('data-testid') : null;
          if (testId) {
            proofs.push({
              source: "interceptor.js",
              identityType: "data-testid",
              value: testId,
              isLikelyDynamic: false
            });
          }

          const id = element.id || null;
          if (id) {
            proofs.push({
              source: "interceptor.js",
              identityType: "id",
              value: id,
              isLikelyDynamic: this._isLikelyDynamicId(id)
            });
          }

          selectorProofPacketV0 = globalThis.__AIR_SELECTOR_ENGINE__.assembleSelectorProofPacketV0(proofs);
        }
      } catch (e) {
        // Swallow error to protect primary interception
      }
      // ---------------------------------------`;

content = content.replace(injectionRegex, newInjection);

const returnRegex = /_selectorDecision,\s*\};/;
const newReturn = `_selectorDecision,
      ...(selectorProofPacketV0 ? { selectorEngine: { selectorProofPacketV0 } } : {})
    };`;

content = content.replace(returnRegex, newReturn);

fs.writeFileSync('interceptor.js', content);
console.log('Successfully patched interceptor.js');
