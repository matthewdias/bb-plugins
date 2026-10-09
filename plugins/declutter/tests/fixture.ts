// bb 0.45's markup for the three surfaces, cut down to the attributes
// Declutter reads. Taken from a live thread view: the header's plugin controls
// and bb's own buttons, the composer with its banner column, and one message's
// action bar.
export const BB_MARKUP = `
<header>
  <div data-testid="app-page-header-content-row">
    <div>
      <p><span>Customize thread header actions</span></p>
      <span><button aria-label="Thread actions">…</button></span>
    </div>
    <div>
      <div data-thread-header-workflow-actions>
        <div data-bb-plugin-root data-bb-plugin="side-chats" class="contents">
          <span role="group" aria-label="Side chats"><button aria-label="Open side chat"></button></span>
        </div>
        <div data-bb-plugin-root data-bb-plugin="thread-summary" class="contents">
          <span role="group" aria-label="Thread Summary">
            <button aria-label="Git: main → origin/main"></button>
          </span>
        </div>
        <span data-thread-header-responsive-action>
          <span><div><button aria-label="Open workspace in VS Code (⌘ O)"></button></div></span>
          <span><button aria-label="Choose another app to open workspace"></button></span>
        </span>
        <span data-thread-header-responsive-action><button>Commit</button></span>
      </div>
      <div data-thread-header-pane-actions>
        <button aria-label="Close pane"></button>
        <span><button aria-label="Show right panel (⌘ J)"></button></span>
      </div>
    </div>
  </div>
</header>
<main>
  <div data-timeline-row-id="thr_a:assistant:1">
    <div data-message-column>
      <div><p>An answer</p></div>
      <div>
        <div data-bb-chat-timestamp="7h ago">
          <button aria-label="Copy message"></button>
          <button aria-label="Mark unread from here"></button>
          <button aria-label="Reply in side chat"></button>
          <button aria-label="Message actions"></button>
        </div>
      </div>
    </div>
  </div>
  <div data-app-composer data-app-composer-role="primary">
    <div>
      <div data-bb-plugin-root data-bb-plugin="follow-up" class="contents"><section aria-label="follow-up">Next</section></div>
      <div data-bb-plugin-root data-bb-plugin="gh-context" class="contents"><div data-gh-context-banner>PR #12</div></div>
    </div>
    <div>
      <form data-promptbox>
        <div data-bb-plugin-root data-bb-plugin="follow-up" class="contents"><button aria-label="Add follow-up"></button></div>
      </form>
    </div>
  </div>
</main>
`;

export function mountBb(): void {
  document.body.innerHTML = BB_MARKUP;
}

export function byLabel(label: string): HTMLElement {
  const el = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
  if (!el) throw new Error(`No element labelled ${label}`);
  return el as HTMLElement;
}

export function byPlugin(selector: string, pluginId: string): HTMLElement {
  const el = document.querySelector(`${selector} [data-bb-plugin="${pluginId}"]`);
  if (!el) throw new Error(`No ${pluginId} under ${selector}`);
  return el as HTMLElement;
}
