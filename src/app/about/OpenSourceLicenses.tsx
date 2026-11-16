// File → About → Open-source licenses (M10-01, ADR-027 D-48): every runtime
// package with its version, license and full license text, in the app. The
// data is a lazily imported chunk (licenseData.ts), from the offline cache like
// the rest of the app. The list filters on Enter or the Search button only, as
// every search in the app does (rule 3).
import { Search20Regular } from '@fluentui/react-icons/svg/search';
import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { Button, Spinner, TextField } from '../../ui/components';
import type { LicenseData, LicensePackage } from './licenseData';
import { filterPackages } from './licenses';

type Loaded = { state: 'loading' } | { state: 'ready'; data: LicenseData } | { state: 'failed' };

export function OpenSourceLicenses() {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    import('./licenseData').then(
      (m) => {
        if (live) setLoaded({ state: 'ready', data: m.default });
      },
      () => {
        if (live) setLoaded({ state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const data = loaded.state === 'ready' ? loaded.data : undefined;
  const shown = useMemo(() => (data ? filterPackages(data.packages, query) : []), [data, query]);

  const onSearch = (e: SyntheticEvent): void => {
    e.preventDefault();
    setQuery(input.trim());
  };

  if (loaded.state === 'loading')
    return (
      <p className="about-licenses-status">
        <Spinner label={t('about.licenses.loading')} />
      </p>
    );
  if (!data)
    return (
      <p className="about-licenses-status" role="alert">
        {t('about.licenses.failed')}
      </p>
    );

  const total = data.packages.length;
  return (
    <div className="about-licenses" data-testid="about-licenses">
      <form className="about-licenses-search" role="search" onSubmit={onSearch}>
        <TextField
          label={t('about.licenses.search')}
          type="search"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
        />
        <Button type="submit" label={t('about.licenses.searchButton')} icon={<Search20Regular />} />
        {query ? (
          <Button
            variant="subtle"
            label={t('about.licenses.clear')}
            onClick={() => {
              setInput('');
              setQuery('');
            }}
          />
        ) : null}
      </form>
      <p className="about-licenses-count" role="status" data-testid="about-licenses-count">
        {query
          ? t('about.licenses.matches', {
              count: shown.length,
              shown: format.number(shown.length),
              total: format.number(total),
            })
          : t('about.licenses.count', { count: total, total: format.number(total) })}
      </p>
      <ul className="about-license-list">
        {shown.map((p) => (
          <LicenseItem key={`${p.name}@${p.version}`} pkg={p} texts={data.texts} />
        ))}
      </ul>
    </div>
  );
}

/** One package; its license texts are only rendered once it is expanded. */
function LicenseItem({ pkg, texts }: { pkg: LicensePackage; texts: readonly string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li className="about-license">
      <details
        onToggle={(e) => {
          setOpen(e.currentTarget.open);
        }}
      >
        <summary className="ui-focusable">
          <span className="about-license-name">{pkg.name}</span>
          <span className="about-license-version">{pkg.version}</span>
          <span className="about-license-id">{pkg.license}</span>
        </summary>
        {open ? (
          <div className="about-license-body">
            {pkg.homepage ? (
              <p className="about-license-source">
                {t('about.licenses.source', { url: pkg.homepage })}
              </p>
            ) : null}
            {pkg.texts.map(([source, i]) => (
              <figure key={source} className="about-license-text">
                <figcaption>{source}</figcaption>
                <pre>{texts[i]}</pre>
              </figure>
            ))}
          </div>
        ) : null}
      </details>
    </li>
  );
}
