import { useId, useState, type FormEvent } from 'react';
import type { CreatedLink } from '../api/types.js';
import { createLink } from '../api/links.js';
import { ApiError } from '../api/types.js';
import {
  mapCreateApiError,
  type CreateFormField,
} from '../lib/map-create-api-error.js';
import {
  normalizeCreatePayload,
  type CreateLinkFormValues,
} from '../lib/normalize-create-payload.js';

type Props = {
  onCreated: (link: CreatedLink) => void;
};

const initialValues: CreateLinkFormValues = {
  url: '',
  slug: '',
  expiresAtLocal: '',
  maxClicks: '',
};

export function CreateLinkForm({ onCreated }: Props) {
  const formId = useId();
  const formErrorId = `${formId}-form-error`;
  const slugHintId = `${formId}-slug-hint`;
  const [values, setValues] = useState<CreateLinkFormValues>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<CreateFormField, string>>
  >({});

  function clearErrors() {
    setFormError(null);
    setFieldErrors({});
  }

  function clearFieldError(field: CreateFormField) {
    setFieldErrors((prev) => {
      if (prev[field] == null) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearErrors();
    setSubmitting(true);
    try {
      const payload = normalizeCreatePayload(values);
      const created = await createLink(payload);
      onCreated(created);
      setValues(initialValues);
    } catch (err) {
      const raw =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unable to create link';
      const mapped = mapCreateApiError(raw);
      if (mapped.field != null) {
        setFieldErrors({ [mapped.field]: mapped.message });
      } else {
        setFormError(mapped.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fieldErrorId(field: CreateFormField): string {
    return `${formId}-${field}-error`;
  }

  function describedBy(
    field: CreateFormField,
    extraIds: string[] = [],
  ): string | undefined {
    const ids = [...extraIds];
    if (fieldErrors[field]) {
      ids.push(fieldErrorId(field));
    }
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  return (
    <section className="card card--create" aria-labelledby={`${formId}-title`}>
      <h2 className="card__title" id={`${formId}-title`}>
        Create a short link
      </h2>
      <form className="form-grid" onSubmit={handleSubmit} noValidate={false}>
        <div className={`field ${fieldErrors.url ? 'field--error' : ''}`}>
          <label htmlFor={`${formId}-url`}>Destination URL</label>
          <input
            id={`${formId}-url`}
            name="url"
            type="url"
            required
            placeholder="https://example.com"
            value={values.url}
            disabled={submitting}
            aria-invalid={fieldErrors.url ? true : undefined}
            aria-describedby={describedBy('url')}
            onChange={(e) => {
              clearFieldError('url');
              setValues((prev) => ({ ...prev, url: e.target.value }));
            }}
          />
          {fieldErrors.url ? (
            <p
              className="field__error"
              id={fieldErrorId('url')}
              role="alert"
            >
              {fieldErrors.url}
            </p>
          ) : null}
        </div>

        <div className="form-grid__row form-grid__row--optional">
          <div className={`field ${fieldErrors.slug ? 'field--error' : ''}`}>
            <label htmlFor={`${formId}-slug`}>Custom slug</label>
            <input
              id={`${formId}-slug`}
              name="slug"
              type="text"
              autoComplete="off"
              placeholder="Optional"
              value={values.slug}
              disabled={submitting}
              aria-invalid={fieldErrors.slug ? true : undefined}
              aria-describedby={describedBy('slug', [slugHintId])}
              onChange={(e) => {
                clearFieldError('slug');
                setValues((prev) => ({ ...prev, slug: e.target.value }));
              }}
            />
            <p className="field__hint" id={slugHintId}>
              Letters and numbers only
            </p>
            {fieldErrors.slug ? (
              <p
                className="field__error"
                id={fieldErrorId('slug')}
                role="alert"
              >
                {fieldErrors.slug}
              </p>
            ) : null}
          </div>
          <div
            className={`field ${fieldErrors.expiresAt ? 'field--error' : ''}`}
          >
            <label htmlFor={`${formId}-expires`}>Expires at</label>
            <input
              id={`${formId}-expires`}
              name="expiresAt"
              type="datetime-local"
              value={values.expiresAtLocal}
              disabled={submitting}
              aria-invalid={fieldErrors.expiresAt ? true : undefined}
              aria-describedby={describedBy('expiresAt')}
              onChange={(e) => {
                clearFieldError('expiresAt');
                setValues((prev) => ({
                  ...prev,
                  expiresAtLocal: e.target.value,
                }));
              }}
            />
            {fieldErrors.expiresAt ? (
              <p
                className="field__error"
                id={fieldErrorId('expiresAt')}
                role="alert"
              >
                {fieldErrors.expiresAt}
              </p>
            ) : null}
          </div>
          <div
            className={`field ${fieldErrors.maxClicks ? 'field--error' : ''}`}
          >
            <label htmlFor={`${formId}-max`}>Max clicks</label>
            <input
              id={`${formId}-max`}
              name="maxClicks"
              type="number"
              min={1}
              step={1}
              placeholder="Optional"
              value={values.maxClicks}
              disabled={submitting}
              aria-invalid={fieldErrors.maxClicks ? true : undefined}
              aria-describedby={describedBy('maxClicks')}
              onChange={(e) => {
                clearFieldError('maxClicks');
                setValues((prev) => ({ ...prev, maxClicks: e.target.value }));
              }}
            />
            {fieldErrors.maxClicks ? (
              <p
                className="field__error"
                id={fieldErrorId('maxClicks')}
                role="alert"
              >
                {fieldErrors.maxClicks}
              </p>
            ) : null}
          </div>
        </div>

        <div className="form-actions">
          <button
            className="btn btn--primary"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Creating…' : 'Create short link'}
          </button>
        </div>

        {formError ? (
          <p
            className="status-message status-message--error"
            id={formErrorId}
            role="alert"
            aria-live="assertive"
          >
            {formError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
