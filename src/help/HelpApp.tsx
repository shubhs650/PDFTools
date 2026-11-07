// The Help window (M9, ADR-026 D-46): a table of contents on the left, the
// topic in the middle, search (on Enter or the button only, rule 3) and print
// at the top. The address is /help#topic-id, so a topic can be bookmarked and
// the app opens the window at one. Nothing is fetched but Help's own files
// (rule 4), and no document data ever reaches this window.
import { ChevronLeft20Regular } from '@fluentui/react-icons/svg/chevron-left';
import { ChevronRight20Regular } from '@fluentui/react-icons/svg/chevron-right';
import { Navigation20Regular } from '@fluentui/react-icons/svg/navigation';
import { Print20Regular } from '@fluentui/react-icons/svg/print';
import { Search20Regular } from '@fluentui/react-icons/svg/search';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { helpText, plain } from './content';
import { helpKeys } from './keys';
import { searchHelp, type SearchHit } from './search';
import { TopicView } from './TopicView';
import { CHAPTERS, FIRST_TOPIC, TOPICS, isTopicId, type TopicId } from './topics';

function subscribeHash(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => {
    window.removeEventListener('hashchange', cb);
  };
}

const readHash = (): string => decodeURIComponent(location.hash.slice(1));

export function HelpApp() {
  const { t, i18n } = useTranslation();
  const text = helpText(i18n.language);
  const vars = useMemo(() => helpKeys(t), [t]);
  const hash = useSyncExternalStore(subscribeHash, readHash);
  const topic: TopicId = isTopicId(hash) ? hash : FIRST_TOPIC;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [printAll, setPrintAll] = useState(false);
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  const ui = text.ui;
  const title = plain(text.topics[topic].title, vars);

  // A new topic: scroll to the top and move focus to
  // the content for keyboard and screen-reader users (not on the first load).
  useEffect(() => {
    document.title = `${title} – ${plain(ui.title, vars)}`;
    window.scrollTo(0, 0);
    main.current?.scrollTo(0, 0);
    if (firstRender.current) firstRender.current = false;
    else main.current?.focus({ preventScroll: true });
  }, [topic, title, ui.title, vars]);

  // Following a link to another topic leaves the search results and the contents menu.
  useEffect(
    () =>
      subscribeHash(() => {
        setResults(null);
        setTocOpen(false);
      }),
    [],
  );

  // Print all: render every topic, print, then go back to one.
  useEffect(() => {
    if (!printAll) return;
    const done = (): void => {
      setPrintAll(false);
    };
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    return () => {
      window.removeEventListener('afterprint', done);
    };
  }, [printAll]);

  // A link to the topic already shown changes no hash: leave the results here too.
  const leaveResults = (): void => {
    setResults(null);
    setTocOpen(false);
  };

  const onSearch = (e: SyntheticEvent): void => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setResults({ query: q, hits: searchHelp(text, q, vars) });
    main.current?.focus({ preventScroll: true });
  };

  const index = TOPICS.indexOf(topic);
  const prev = index > 0 ? TOPICS[index - 1] : undefined;
  const next = index < TOPICS.length - 1 ? TOPICS[index + 1] : undefined;

  return (
    <div className="help-app" data-testid="help-app">
      <a className="help-skip" href="#help-main">
        {plain(ui.skip, vars)}
      </a>
      <header className="help-header">
        <button
          type="button"
          className="help-icon-button help-toc-toggle"
          aria-label={plain(ui.contents, vars)}
          aria-expanded={tocOpen}
          aria-controls="help-toc"
          onClick={() => {
            setTocOpen((o) => !o);
          }}
        >
          <Navigation20Regular aria-hidden="true" />
        </button>
        <a className="help-brand" href={`#${FIRST_TOPIC}`}>
          <img src="/icons/icon.svg" alt="" width="28" height="28" />
          <span>{plain(ui.title, vars)}</span>
        </a>
        <form role="search" className="help-search" onSubmit={onSearch}>
          <input
            type="search"
            value={query}
            aria-label={plain(ui.searchLabel, vars)}
            placeholder={plain(ui.searchPlaceholder, vars)}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          <button type="submit" className="help-icon-button" aria-label={plain(ui.searchButton, vars)}>
            <Search20Regular aria-hidden="true" />
          </button>
        </form>
        <div className="help-header-actions">
          <button
            type="button"
            className="help-button"
            onClick={() => {
              window.print();
            }}
          >
            <Print20Regular aria-hidden="true" />
            <span>{plain(ui.print, vars)}</span>
          </button>
          <button
            type="button"
            className="help-button help-button--subtle"
            onClick={() => {
              setPrintAll(true);
            }}
          >
            {plain(ui.printAll, vars)}
          </button>
        </div>
      </header>
      <div className="help-body">
        <nav
          id="help-toc"
          className={tocOpen ? 'help-toc help-toc--open' : 'help-toc'}
          aria-label={plain(ui.contents, vars)}
        >
          {CHAPTERS.map((c) => (
            <section key={c.id} className="help-toc-chapter">
              <h2>{plain(text.chapters[c.id], vars)}</h2>
              <ul>
                {c.topics.map((id) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      aria-current={id === topic && !results ? 'page' : undefined}
                      onClick={leaveResults}
                    >
                      {plain(text.topics[id].title, vars)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <main id="help-main" className="help-main" ref={main} tabIndex={-1}>
          {printAll ? (
            TOPICS.map((id) => <TopicView key={id} id={id} text={text} vars={vars} />)
          ) : results ? (
            <section className="help-results" aria-live="polite">
              <h1>{plain(ui.resultsTitle, { ...vars, query: results.query })}</h1>
              {results.hits.length ? (
                <ol>
                  {results.hits.map((h) => (
                    <li key={h.topic}>
                      <a href={`#${h.topic}`} onClick={leaveResults}>
                        {h.title}
                      </a>
                      <p>{h.snippet}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>{plain(ui.noResults, { ...vars, query: results.query })}</p>
              )}
            </section>
          ) : (
            <>
              <TopicView id={topic} text={text} vars={vars} />
              <nav className="help-pager" aria-label={plain(ui.pager, vars)}>
                {prev ? (
                  <a href={`#${prev}`} className="help-pager-prev">
                    <ChevronLeft20Regular aria-hidden="true" />
                    <span>
                      <small>{plain(ui.previous, vars)}</small>
                      {plain(text.topics[prev].title, vars)}
                    </span>
                  </a>
                ) : (
                  <span />
                )}
                {next ? (
                  <a href={`#${next}`} className="help-pager-next">
                    <span>
                      <small>{plain(ui.next, vars)}</small>
                      {plain(text.topics[next].title, vars)}
                    </span>
                    <ChevronRight20Regular aria-hidden="true" />
                  </a>
                ) : null}
              </nav>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
