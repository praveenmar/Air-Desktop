const fs = require('fs');
let content = fs.readFileSync('interceptor.js', 'utf8');

const targetRegex = /(_selectorDecision = this\._runSelectorEngineShadowComparison\([\s\S]*?boundedFieldContext,[\s]*\);)/;

const replacement = `$1

      // --- SHADOW PROOF PIPELINE INJECTION ---
      if (_selectorDecision && globalThis.__AIR_SELECTOR_ENGINE__?.assembleSelectorProofPacketV0) {
        const packet = globalThis.__AIR_SELECTOR_ENGINE__.assembleSelectorProofPacketV0(element);
        if (packet) {
          _selectorDecision.selectorProofPacketV0 = packet;
        }
      }
      // ---------------------------------------
`;

if (targetRegex.test(content)) {
    content = content.replace(targetRegex, replacement);
    fs.writeFileSync('interceptor.js', content);
    console.log('Successfully patched interceptor.js');
} else {
    console.log('Target not found!');
}
