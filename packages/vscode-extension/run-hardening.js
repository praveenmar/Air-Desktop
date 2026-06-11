const fs = require('fs');

// ---------------------------------------------------------
// 1. Patch interceptor.js (T1, T2, T3)
// ---------------------------------------------------------
let interceptorContent = fs.readFileSync('interceptor.js', 'utf8');

// T1: Hoist `let selectorProofPacketV0 = undefined;`
const decisionRegex = /let _selectorDecision = null;\s*try {/;
interceptorContent = interceptorContent.replace(decisionRegex, 
`let _selectorDecision = null;
    let selectorProofPacketV0 = undefined;
    try {`);

// T3: Update the injection block to push accessibility proof
const injectionRegex = /\/\/ --- SHADOW PROOF PIPELINE INJECTION ---[\s\S]*?\/\/ ---------------------------------------/;
const newInjection = `// --- SHADOW PROOF PIPELINE INJECTION ---
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

          const accessibility = _selectorDecision?.accessibility;
          if (accessibility && accessibility.role && accessibility.accessibleName) {
            proofs.push({
              source: "interceptor.js",
              proofType: "accessibility",
              role: accessibility.role,
              roleSource: accessibility.roleSource,
              accessibleName: accessibility.accessibleName,
              accessibleNameSource: accessibility.accessibleNameSource,
              labelledByIds: accessibility.labelledByIds,
              isNativeLabelAssociation: accessibility.isNativeLabelAssociation,
              blockedReason: accessibility.blockedReason
            });
          }

          selectorProofPacketV0 = globalThis.__AIR_SELECTOR_ENGINE__.assembleSelectorProofPacketV0(proofs);
        }
      } catch (e) {
        // Swallow error to protect primary interception
      }
      // ---------------------------------------`;

interceptorContent = interceptorContent.replace(injectionRegex, newInjection);

// T2: Fix accessibility field-name typo and add rich fields
const summaryRegex = /_summarizeSelectorEngineCompactAccessibility\(accessibilityEvidence\) \{[\s\S]*?return \{[\s\S]*?nameSource:[\s\S]*?\}\;/;
const newSummary = `_summarizeSelectorEngineCompactAccessibility(accessibilityEvidence) {
    if (!accessibilityEvidence || typeof accessibilityEvidence !== "object") return null;

    return {
      role: typeof accessibilityEvidence.role === "string" ? accessibilityEvidence.role : null,
      roleSource: typeof accessibilityEvidence.roleSource === "string" ? accessibilityEvidence.roleSource : null,
      accessibleName: typeof accessibilityEvidence.accessibleName === "string" ? accessibilityEvidence.accessibleName : null,
      accessibleNameSource: typeof accessibilityEvidence.accessibleNameSource === "string" ? accessibilityEvidence.accessibleNameSource : null,
      labelledByIds: Array.isArray(accessibilityEvidence.labelledByIds) ? accessibilityEvidence.labelledByIds : undefined,
      isNativeLabelAssociation: typeof accessibilityEvidence.isNativeLabelAssociation === "boolean" ? accessibilityEvidence.isNativeLabelAssociation : undefined,
      usedCanonicalTarget: accessibilityEvidence.usedCanonicalTarget === true,
      blockedReason: typeof accessibilityEvidence.blockedReason === "string" ? accessibilityEvidence.blockedReason : null,
    };`;

interceptorContent = interceptorContent.replace(summaryRegex, newSummary);
fs.writeFileSync('interceptor.js', interceptorContent);
console.log('Patched interceptor.js (T1, T2, T3a)');

// ---------------------------------------------------------
// 2. Patch index.js (T3b)
// ---------------------------------------------------------
const indexPath = 'interceptor/selector-engine/index.js';
let indexContent = fs.readFileSync(indexPath, 'utf8');

const orchestratorLoopRegex = /for \(const proof of proofs\) \{[\s\S]*?\}\s*\}/;
const newOrchestratorLoop = `for (const proof of proofs) {
      if (proof.identityType === 'data-testid' || proof.identityType === 'id') {
        const candidate = generateDirectIdentityShadow(proof);
        if (candidate) candidates.push(candidate);
      } else if (proof.proofType === 'accessibility') {
        // Slice 2 (Semantic Identity) will consume accessibility proof here.
      }
    }`;

indexContent = indexContent.replace(orchestratorLoopRegex, newOrchestratorLoop);
fs.writeFileSync(indexPath, indexContent);
console.log('Patched index.js (T3b)');

// ---------------------------------------------------------
// 3. Patch role-name.js (T5)
// ---------------------------------------------------------
const rolePath = 'interceptor/selector-engine/accessibility/role-name.js';
let roleContent = fs.readFileSync(rolePath, 'utf8');

if (!roleContent.includes('isAccessibleNameDynamic')) {
  const dynamicFn = `
function isAccessibleNameDynamic(name) {
  if (!name) return false;
  return /[\\d$€£¥]|selected|\\d{1,2}\\/\\d{1,2}/i.test(name);
}
`;
  // Insert at top after imports
  roleContent = roleContent.replace(/import.*?;\n\n/, match => match + dynamicFn);
}

// Add accessibleNameIsDynamic to the base object and winner return
roleContent = roleContent.replace(/accessibleNameSource: 'none',/, `accessibleNameSource: 'none',\n    accessibleNameIsDynamic: false,`);

const winnerReturnRegex = /accessibleName: winner\.evidence\.accessibleName,\n\s*accessibleNameSource: winner\.evidence\.accessibleNameSource \|\| 'none',/;
const newWinnerReturn = `accessibleName: winner.evidence.accessibleName,
    accessibleNameIsDynamic: isAccessibleNameDynamic(winner.evidence.accessibleName),
    accessibleNameSource: winner.evidence.accessibleNameSource || 'none',`;
roleContent = roleContent.replace(winnerReturnRegex, newWinnerReturn);

fs.writeFileSync(rolePath, roleContent);
console.log('Patched role-name.js (T5)');

console.log('Hardening patches applied successfully.');
