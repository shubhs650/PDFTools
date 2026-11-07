// One Help topic (M9, ADR-026): heading, summary, then its blocks — text,
// numbered steps, tips and screenshots. A screenshot opens full size in a
// native modal <dialog> (focus trapped, Esc closes).
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Lightbulb20Regular } from '@fluentui/react-icons/svg/lightbulb';
import { useRef, type ReactNode } from 'react';
import { ShortcutTable } from '../app/keys/ShortcutTable';
import { parseInline, plain, shotUrl, type Block, type HelpText, type Vars } from './content';
import shots from './shots.json';
import { chapterOf, type TopicId } from './topics';

const SHOTS: Record<string, { w: number; h: number } | undefined> = shots;
const SHORTCUTS_TEST_ID = 'help-shortcuts';

function Rich({ text, vars }: { text: string; vars: Vars }) {
  return (
    <>
      {parseInline(text, vars).map((x, i) => {
        switch (x.kind) {
          case 'ui':
            return (
              <b key={i} className="help-ui">
                {x.text}
              </b>
            );
          case 'key':
            return <kbd key={i}>{x.text}</kbd>;
          case 'link':
            return (
              <a key={i} href={`#${x.topic}`}>
                {x.text}
              </a>
            );
          default:
            return x.text;
        }
      })}
    </>
  );
}

function Shot({
  id,
  alt,
  caption,
  vars,
  zoomLabel,
  closeLabel,
}: {
  id: string;
  alt: string;
  caption: string | undefined;
  vars: Vars;
  zoomLabel: string;
  closeLabel: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const size = SHOTS[id];
  const altText = plain(alt, vars);
  return (
    <figure className="help-shot" data-shot={id}>
      <button
        type="button"
        className="help-shot-open"
        aria-label={`${zoomLabel}: ${altText}`}
        onClick={() => {
          dialog.current?.showModal();
        }}
      >
        <img
          src={shotUrl(id)}
          alt={altText}
          loading="lazy"
          decoding="async"
          {...(size ? { width: size.w, height: size.h } : {})}
        />
      </button>
      {caption ? (
        <figcaption>
          <Rich text={caption} vars={vars} />
        </figcaption>
      ) : null}
      {/* Esc closes the native dialog, and so does its Close button; a click
          on the backdrop is only a mouse shortcut. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <dialog
        ref={dialog}
        className="help-lightbox"
        aria-label={altText}
        onClick={(e) => {
          // A click on the backdrop (the dialog itself, not the image) closes it.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <button
          type="button"
          className="help-icon-button help-lightbox-close"
          aria-label={closeLabel}
          onClick={() => dialog.current?.close()}
        >
          <Dismiss20Regular aria-hidden="true" />
        </button>
        <img src={shotUrl(id)} alt={altText} {...(size ? { width: size.w, height: size.h } : {})} />
      </dialog>
    </figure>
  );
}

function BlockView({ block, text, vars }: { block: Block; text: HelpText; vars: Vars }): ReactNode {
  if ('p' in block)
    return (
      <p>
        <Rich text={block.p} vars={vars} />
      </p>
    );
  if ('h' in block)
    return (
      <h2>
        <Rich text={block.h} vars={vars} />
      </h2>
    );
  if ('steps' in block)
    return (
      <ol className="help-steps">
        {block.steps.map((s, i) => (
          <li key={i}>
            <Rich text={s} vars={vars} />
          </li>
        ))}
      </ol>
    );
  if ('list' in block)
    return (
      <ul>
        {block.list.map((s, i) => (
          <li key={i}>
            <Rich text={s} vars={vars} />
          </li>
        ))}
      </ul>
    );
  if ('tip' in block)
    return (
      <aside className="help-tip">
        <Lightbulb20Regular aria-hidden="true" />
        <p>
          <b>{plain(text.ui.tip, vars)}</b> <Rich text={block.tip} vars={vars} />
        </p>
      </aside>
    );
  if ('shot' in block)
    return (
      <Shot
        id={block.shot}
        alt={block.alt}
        caption={block.caption}
        vars={vars}
        zoomLabel={plain(text.ui.zoomShot, vars)}
        closeLabel={plain(text.ui.close, vars)}
      />
    );
  return <ShortcutTable testId={SHORTCUTS_TEST_ID} />;
}

export function TopicView({ id, text, vars }: { id: TopicId; text: HelpText; vars: Vars }) {
  const topic = text.topics[id];
  return (
    <article className="help-topic" data-topic={id} aria-labelledby={`help-title-${id}`}>
      <p className="help-eyebrow">{plain(text.chapters[chapterOf(id)], vars)}</p>
      <h1 id={`help-title-${id}`}>
        <Rich text={topic.title} vars={vars} />
      </h1>
      <p className="help-summary">
        <Rich text={topic.summary} vars={vars} />
      </p>
      {topic.body.map((b, i) => (
        <BlockView key={i} block={b} text={text} vars={vars} />
      ))}
    </article>
  );
}
