import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type CreatedLink, type LinkListItem, type LinkStats } from './api/types.js';
import { disableLink, getLinkStats, listLinks } from './api/links.js';
import { Header } from './components/Header.js';
import { Intro } from './components/Intro.js';
import { CreateLinkForm } from './components/CreateLinkForm.js';
import { CreatedLinkResult } from './components/CreatedLinkResult.js';
import { LinkList } from './components/LinkList.js';
import { LinkStatsPanel } from './components/LinkStatsPanel.js';

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function App() {
  const [items, setItems] = useState<LinkListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedLink | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [disablingSlug, setDisablingSlug] = useState<string | null>(null);
  const [disableErrors, setDisableErrors] = useState<Record<string, string>>(
    {},
  );

  const statsAbortRef = useRef<AbortController | null>(null);
  const statsRequestId = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const listRequestId = useRef(0);

  const refreshList = useCallback(async () => {
    const requestId = ++listRequestId.current;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;

    setListLoading(true);
    setListError(null);
    try {
      const response = await listLinks(controller.signal);
      if (requestId !== listRequestId.current) {
        return;
      }
      setItems(response.items);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      if (requestId !== listRequestId.current) {
        return;
      }
      setListError(errorMessage(err, 'Unable to load links'));
    } finally {
      if (requestId === listRequestId.current) {
        setListLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (selectedSlug == null) {
      return;
    }

    const requestId = ++statsRequestId.current;
    const controller = new AbortController();
    statsAbortRef.current?.abort();
    statsAbortRef.current = controller;

    setStatsLoading(true);
    setStatsError(null);
    setStats(null);

    void getLinkStats(selectedSlug, controller.signal)
      .then((data) => {
        if (requestId !== statsRequestId.current) {
          return;
        }
        setStats(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (requestId !== statsRequestId.current) {
          return;
        }
        setStatsError(errorMessage(err, 'Unable to load statistics'));
      })
      .finally(() => {
        if (requestId === statsRequestId.current) {
          setStatsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [selectedSlug]);

  function closeStats() {
    statsAbortRef.current?.abort();
    setSelectedSlug(null);
    setStats(null);
    setStatsError(null);
    setStatsLoading(false);
  }

  async function handleCreated(link: CreatedLink) {
    setCreated(link);
    await refreshList();
  }

  async function handleDisable(slug: string) {
    setDisablingSlug(slug);
    setDisableErrors((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
    try {
      await disableLink(slug);
      await refreshList();
    } catch (err) {
      setDisableErrors((prev) => ({
        ...prev,
        [slug]: errorMessage(err, 'Unable to disable link'),
      }));
    } finally {
      setDisablingSlug(null);
    }
  }

  return (
    <div className="app-shell">
      <Header>URL Shortener Challenge</Header>
      <Intro />
      <CreateLinkForm onCreated={(link) => void handleCreated(link)} />
      {created ? <CreatedLinkResult link={created} /> : null}
      <LinkList
        items={items}
        loading={listLoading}
        error={listError}
        selectedSlug={selectedSlug}
        disablingSlug={disablingSlug}
        disableErrors={disableErrors}
        onViewStats={(slug) => {
          if (selectedSlug === slug) {
            closeStats();
          } else {
            setSelectedSlug(slug);
          }
        }}
        onDisable={(slug) => void handleDisable(slug)}
      />
      {selectedSlug ? (
        <LinkStatsPanel
          slug={selectedSlug}
          loading={statsLoading}
          error={statsError}
          stats={stats}
          onClose={closeStats}
        />
      ) : null}
    </div>
  );
}
