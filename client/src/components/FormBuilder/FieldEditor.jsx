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
      className="field-card"
    >
      <div className="field-top">
        <span className="field-kind">
          <span aria-hidden="true" className="grip">⠿</span>
          <span className="field-num" aria-hidden="true">{index + 1}</span>
          <span className="sr-only">{index + 1}. </span>{typeName}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
            aria-label={`Move field ${index + 1} up`} className="icon-btn">▲</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1}
            aria-label={`Move field ${index + 1} down`} className="icon-btn">▼</button>
          <button type="button" onClick={onDelete}
            aria-label={`Delete field ${index + 1}`} className="btn btn-danger btn-small">Delete</button>
        </div>
      </div>

      <div className="stack">
        <div>
          <label htmlFor={id('label')} className="label">Question shown to the respondent</label>
          <input id={id('label')} value={field.label} onChange={(e) => onChange({ label: e.target.value })} className="input" />
        </div>

        <label className="check">
          <input type="checkbox" checked={field.is_required} onChange={(e) => onChange({ is_required: e.target.checked })} />
          Required (must be filled in)
        </label>

      {field.field_type === 'text' && (
        <div>
          <label htmlFor={id('format')} className="label">Check the answer looks like</label>
          <select id={id('format')} value={field.format} onChange={(e) => onChange({ format: e.target.value })}
            className="select">
            <option value="">Anything</option>
            <option value="email">An email address</option>
            <option value="number">A number</option>
          </select>
        </div>
      )}
      {(field.field_type === 'email' || field.field_type === 'number') && (
        <p className="hint" style={{ margin: 0 }}>
          The answer is automatically checked to be {field.field_type === 'email' ? 'an email address' : 'a number'}.
        </p>
      )}
      {field.field_type === 'dropdown' && (
        <div>
          <label htmlFor={id('options')} className="label">Choices (one per line, at least 2)</label>
          <textarea id={id('options')} rows={4} value={field.optionsText} onChange={(e) => onChange({ optionsText: e.target.value })}
            className="textarea" />
        </div>
      )}
      {field.field_type === 'file' && (
        <div>
          <label htmlFor={id('size')} className="label">Largest file allowed (MB)</label>
          <input id={id('size')} type="number" min="1" max="25" value={field.maxFileSizeMB}
            onChange={(e) => onChange({ maxFileSizeMB: e.target.value })}
            className="input" style={{ width: 96 }} />
        </div>
      )}
      </div>
    </li>
  );
}
