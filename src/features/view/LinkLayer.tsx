import type { PdfLinkTarget } from '@embedpdf/models';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { externalUrl, followTarget, internalDestination } from './links';
import { linksOf, SETTLE_MS, type PageLink } from './pageLinks';

/**
 * Link annotations of one page as buttons over the page (M2-10): internal
 * links jump, external ones ask first (M2-Q4). Keyboard-reachable with a
 * name saying where they go (rule 12).
 */
export function LinkLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const [links, setLinks] = useState<PageLink[]>([]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      linksOf(documentId, pageIndex).then(
        (l) => {
          if (live) setLinks(l);
        },
        () => undefined,
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [documentId, pageIndex]);

  if (links.length === 0) return null;
  const name = (target: PdfLinkTarget | undefined): string => {
    const dest = internalDestination(target);
    if (dest) return t('links.toPage', { page: format.number(dest.pageIndex + 1, 0) });
    const url = externalUrl(target);
    return url ? t('links.external', { url }) : t('links.otherFile');
  };
  return (
    <div className="link-layer">
      {links.map((l, i) => (
        <button
          key={i}
          type="button"
          className="link-hit"
          aria-label={name(l.target)}
          title={name(l.target)}
          data-link={i}
          style={{
            left: l.x * scale,
            top: l.y * scale,
            width: l.width * scale,
            height: l.height * scale,
          }}
          onClick={(e) => {
            e.stopPropagation();
            followTarget(l.target);
          }}
        />
      ))}
    </div>
  );
}
