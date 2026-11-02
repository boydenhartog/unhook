import { useState } from 'react';
import { Check, Globe2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { normalizeDomain } from '../service';
import type { Settings } from '../types';

export function BlocklistPage({
  settings,
  busy,
  save,
}: {
  settings: Settings;
  busy: boolean;
  save: (settings: Settings) => Promise<boolean>;
}) {
  const [domain, setDomain] = useState(''),
    [query, setQuery] = useState(''),
    [editing, setEditing] = useState<string | null>(null),
    [editValue, setEditValue] = useState(''),
    [error, setError] = useState<string | null>(null);
  const commit = async (value: string, previous?: string) => {
    try {
      const normalized = normalizeDomain(value);
      if (settings.domains.some(item => item === normalized && item !== previous))
        throw new Error('That website is already in your blocklist.');
      const domains = previous
        ? settings.domains.map(item => (item === previous ? normalized : item))
        : [...settings.domains, normalized];
      setError(null);
      if (await save({ ...settings, domains })) {
        setDomain('');
        setEditing(null);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please enter a valid website.');
    }
  };
  const filtered = settings.domains.filter(item => item.includes(query.toLowerCase().trim()));
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">MAKE A LITTLE ROOM</div>
          <h1>Your blocklist</h1>
          <p>Choose the websites that can wait until later.</p>
        </div>
        <span className="subtle-count">{settings.domains.length} websites</span>
      </header>
      <section className="content-panel">
        <h2>Add a website</h2>
        <p>Enter a domain or paste a URL. We’ll take care of the address.</p>
        <form
          className="add-domain-form"
          onSubmit={event => {
            event.preventDefault();
            void commit(domain);
          }}
        >
          <label className="input-with-icon">
            <Globe2 size={18} />
            <input
              aria-label="Website address"
              placeholder="e.g. youtube.com"
              value={domain}
              disabled={busy}
              onChange={event => setDomain(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={busy || !domain.trim()}>
            <Plus size={17} />
            Add website
          </button>
        </form>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="field-hint">
          <Check size={14} />
          The domain and its www version are included. Add other subdomains separately.
        </div>
      </section>
      <section className="content-panel blocklist-panel">
        <div className="section-heading">
          <h2>
            Blocked websites <span className="count-badge">{settings.domains.length}</span>
          </h2>
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search blocklist"
              placeholder="Find a website…"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="website-list">
          {filtered.map(item => (
            <div className="website-row" key={item}>
              <span className={`site-mark mark-${item.charCodeAt(0) % 5}`}>
                {item.charAt(0).toUpperCase()}
              </span>
              {editing === item ? (
                <form
                  className="website-edit"
                  onSubmit={event => {
                    event.preventDefault();
                    void commit(editValue, item);
                  }}
                >
                  <input
                    aria-label={`Edit ${item}`}
                    autoFocus
                    value={editValue}
                    disabled={busy}
                    onChange={event => setEditValue(event.target.value)}
                  />
                  <button className="icon-button" aria-label="Save website" disabled={busy}>
                    <Check size={18} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Cancel edit"
                    onClick={() => setEditing(null)}
                    disabled={busy}
                  >
                    <X size={18} />
                  </button>
                </form>
              ) : (
                <>
                  <div className="website-info">
                    <strong>{item}</strong>
                    <span>Included in every focus session</span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${item}`}
                    disabled={busy}
                    onClick={() => {
                      setEditing(item);
                      setEditValue(item);
                      setError(null);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Remove ${item}`}
                    disabled={busy}
                    onClick={() =>
                      void save({
                        ...settings,
                        domains: settings.domains.filter(domain => domain !== item),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty-state">
            <Globe2 size={28} />
            <h3>{settings.domains.length ? 'No matching websites' : 'A clean slate'}</h3>
            <p>
              {settings.domains.length
                ? 'Try a different search.'
                : 'Add your first distraction above. You can change your list anytime.'}
            </p>
          </div>
        )}
      </section>
      <p className="page-note">
        Website blocking applies while focus mode is active. Apps and unlisted subdomains may remain
        accessible.
      </p>
    </>
  );
}
