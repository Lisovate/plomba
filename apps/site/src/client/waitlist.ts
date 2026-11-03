/**
 * Sends the waitlist form without leaving the page and shows the server's
 * answer beside the fields. The build strips the types and ships this file as
 * it is. Without it, the form posts normally and the server answers with a page.
 */

interface Issue {
  readonly path: string;
  readonly message: string;
}

interface Problem {
  readonly title?: string;
  readonly issues?: readonly Issue[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function alertIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-circle-alert');
  svg.append(use);
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

const errorId = (control: HTMLElement) => `${control.id}-error`;

function describedBy(control: HTMLElement, add: string | null, remove: string | null): void {
  const ids = (control.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id && id !== remove);
  if (add) ids.push(add);
  if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
  else control.removeAttribute('aria-describedby');
}

function controlFor(form: HTMLFormElement, name: string): HTMLElement | null {
  const control = form.elements.namedItem(name);
  return control instanceof HTMLElement ? control : null;
}

function clearErrors(form: HTMLFormElement, alert: HTMLElement): void {
  for (const error of form.querySelectorAll('.field__error')) error.remove();
  for (const field of form.querySelectorAll('.field--error'))
    field.classList.remove('field--error');
  for (const control of form.querySelectorAll<HTMLElement>('[aria-invalid]')) {
    control.removeAttribute('aria-invalid');
    describedBy(control, null, errorId(control));
  }
  alert.replaceChildren();
  alert.hidden = true;
}

function showAlert(alert: HTMLElement, title: string, list?: HTMLElement): void {
  alert.replaceChildren(element('p', 'form-alert__title', alertIcon(), title));
  if (list) alert.append(list);
  alert.hidden = false;
  alert.focus();
}

function showFieldErrors(
  form: HTMLFormElement,
  alert: HTMLElement,
  issues: readonly Issue[],
): void {
  const list = element('ul', 'form-alert__list');
  const seen = new Set<string>();
  for (const issue of issues) {
    const control = controlFor(form, issue.path);
    if (!control || seen.has(issue.path)) continue;
    seen.add(issue.path);

    const message = element(
      'p',
      'field__error',
      alertIcon(),
      element('span', 'visually-hidden', 'Error:'),
      ` ${issue.message}`,
    );
    message.id = errorId(control);
    (control.closest('.checkbox') ?? control).before(message);
    control.closest('.field')?.classList.add('field--error');
    control.setAttribute('aria-invalid', 'true');
    describedBy(control, message.id, null);

    const link = element('a', '', issue.message);
    link.href = `#${control.id}`;
    list.append(element('li', '', link));
  }
  showAlert(alert, 'Please check the form', list);
}

function enhance(form: HTMLFormElement): void {
  const alert = form.querySelector<HTMLElement>('[data-waitlist-alert]');
  const submit = form.querySelector<HTMLButtonElement>('[data-waitlist-submit]');
  const success = document.querySelector<HTMLElement>('[data-waitlist-success]');
  if (!alert || !submit || !success) return;
  const label = submit.textContent ?? '';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form, alert);
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: new FormData(form),
      });
      if (response.ok) {
        form.hidden = true;
        success.hidden = false;
        success.focus();
        return;
      }
      const problem: Problem = await response.json().catch(() => ({}));
      if (problem.issues?.length) showFieldErrors(form, alert, problem.issues);
      else showAlert(alert, problem.title ?? form.dataset.errorServer ?? '');
    } catch {
      showAlert(alert, form.dataset.errorNetwork ?? '');
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });
}

const form = document.querySelector<HTMLFormElement>('form[data-waitlist]');
if (form) enhance(form);
