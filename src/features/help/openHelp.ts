// Help → Help, F1 and the dialogs' "?" buttons (M9-01, ADR-026 D-46): Help is
// its own page, /help, in its own window. One named window is reused, so F1
// again brings it forward at the new topic. No document data goes to it: the
// URL carries only a topic id.
import { QuestionCircle20Regular } from '@fluentui/react-icons/svg/question-circle';
import { createElement } from 'react';
import { appStore } from '../../app/store/appStore';
import { isTopicId, topicForTab, type TopicId } from '../../help/topics';
import type { DialogHelp } from '../../ui/components/Dialog';

/** The Help window's name: every open reuses the same window. */
export const HELP_WINDOW = 'triya-help';

/** A comfortable reading size; the browser may adjust it. */
const FEATURES = 'popup,width=1180,height=860';

/** The Help page's address for a topic (the start page when none). */
export function helpUrl(topic?: string): string {
  const base = `${import.meta.env.BASE_URL}help`;
  return topic && isTopicId(topic) ? `${base}#${topic}` : base;
}

/** Opens (or brings forward) the Help window at `topic`. */
export function openHelp(topic?: string): void {
  const url = helpUrl(topic);
  // A popup window; if the browser refuses one, a new tab instead.
  const win = window.open(url, HELP_WINDOW, FEATURES) ?? window.open(url, HELP_WINDOW);
  win?.focus();
}

/**
 * The topic for what the user is doing (F1): the open dialog's own topic
 * (`data-help-topic`, set by Dialog's `help`), else the chapter of the
 * active ribbon tab.
 */
export function currentHelpTopic(): string | undefined {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][data-help-topic]');
  const last = dialogs[dialogs.length - 1];
  const topic = last?.dataset['helpTopic'];
  if (topic) return topic;
  return topicForTab(appStore.getState().ribbonTab);
}

/** A Dialog's `help`: its "?" button opens Help at `topic` (M9-04). */
export function dialogHelp(topic: TopicId): DialogHelp {
  return {
    topic,
    icon: createElement(QuestionCircle20Regular),
    onOpen: () => {
      openHelp(topic);
    },
  };
}
