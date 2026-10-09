import { Component, computed, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

/** Campos de texto compartidos por editor y configuración; las reglas pertenecen al formulario. */
@Component({
  selector: 'app-quote-field',
  imports: [ReactiveFormsModule],
  template: `
    <label [for]="fieldId()"
      >{{ label() }}
      @if (required()) {
        <span aria-hidden="true">*</span>
      }
    </label>
    @if (multiline()) {
      <textarea
        [id]="fieldId()"
        [formControl]="control()"
        rows="3"
        [attr.aria-required]="required()"
        [attr.aria-invalid]="!!error()"
        [attr.aria-describedby]="descriptionIds()"
      ></textarea>
    } @else {
      <input
        [id]="fieldId()"
        [type]="type()"
        [formControl]="control()"
        [attr.inputmode]="inputMode()"
        [attr.aria-required]="required()"
        [attr.aria-invalid]="!!error()"
        [attr.aria-describedby]="descriptionIds()"
      />
    }
    @if (hint()) {
      <p class="hint" [id]="fieldId() + '-hint'">{{ hint() }}</p>
    }
    @if (error()) {
      <p class="error" [id]="fieldId() + '-error'">{{ error() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    label {
      display: block;
      margin-bottom: 0.35rem;
      font-weight: 600;
      font-size: 0.9rem;
    }
    input,
    textarea {
      width: 100%;
      min-height: 2.75rem;
      padding: 0.6rem 0.7rem;
      border: 1px solid #8396a3;
      border-radius: 0.35rem;
      background: white;
      color: var(--text);
      font: inherit;
    }
    textarea {
      resize: vertical;
    }
    [aria-invalid='true'] {
      border-color: #a52821;
    }
    .hint,
    .error {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      overflow-wrap: anywhere;
    }
    .hint {
      color: var(--muted);
    }
    .error {
      color: #a52821;
    }
  `,
})
export class QuoteField {
  readonly control = input.required<FormControl<string>>();
  readonly fieldId = input.required<string>();
  readonly label = input.required<string>();
  readonly type = input('text');
  readonly inputMode = input('text');
  readonly required = input(false);
  readonly multiline = input(false);
  readonly error = input('');
  readonly hint = input('');
  readonly descriptionIds = computed(
    () =>
      [this.hint() ? `${this.fieldId()}-hint` : '', this.error() ? `${this.fieldId()}-error` : '']
        .filter(Boolean)
        .join(' ') || null,
  );
}
