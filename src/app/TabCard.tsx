import { useTranslation } from 'react-i18next';
import { ThumbImage } from '../features/thumbnails/ThumbImage';
import { usePages } from '../features/thumbnails/pageInfo';
import { format } from '../i18n';
import { useDocuments } from './store/documentStore';
import { tabCardText } from './tabCardText';

/** The page 1 thumbnail's width on the card, in CSS px. */
const THUMB_WIDTH = 64;

/**
 * The file tab's hover card (M11-03, ADR-028 D-50), PDF-XChange style: page 1, the
 * full file name (wrapped, never cut), where the file came from (browsers never tell
 * a web app its folder), pages · size · modified, and status chips. The tab's
 * accessible description carries the same text (TabStrip).
 */
export function TabCard({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const doc = useDocuments((s) => s.docs[docId]);
  const first = usePages(docId)[0];
  if (!doc) return null;
  const text = tabCardText(doc, t, format);
  const turned = first ? first.rotation % 2 === 1 : false;
  const height = first
    ? Math.round(THUMB_WIDTH * (turned ? first.width / first.height : first.height / first.width))
    : THUMB_WIDTH;
  return (
    // Hidden from assistive tech: the tab's accessible description already says all of
    // it (and the tooltip's own hidden copy names the file), so it is not read twice.
    <div className="tab-card-body" data-testid="tab-card" aria-hidden="true">
      <div className="tab-card-thumb" style={{ width: THUMB_WIDTH, height }}>
        {first ? (
          <ThumbImage
            documentId={docId}
            pageIndex={0}
            page={first}
            width={THUMB_WIDTH}
            priority={-1}
            className="tab-card-img"
          />
        ) : null}
      </div>
      <div className="tab-card-text">
        <p className="tab-card-name">{text.name}</p>
        <p className="tab-card-muted">{text.source}</p>
        <p className="tab-card-details">{text.details}</p>
        {text.status.length > 0 ? (
          <ul className="tab-card-status">
            {text.status.map((s) => (
              <li key={s.id} className={`tab-card-chip tab-card-chip--${s.id}`}>
                {s.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
