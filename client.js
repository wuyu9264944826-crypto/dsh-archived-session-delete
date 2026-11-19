window.__ModuleLoader__.load({
  id: '@local/archived-session-delete',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /**
     * Exact route the Host half answers. The Host owns the Session log and the
     * registry bookkeeping; the page owns neither, so it only asks.
     */
    const ROUTE_PATH = '/plugin-api/archived-session/delete';
    /** The built-in Archive action sits at 600; the destructive row follows it. */
    const MENU_ORDER = 700;

    const DICTIONARIES = {
      en: {
        'menu.delete': 'Delete conversation',
        'confirm.title': 'Delete conversation',
        'confirm.desc': 'This permanently deletes “{title}” and its stored log. It cannot be undone.',
        'confirm.untitled': 'this conversation',
        'confirm.action': 'Delete',
        'confirm.pending': 'Deleting…',
        'cancel': 'Cancel',
        'notice.deleted': 'Conversation deleted',
        'kind.turn': 'a running turn',
        'kind.subagent': 'subagents',
        'kind.job': 'background jobs',
        'kind.schedule': 'schedules',
        'kind.other': 'unfinished work',
        'listSeparator': ', ',
        'error.not-archived': 'This conversation is no longer archived.',
        'error.active': 'This conversation is still running.',
        'error.activeKinds': 'This conversation still has work in progress ({kinds}). Stop it first, then delete.',
        'error.locked': 'The conversation log is held open by another process. Retry in a moment, or restart Harness.',
        'error.unlink-failed': 'The conversation log could not be removed.',
        'error.bookkeeping-failed': 'The log was removed, but its workspace entry could not be cleaned up.',
        'error.origin-refused': 'This page is not allowed to delete conversations.',
        'error.bad-session-id': 'The conversation id is not valid.',
        'error.no-host': 'The Harness Host could not be reached.',
        'error.network': 'The Harness Host did not answer.',
        'error.fallback': 'Delete conversation failed.',
      },
      zh: {
        'menu.delete': '删除对话',
        'confirm.title': '删除对话',
        'confirm.desc': '将永久删除「{title}」及其本地会话记录，此操作无法撤销。',
        'confirm.untitled': '该对话',
        'confirm.action': '删除',
        'confirm.pending': '正在删除…',
        'cancel': '取消',
        'notice.deleted': '对话已删除',
        'kind.turn': '正在进行的回合',
        'kind.subagent': '子代理',
        'kind.job': '后台作业',
        'kind.schedule': '定时任务',
        'kind.other': '未完成的任务',
        'listSeparator': '、',
        'error.not-archived': '该对话已不在归档中。',
        'error.active': '该对话仍在运行。',
        'error.activeKinds': '该对话仍有任务在进行（{kinds}），请先停止后再删除。',
        'error.locked': '该对话的日志文件正被其它进程占用，请稍后重试，或重启 Harness 后再删。',
        'error.unlink-failed': '无法删除该对话的本地记录。',
        'error.bookkeeping-failed': '记录已删除，但工作区条目未能清理。',
        'error.origin-refused': '当前页面无权删除对话。',
        'error.bad-session-id': '对话标识无效。',
        'error.no-host': '无法连接到 Harness 宿主。',
        'error.network': 'Harness 宿主没有响应。',
        'error.fallback': '删除对话失败。',
      },
    };

    /** Active locale id, with the dictionary key it selects. */
    function localeIdOf(ctx) {
      try {
        const locale = ctx.get('locale');
        if (locale) {
          const snapshot = typeof locale.getLocale === 'function'
            ? locale.getLocale()
            : typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : undefined;
          if (snapshot !== null && typeof snapshot === 'object') {
            const id = snapshot.id || snapshot.locale || snapshot.language;
            if (typeof id === 'string' && id !== '') return id;
          }
        }
      } catch (error) {
        // A locale service that is mid-reload must not block the menu.
      }
      if (typeof document !== 'undefined' && document.documentElement?.lang) {
        return document.documentElement.lang;
      }
      return 'en';
    }

    /** Translate one key from the dictionaries above, English as the last resort. */
    function translate(ctx, key) {
      const id = String(localeIdOf(ctx) || 'en').toLowerCase();
      const dictionary = id.startsWith('zh') ? DICTIONARIES.zh : DICTIONARIES.en;
      return dictionary[key] ?? DICTIONARIES.en[key] ?? key;
    }

    /**
     * The origin that serves this page: the HTTP listener behind the Web GUI,
     * or the desktop shell's announced Host origin for a static page.
     */
    function hostOrigin() {
      try {
        if (typeof location !== 'undefined' && location !== null
          && (location.protocol === 'http:' || location.protocol === 'https:')) {
          return location.origin;
        }
      } catch (error) {
        // Fall through to the announced transport.
      }
      try {
        const transport = typeof window === 'undefined' ? undefined : window.__DSH_TRANSPORT__;
        if (transport !== null && typeof transport === 'object'
          && typeof transport.streamBaseUrl === 'string' && transport.streamBaseUrl !== '') {
          return new URL(transport.streamBaseUrl).origin;
        }
      } catch (error) {
        // No usable origin was announced either.
      }
      return undefined;
    }

    /**
     * Ask the Host to delete one archived conversation. Every failure carries the
     * reason the Host reported so the dialog can explain it.
     */
    async function requestDelete(sessionId) {
      const origin = hostOrigin();
      if (origin === undefined) throw withReason(new Error('no-host'), 'no-host');
      let response;
      try {
        response = await fetch(origin + ROUTE_PATH, {
          method: 'POST',
          // A simple content type keeps this a non-preflighted cross-origin POST.
          headers: { 'content-type': 'text/plain;charset=UTF-8', accept: 'application/json' },
          body: JSON.stringify({ sessionId }),
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch (error) {
        throw withReason(error, 'network');
      }
      let body;
      try {
        body = await response.json();
      } catch (error) {
        body = undefined;
      }
      if (body !== null && typeof body === 'object' && body.ok === true) return body;
      const reason = body !== null && typeof body === 'object' && typeof body.reason === 'string'
        ? body.reason
        : 'http-' + String(response.status);
      const failure = withReason(new Error(reason), reason);
      // The Host names what still runs, so the dialog can say which work to stop.
      failure.kinds = body !== null && typeof body === 'object' && Array.isArray(body.kinds)
        ? body.kinds.filter(kind => typeof kind === 'string')
        : [];
      throw failure;
    }

    /** Attach the Host's machine-readable reason to a failure. */
    function withReason(error, reason) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      wrapped.reason = reason;
      return wrapped;
    }

    /** Which work kinds the Host named, in the reader's language. */
    const KIND_KEYS = {
      turn: 'kind.turn',
      subagent: 'kind.subagent',
      job: 'kind.job',
      schedule: 'kind.schedule',
    };

    /**
     * A localized sentence for one failure.
     * @param t - the active dictionary.
     * @param error - the rejected reason from {@link requestDelete}.
     * @returns the sentence to show in the dialog.
     */
    function messageFor(t, error) {
      const reason = error !== null && typeof error === 'object' && typeof error.reason === 'string'
        ? error.reason
        : '';
      switch (reason) {
        case 'not-archived': return t('error.not-archived');
        case 'active': {
          const kinds = error !== null && typeof error === 'object' && Array.isArray(error.kinds) ? error.kinds : [];
          if (kinds.length === 0) return t('error.active');
          const labels = kinds.map(kind => t(KIND_KEYS[kind] ?? 'kind.other'));
          return t('error.activeKinds').replace('{kinds}', labels.join(t('listSeparator')));
        }
        case 'locked': return t('error.locked');
        case 'unlink-failed': return t('error.unlink-failed');
        case 'bookkeeping-failed': return t('error.bookkeeping-failed');
        case 'origin-refused': return t('error.origin-refused');
        case 'bad-session-id': return t('error.bad-session-id');
        case 'no-host': return t('error.no-host');
        case 'network': return t('error.network');
        default: return reason === '' ? t('error.fallback') : t('error.fallback') + ' (' + reason + ')';
      }
    }

    const backdropStyle = {
      position: 'absolute',
      inset: 0,
      background: 'rgba(10, 12, 18, 0.42)',
    };

    const cardStyle = {
      position: 'relative',
      width: 'min(420px, calc(100vw - 48px))',
      boxSizing: 'border-box',
      padding: '20px 20px 16px',
      borderRadius: 14,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-overlay)',
      color: 'var(--dsw-alias-label-primary)',
      boxShadow: '0 18px 48px rgba(10, 12, 18, 0.3)',
      fontFamily: 'inherit',
      fontSize: 13,
    };

    const titleStyle = {
      margin: '0 0 8px',
      fontSize: 15,
      fontWeight: 600,
      lineHeight: 1.4,
    };

    const descriptionStyle = {
      margin: 0,
      fontSize: 13,
      lineHeight: 1.6,
      color: 'var(--dsw-alias-label-secondary)',
      overflowWrap: 'anywhere',
    };

    const footerStyle = {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 20,
    };

    const buttonStyle = {
      padding: '6px 14px',
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 500,
      lineHeight: '20px',
      fontFamily: 'inherit',
      cursor: 'pointer',
    };

    const cancelStyle = {
      ...buttonStyle,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
    };

    /**
     * The host's own destructive action is an outline button whose label turns
     * red (`deleteAction` in the workspace dialog), never a filled red control:
     * that keeps one text colour legible in both themes.
     */
    const deleteStyle = {
      ...buttonStyle,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-state-error-primary)',
    };

    /** Inline dialog messages follow the host dialog's 12px status and error rows. */
    const statusStyle = {
      marginTop: 12,
      fontSize: 12,
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-secondary)',
    };

    const errorStyle = {
      ...statusStyle,
      color: 'var(--dsw-alias-state-error-primary)',
    };

    /** Disabled controls keep their geometry but stop inviting the click. */
    function dimmed(style, disabled) {
      return disabled ? { ...style, opacity: 0.55, cursor: 'default' } : style;
    }

    return {
      inject: ['slots', 'contextMenus', 'workspaces'],
      apply(ctx) {
        const t = (key) => translate(ctx, key);

        /** The one pending confirmation, if any; the overlay reads it through this store. */
        const confirmations = { pending: null };
        const listeners = new Set();
        const setPending = (next) => {
          confirmations.pending = next;
          for (const listener of [...listeners]) listener();
        };
        const usePending = () => {
          const [value, setValue] = React.useState(confirmations.pending);
          React.useEffect(() => {
            const update = () => setValue(confirmations.pending);
            listeners.add(update);
            update();
            return () => { listeners.delete(update); };
          }, []);
          return value;
        };

        /** Re-pull the Host catalog so the deleted row leaves the sidebar at once. */
        const refreshSessions = () => {
          const sessions = ctx.get('sessions');
          if (sessions === undefined || typeof sessions.refresh !== 'function') return;
          try {
            void Promise.resolve(sessions.refresh()).catch(() => {});
          } catch (error) {
            // The workspace frame already removed the row from its account.
          }
        };

        /**
         * The confirmation dialog: nothing while no request is pending, otherwise
         * one card that owns its own in-flight and error state.
         */
        function ConfirmOverlay() {
          const request = usePending();
          const [busy, setBusy] = React.useState(false);
          const [error, setError] = React.useState(null);
          const cancelRef = React.useRef(null);

          React.useEffect(() => {
            if (request === null) return undefined;
            setBusy(false);
            setError(null);
            const timer = setTimeout(() => {
              const button = cancelRef.current;
              if (button !== null && button !== undefined) button.focus();
            }, 0);
            return () => { clearTimeout(timer); };
          }, [request === null ? null : request.sessionId]);

          React.useEffect(() => {
            if (request === null) return undefined;
            const onKeyDown = (event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setPending(null);
            };
            window.addEventListener('keydown', onKeyDown, true);
            return () => { window.removeEventListener('keydown', onKeyDown, true); };
          }, [request === null ? null : request.sessionId]);

          if (request === null) return null;

          const close = () => { if (!busy) setPending(null); };
          const confirm = () => {
            setBusy(true);
            setError(null);
            requestDelete(request.sessionId).then(() => {
              setPending(null);
              ctx.contextMenus.notify(t('notice.deleted'), true);
              refreshSessions();
            }).catch((reason) => {
              setBusy(false);
              setError(messageFor(t, reason));
            });
          };
          const title = typeof request.title === 'string' && request.title.trim() !== ''
            ? request.title.trim()
            : t('confirm.untitled');

          return h('div', {
            style: { position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
          },
            h('div', { style: backdropStyle, onClick: close, 'aria-hidden': true }),
            h('div', {
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'archived-session-delete-title',
              'aria-describedby': 'archived-session-delete-desc',
              style: cardStyle,
            },
              h('h2', { id: 'archived-session-delete-title', style: titleStyle }, t('confirm.title')),
              h('p', { id: 'archived-session-delete-desc', style: descriptionStyle },
                t('confirm.desc').replace('{title}', title)),
              busy ? h('div', { role: 'status', style: statusStyle }, t('confirm.pending')) : null,
              error === null ? null : h('p', { role: 'alert', style: errorStyle }, error),
              h('div', { style: footerStyle },
                h('button', {
                  ref: cancelRef,
                  type: 'button',
                  disabled: busy,
                  style: dimmed(cancelStyle, busy),
                  onClick: close,
                }, t('cancel')),
                h('button', {
                  type: 'button',
                  disabled: busy,
                  style: dimmed(deleteStyle, busy),
                  onClick: confirm,
                }, t('confirm.action')),
              ),
            ),
          );
        }

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'archived-session-delete-confirm',
          order: 500,
          label: () => t('confirm.title'),
        }, ConfirmOverlay));

        // The Session menu is shared with the row, the header, and the More
        // trigger, so one contribution covers every right-click surface.
        ctx.effect(() => ctx.contextMenus.register({
          id: 'session.deleteArchived',
          target: 'session',
          order: MENU_ORDER,
          observe: () => [ctx.workspaces.list],
          resolve: (target) => {
            const archived = ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(target.sessionId);
            if (!archived) return [];
            return [{
              id: 'delete',
              label: t('menu.delete'),
              danger: true,
              separatorBefore: true,
              afterContent: true,
              run: () => { setPending({ sessionId: target.sessionId, title: target.displayTitle }); },
            }];
          },
        }), 'archived-session-delete: session menu');
      },
    };
  },
});
