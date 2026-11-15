// Unit tests for the Form Builder helpers. Requirements: FR-1.1, FR-1.2. (Sprint 2)
import { describe, it, expect } from 'vitest';
import { newField, fromApiField, toApiForm, moveItem } from '../components/FormBuilder/formModel.js';

describe('moveItem', () => {
  it('moves an item and does not change the original list', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(list).toEqual(['a', 'b', 'c']);
  });
  it('ignores moves off either end', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 2)).toBe(list);
  });
});

describe('new fields have valid starting values (NFR-4.1)', () => {
  it('gives every type a label, and a dropdown two options', () => {
    for (const t of ['text', 'email', 'number', 'dropdown', 'file']) expect(newField(t).label).not.toBe('');
    expect(newField('dropdown').optionsText.split('\n')).toHaveLength(2);
  });
  it('gives each new field its own key', () => {
    expect(newField('text').key).not.toBe(newField('text').key);
  });
});

describe('toApiForm / fromApiField', () => {
  it('builds the validations each type needs and omits unused ones', () => {
    const dropdown = { ...newField('dropdown'), optionsText: ' Tezpur \n\nGuwahati\n' };
    const file = { ...newField('file'), maxFileSizeMB: '10' };
    const text = { ...newField('text'), format: 'email' };
    const plain = newField('number');
    const body = toApiForm('T', [dropdown, file, text, plain]);
    expect(body.fields[0].validations).toEqual({ options: ['Tezpur', 'Guwahati'] });
    expect(body.fields[1].validations).toEqual({ maxFileSizeMB: 10 });
    expect(body.fields[2].validations).toEqual({ format: 'email' });
    expect(body.fields[3].validations).toBeNull();
    expect('field_id' in body.fields[0]).toBe(false); // new fields have no id yet
  });
  it('keeps the server id of an existing field so the edit does not recreate it', () => {
    const apiField = { field_id: 'abc', field_type: 'dropdown', label: 'City', is_required: true, position: 0, validations: { options: ['x', 'y'] } };
    const editable = fromApiField(apiField);
    expect(editable.optionsText).toBe('x\ny');
    expect(toApiForm('T', [editable]).fields[0]).toEqual({
      field_id: 'abc', field_type: 'dropdown', label: 'City', is_required: true, validations: { options: ['x', 'y'] },
    });
  });
});
