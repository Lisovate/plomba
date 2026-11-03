/**
 * The Plomba Cloud waitlist form. The fields are defined once here: the Cloud
 * page renders the form, the server validates against the same names and
 * limits, and re-renders it with the visitor's input when something is wrong.
 */

import { SITE } from './config.ts';
import { type Html, html } from './html.ts';
import { icon } from './icons.ts';

export const ROLES = [
  { value: 'shipping-line', label: 'Shipping line or shipowner' },
  { value: 'intermodal-rail', label: 'Intermodal or rail operator' },
  { value: 'trucking', label: 'Trucking company' },
  { value: 'container-owner', label: 'Container owner or leasing company' },
  { value: 'terminal-depot', label: 'Terminal or depot' },
  { value: 'other', label: 'Other' },
] as const;

export type Role = (typeof ROLES)[number]['value'];

export const roleLabel = (role: string): string =>
  ROLES.find((r) => r.value === role)?.label ?? role;

export const LIMITS = { name: 100, company: 120, email: 254, message: 2000 } as const;

/** A field people leave empty and form-filling bots don't. */
export const HONEYPOT_FIELD = 'website';

export const FORM_ACTION = '/api/waitlist';

export type TextField = 'name' | 'company' | 'role' | 'email' | 'message';
export type FieldName = TextField | 'consent';

export interface FormState {
  readonly values?: Partial<Record<TextField, string>> & { readonly consent?: boolean };
  readonly errors?: Partial<Record<FieldName, string>>;
}

/** Fields in the order they appear, for the error summary. */
const FIELD_ORDER: readonly FieldName[] = [
  'name',
  'company',
  'role',
  'email',
  'message',
  'consent',
];

export const fieldId = (name: string): string => `waitlist-${name}`;

function errorMessage(name: FieldName, message: string | undefined): Html | '' {
  return message
    ? html`<p class="field__error" id="${fieldId(name)}-error">${icon('circle-alert')}<span class="visually-hidden">Error:</span> ${message}</p>`
    : '';
}

function describedBy(name: FieldName, hint: boolean, error: boolean): Html | '' {
  const ids = [hint && `${fieldId(name)}-hint`, error && `${fieldId(name)}-error`].filter(Boolean);
  return ids.length ? html` aria-describedby="${ids.join(' ')}"` : '';
}

interface InputOptions {
  readonly name: Exclude<TextField, 'role' | 'message'>;
  readonly label: string;
  readonly type: 'text' | 'email';
  readonly autocomplete: string;
}

function input(options: InputOptions, state: FormState): Html {
  const error = state.errors?.[options.name];
  return html`<div class="field${error ? ' field--error' : ''}">
  <label class="field__label" for="${fieldId(options.name)}">${options.label}</label>
  ${errorMessage(options.name, error)}
  <input class="field__control" id="${fieldId(options.name)}" name="${options.name}" type="${options.type}" autocomplete="${options.autocomplete}" maxlength="${LIMITS[options.name]}" required value="${state.values?.[options.name] ?? ''}"${describedBy(options.name, false, Boolean(error))}${error ? html` aria-invalid="true"` : ''}>
</div>`;
}

function roleSelect(state: FormState): Html {
  const error = state.errors?.role;
  const selected = state.values?.role;
  return html`<div class="field${error ? ' field--error' : ''}">
  <label class="field__label" for="${fieldId('role')}">Type of company</label>
  ${errorMessage('role', error)}
  <select class="field__control" id="${fieldId('role')}" name="role" required${describedBy('role', false, Boolean(error))}${error ? html` aria-invalid="true"` : ''}>
    <option value=""${selected ? '' : html` selected`}>Choose one</option>
    ${ROLES.map((r) => html`<option value="${r.value}"${selected === r.value ? html` selected` : ''}>${r.label}</option>`)}
  </select>
</div>`;
}

function messageArea(state: FormState): Html {
  const error = state.errors?.message;
  return html`<div class="field field--wide${error ? ' field--error' : ''}">
  <label class="field__label" for="${fieldId('message')}">Anything we should know? <span class="field__optional">(optional)</span></label>
  <p class="field__hint" id="${fieldId('message')}-hint">Where you'd use Plomba, or which systems it should connect to.</p>
  ${errorMessage('message', error)}
  <textarea class="field__control" id="${fieldId('message')}" name="message" rows="4" maxlength="${LIMITS.message}"${describedBy('message', true, Boolean(error))}${error ? html` aria-invalid="true"` : ''}>${state.values?.message ?? ''}</textarea>
</div>`;
}

function consentBox(state: FormState): Html {
  const error = state.errors?.consent;
  return html`<div class="field field--wide field--checkbox${error ? ' field--error' : ''}">
  ${errorMessage('consent', error)}
  <div class="checkbox">
    <input class="checkbox__control" id="${fieldId('consent')}" name="consent" type="checkbox" value="yes" required${state.values?.consent ? html` checked` : ''}${describedBy('consent', false, Boolean(error))}${error ? html` aria-invalid="true"` : ''}>
    <label class="checkbox__label" for="${fieldId('consent')}">I agree that ${SITE.company} stores these details to contact me about Plomba Cloud, as described in the <a href="/privacy/">privacy note</a>.</label>
  </div>
</div>`;
}

/** The list of problems above the form, linking to each field. */
function errorSummary(state: FormState): Html {
  const errors = state.errors ?? {};
  const listed = FIELD_ORDER.filter((name) => errors[name]);
  return html`<div class="form-alert" role="alert" tabindex="-1" data-waitlist-alert${listed.length ? '' : html` hidden`}>
  ${
    listed.length
      ? html`<p class="form-alert__title">${icon('circle-alert')}Please check the form</p>
  <ul class="form-alert__list">${listed.map((name) => html`<li><a href="#${fieldId(name)}">${errors[name]}</a></li>`)}</ul>`
      : ''
  }
</div>`;
}

export function waitlistForm(state: FormState = {}): Html {
  return html`<form class="waitlist-form" id="waitlist-form" action="${FORM_ACTION}" method="post" data-waitlist
  data-error-network="We couldn't reach the server. Check your connection and try again."
  data-error-server="Something went wrong on our side. Please try again, or email ${SITE.email}.">
  ${errorSummary(state)}
  <div class="form-grid">
    ${input({ name: 'name', label: 'Your name', type: 'text', autocomplete: 'name' }, state)}
    ${input({ name: 'company', label: 'Company', type: 'text', autocomplete: 'organization' }, state)}
    ${roleSelect(state)}
    ${input({ name: 'email', label: 'Work email', type: 'email', autocomplete: 'email' }, state)}
    ${messageArea(state)}
    ${consentBox(state)}
  </div>
  <div class="honeypot" aria-hidden="true">
    <label for="${fieldId(HONEYPOT_FIELD)}">Leave this field empty</label>
    <input id="${fieldId(HONEYPOT_FIELD)}" name="${HONEYPOT_FIELD}" type="text" tabindex="-1" autocomplete="off">
  </div>
  <div class="form-actions">
    <button class="button button--primary" type="submit" data-waitlist-submit>Join the waitlist</button>
    <p class="form-actions__note">${icon('lock')}Nothing is shared or sold.</p>
  </div>
</form>
<div class="form-success" data-waitlist-success hidden tabindex="-1">
  ${icon('circle-check', 'icon form-success__icon')}
  <h3 class="form-success__title">You're on the waitlist</h3>
  <p>Thank you. We'll write to you about Plomba Cloud. If you'd like to start sooner, you can <a href="/open-source/">self-host Plomba</a> today.</p>
</div>`;
}
