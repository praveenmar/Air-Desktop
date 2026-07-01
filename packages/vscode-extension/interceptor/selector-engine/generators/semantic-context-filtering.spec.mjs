import { expect } from 'chai';
import { canGenerateClass4, generateSemanticContextShadow } from './semantic-context-filtering.js';
import { SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

describe('Semantic Context Filtering Generator (Class 4)', () => {
  describe('canGenerateClass4 (Strict Mode Guards)', () => {
    it('rejects bounded-field with duplicateLabelCount > 1', () => {
      const proof = {
        proofType: 'bounded-field',
        fieldRelation: 'bounded-container',
        isValid: true,
        cleanParentSelector: '.form-group',
        cleanChildSelector: 'input',
        fieldLabelText: 'Email',
        duplicateLabelCount: 2
      };
      expect(canGenerateClass4(proof)).to.be.false;
    });

    it('accepts bounded-field with duplicateLabelCount <= 1', () => {
      const proof = {
        proofType: 'bounded-field',
        fieldRelation: 'bounded-container',
        isValid: true,
        cleanParentSelector: '.form-group',
        cleanChildSelector: 'input',
        fieldLabelText: 'Email',
        duplicateLabelCount: 1
      };
      expect(canGenerateClass4(proof)).to.be.true;
    });

    it('rejects bounded-field with fieldRelation: sibling-label (Class 5 leak)', () => {
      const proof = {
        proofType: 'bounded-field',
        fieldRelation: 'sibling-label',
        isValid: true,
        cleanParentSelector: '.form-group',
        cleanChildSelector: 'input',
        fieldLabelText: 'Email',
        duplicateLabelCount: 1
      };
      expect(canGenerateClass4(proof)).to.be.false;
    });

    it('rejects bounded-field with fieldRelation: label-for (Class 3 leak)', () => {
      const proof = {
        proofType: 'bounded-field',
        fieldRelation: 'label-for',
        isValid: true,
        cleanParentSelector: '.form-group',
        cleanChildSelector: 'input',
        fieldLabelText: 'Email',
        duplicateLabelCount: 1
      };
      expect(canGenerateClass4(proof)).to.be.false;
    });

    it('rejects table-row with uniqueRowBinding === false', () => {
      const proof = {
        proofType: 'table-row',
        isValid: true,
        tableSelector: 'table',
        actionSelector: 'button',
        rowIdentityTexts: ['John'],
        uniqueRowBinding: false,
        uniqueActionBinding: true
      };
      expect(canGenerateClass4(proof)).to.be.false;
    });

    it('accepts table-row with uniqueRowBinding === true', () => {
      const proof = {
        proofType: 'table-row',
        isValid: true,
        tableSelector: 'table',
        actionSelector: 'button',
        rowIdentityTexts: ['John'],
        uniqueRowBinding: true,
        uniqueActionBinding: true
      };
      expect(canGenerateClass4(proof)).to.be.true;
    });

    it('rejects generic-container with uniqueAnchorBinding === false', () => {
      const proof = {
        proofType: 'generic-container',
        isValid: true,
        containerSelectorKind: 'section',
        containerAnchorText: 'Billing',
        actionName: 'Save',
        actionRole: 'button',
        uniqueContainerBinding: true,
        uniqueAnchorBinding: false,
        uniqueActionBinding: true
      };
      expect(canGenerateClass4(proof)).to.be.false;
    });
  });

  describe('generateSemanticContextShadow', () => {
    it('generates table-row and bounded-field correctly without sorting or confidence', () => {
      const proofs = [
        {
          proofType: 'bounded-field',
          fieldRelation: 'bounded-container',
          isValid: true,
          cleanParentSelector: '.form-group',
          cleanChildSelector: 'input',
          fieldLabelText: 'Email',
          duplicateLabelCount: 1
        },
        {
          proofType: 'table-row',
          isValid: true,
          tableSelector: 'table',
          actionSelector: 'button',
          rowIdentityTexts: ['John Doe'],
          uniqueRowBinding: true,
          uniqueActionBinding: true
        }
      ];

      const candidates = generateSemanticContextShadow(proofs);
      expect(candidates.length).to.equal(2);
      
      // Should preserve original order (no internal sorting)
      expect(candidates[0].proof.proofType).to.equal('bounded-field');
      expect(candidates[0].selector).to.equal(`locator('.form-group').filter({ hasText: 'Email' }).locator('input')`);
      expect(candidates[0].metadata).to.deep.equal({});

      expect(candidates[1].proof.proofType).to.equal('table-row');
      expect(candidates[1].selector).to.equal(`locator('table').locator('tr, [role="row"]').filter({ hasText: 'John Doe' }).locator('button')`);
      expect(candidates[1].metadata).to.deep.equal({});
    });

    it('generates generic-container correctly with ARIA role', () => {
      const proofs = [{
        proofType: 'generic-container',
        isValid: true,
        containerSelectorKind: 'section',
        containerAnchorText: 'Billing Details',
        actionName: 'Save',
        actionRole: 'button',
        uniqueContainerBinding: true,
        uniqueAnchorBinding: true,
        uniqueActionBinding: true
      }];

      const candidates = generateSemanticContextShadow(proofs);
      expect(candidates.length).to.equal(1);
      expect(candidates[0].selector).to.equal(`locator('section').filter({ hasText: 'Billing Details' }).getByRole('button', { name: 'Save' })`);
      expect(candidates[0].metadata).to.deep.equal({});
    });
  });
});
