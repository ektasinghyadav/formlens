// FieldEditor.jsx - one field's settings card inside the builder. Requirements: FR-1.1, FR-1.2.
// Reorder two ways (D-8): drag the card (native browser drag-and-drop) or press the up/down
// buttons (keyboard-friendly).
import { FIELD_TYPES } from './formModel.js';

export default function FieldEditor({ field, index, total, onChange, onMove, onDelete, drag }) {
  const id = (name) => `${field.key}-${name}`;
  const typeName = FIELD_TYPES.find((t) => t.type === field.field_type).name;

  return (
    <li
      draggable
      onDragStart={() => drag.start(index)}
      onDragOver={(e) => e.preventDefault()} // needed, otherwise the browser refuses drops
      onDrop={() => drag.drop(index)}
      className="rounded border border-gray-300 bg-white p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">
          <span aria-hidden="true" className="mr-2 cursor-grab">⠿</span>
          {index + 1}. {typeName}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
            aria-label={`Move field ${index + 1} up`} className="rounded border px-2 disabled:opacity-40">▲</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1}
            aria-label={`Move field ${index + 1} down`} className="rounded border px-2 disabled:opacity-40">▼</button>
          <button type="button" onClick={onDelete}
            aria-label={`Delete field ${index + 1}`} className="rounded border border-red-700 px-2 text-red-800">Delete</button>
        </div>
      </div>

      <label htmlFor={id('label')} className="block text-sm font-medium">Question shown to the respondent</label>
      <input id={id('label')} value={field.label} onChange={(e) => onChange({ label: e.target.value })}
        className="mb-3 mt-1 w-full rounded border border-gray-400 px-3 py-2" />

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={field.is_required} onChange={(e) => onChange({ is_required: e.target.checked })} />
        Required (must be filled in)
      </label>

      {field.field_type === 'text' && (
        <div>
          <label htmlFor={id('format')} className="block text-sm font-medium">Check the answer looks like</label>
          <select id={id('format')} value={field.format} onChange={(e) => onChange({ format: e.target.value })}
            className="mt-1 rounded border border-gray-400 px-3 py-2">
            <option value="">Anything</option>
            <option value="email">An email address</option>
            <option value="number">A number</option>
          </select>
        </div>
      )}
      {(field.field_type === 'email' || field.field_type === 'number') && (
        <p className="text-sm text-gray-600">
          The answer is automatically checked to be {field.field_type === 'email' ? 'an email address' : 'a number'}.
        </p>
      )}
      {field.field_type === 'dropdown' && (
        <div>
          <label htmlFor={id('options')} className="block text-sm font-medium">Choices (one per line, at least 2)</label>
          <textarea id={id('options')} rows={4} value={field.optionsText} onChange={(e) => onChange({ optionsText: e.target.value })}
            className="mt-1 w-full rounded border border-gray-400 px-3 py-2" />
        </div>
      )}
      {field.field_type === 'file' && (
        <div>
          <label htmlFor={id('size')} className="block text-sm font-medium">Largest file allowed (MB)</label>
          <input id={id('size')} type="number" min="1" max="25" value={field.maxFileSizeMB}
            onChange={(e) => onChange({ maxFileSizeMB: e.target.value })}
            className="mt-1 w-24 rounded border border-gray-400 px-3 py-2" />
        </div>
      )}
    </li>
  );
}
