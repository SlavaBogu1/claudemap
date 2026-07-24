import { useEffect, useRef, useState } from "react";
import { SafeMarkdown } from "./SafeMarkdown";
import type {
  StickItNoteEntry,
  NodeType,
  NoteEntry,
  Project,
  ProjectContentSource,
  SelectedGraphItem,
  SessionContentMessage,
} from "../types";
import {
  ApiError,
  deleteNote,
  fetchAgentContent,
  fetchFileContent,
  fetchMemoryContent,
  fetchProjectContent,
  fetchSessionContent,
  fetchToolContent,
  saveNote,
} from "../api/client";

// CR-UI-08 (Sprint 3, gated surface — implements the approved mockup exactly): the Detail panel's
// "Content" tab — real item content (session transcript / memory file text) plus an inline note
// editor, generalized across every selectable graph item type.

export interface ContentTabProps {
  project: Project;
  selectedItem: SelectedGraphItem | null;
  notes: NoteEntry[];
  // CR-CORE-03: read-only, ingest-written "stick-it" notes — rendered in an additional, view-only
  // section below, entirely separate from the editable user-note textarea/state above.
  stickItNotes: StickItNoteEntry[];
  onNoteSaved: (note: NoteEntry) => void;
  onNoteDeleted: (nodeType: NodeType, nodeId: string) => void;
}

type ContentState =
  | { status: "none" }
  | { status: "unsupported" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "session"; messages: SessionContentMessage[] }
  | { status: "memory"; text: string }
  // CR-UI-15 (Sprint 5): Agent (subagent) content — same message shape as session content (either
  // a real transcript or a single message synthesized from `.meta.json`'s `description`).
  | { status: "subagent"; messages: SessionContentMessage[] }
  // CR-UI-15 (Sprint 5): raw tool-output text — identical treatment to memory content.
  | { status: "tool"; text: string }
  // CR-CORE-05 (Sprint 8): raw file-history backup text — identical treatment to memory/tool
  // content.
  | { status: "file"; text: string }
  // CR-UI-25 (Sprint 5): project-level content, resolved server-side (README -> CLAUDE.md ->
  // earliest session's first user message -> none).
  | { status: "project"; source: ProjectContentSource; content: string | null };

function projectContentSourceLabel(source: ProjectContentSource): string {
  switch (source) {
    case "readme":
      return "From README.md";
    case "claude-md":
      return "From CLAUDE.md";
    case "first-message":
      return "First message";
    default:
      return "";
  }
}

// CR-UI-17 (Sprint 5): client-side search over the already-fetched content view — no new endpoint,
// no Indexer involvement. Case-insensitive substring match, safe highlighting via normal React
// child rendering — never raw-HTML injection.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text: string, query: string): number {
  if (!query) return 0;
  const re = new RegExp(escapeRegExp(query), "gi");
  return (text.match(re) ?? []).length;
}

// Given one block of plain text, returns React children with every case-insensitive match of
// `query` wrapped in a safe `<mark>` element (plain array of strings/elements — no HTML-string
// interpolation). `matchCounter` is a single mutable counter shared across every text block
// rendered in this pass (a session/subagent transcript has one block per message) so matches are
// numbered in document order across the whole content view, not restarted per block.
function renderHighlighted(
  text: string,
  query: string,
  matchCounter: { value: number },
  currentMatchIndex: number,
): React.ReactNode {
  if (!query) return text;
  const re = new RegExp(`(${escapeRegExp(query)})`, "gi");
  // A capturing-group split alternates [non-match, match, non-match, match, ...] — even indices
  // are never matches, odd indices always are; this parity holds regardless of empty segments, so
  // filtering empties afterward (for rendering only) can't misclassify a real match.
  return text.split(re).map((part, i) => {
    if (part.length === 0) return null;
    if (i % 2 === 0) return <span key={i}>{part}</span>;
    const matchIndex = matchCounter.value;
    matchCounter.value += 1;
    const isCurrent = matchIndex === currentMatchIndex;
    return (
      <mark
        key={i}
        data-testid={isCurrent ? "search-match-current" : "search-match"}
        className={isCurrent ? "search-match search-match-current" : "search-match"}
      >
        {part}
      </mark>
    );
  });
}

function getSearchableTexts(content: ContentState): string[] {
  switch (content.status) {
    case "session":
    case "subagent":
      return content.messages.map((m) => m.text);
    case "memory":
    case "tool":
    case "file":
      return [content.text];
    case "project":
      return content.content ? [content.content] : [];
    default:
      return [];
  }
}

export function ContentTab({
  project,
  selectedItem,
  notes,
  stickItNotes,
  onNoteSaved,
  onNoteDeleted,
}: ContentTabProps) {
  const [content, setContent] = useState<ContentState>({ status: "none" });
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // CR-UI-19: view mode (default when a saved note exists — renders the Markdown source as real
  // formatted output) vs. edit mode (today's raw-source `<textarea>`). Kept in sync with
  // `existingNote` below via the same effect that resets `noteText` on selection/content change, so
  // Save (which updates `existingNote.content`) naturally flips back to view without extra wiring.
  const [noteMode, setNoteMode] = useState<"view" | "edit">("edit");

  // CR-UI-17: search query + which match (in document order) is "current", for the Previous/Next
  // navigation and the distinct current-match highlight.
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const contentViewRef = useRef<HTMLDivElement>(null);

  // Changing the selected item resets the query/highlights (a stale query over new content would
  // be confusing).
  useEffect(() => {
    setSearchQuery("");
    setCurrentMatchIndex(0);
  }, [selectedItem?.nodeType, selectedItem?.rawId]);

  const existingNote = selectedItem
    ? (notes.find((n) => n.nodeType === selectedItem.nodeType && n.nodeId === selectedItem.rawId) ?? null)
    : null;

  // CR-CORE-03: stick-it notes are always keyed `nodeType: "session"` (no per-message anchor, no
  // new node type — every `[stick-it]` tag in a session aggregates into one note on the session as
  // a whole), so this only ever resolves for a "session" selection, never a sub-item/project one.
  const stickItNote =
    selectedItem && selectedItem.nodeType === "session"
      ? (stickItNotes.find(
          (n) => n.nodeType === selectedItem.nodeType && n.nodeId === selectedItem.rawId,
        ) ?? null)
      : null;

  // Reset the note editor's local draft whenever the selection (or its saved content) changes —
  // an empty textarea if no note exists yet. CR-UI-19: also resets the view/edit mode here — a note
  // with saved content opens in view mode (nothing to render for an empty one, so it opens directly
  // in edit); this same dependency on `existingNote?.content` is what makes Save (which updates
  // `existingNote.content` via `onNoteSaved`) naturally flip back to view mode without extra wiring.
  useEffect(() => {
    setNoteText(existingNote?.content ?? "");
    setNoteError(null);
    setNoteMode(existingNote ? "view" : "edit");
  }, [selectedItem?.nodeType, selectedItem?.rawId, existingNote?.content]);

  // CR-UI-08 scope (user-confirmed): v1 covers Session (full transcript) and Memory touch (raw file
  // text) content only. Subagent/Tool/project show a placeholder, not an error — deferred to a
  // follow-up CR that generalizes the Content tab's data sources.
  useEffect(() => {
    let cancelled = false;
    if (!selectedItem) {
      setContent({ status: "none" });
      return;
    }
    if (selectedItem.nodeType === "session") {
      setContent({ status: "loading" });
      fetchSessionContent(project.id, selectedItem.rawId)
        .then((c) => {
          if (!cancelled) setContent({ status: "session", messages: c.messages });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setContent({
              status: "error",
              message: err instanceof ApiError ? err.message : "Failed to load content",
            });
          }
        });
    } else if (selectedItem.nodeType === "memoryTouch") {
      setContent({ status: "loading" });
      fetchMemoryContent(project.id, selectedItem.rawId)
        .then((c) => {
          if (!cancelled) setContent({ status: "memory", text: c.content });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setContent({
              status: "error",
              message: err instanceof ApiError ? err.message : "Failed to load content",
            });
          }
        });
    } else if (selectedItem.nodeType === "subagent" && selectedItem.filePath) {
      // CR-UI-15: Agent content — reuses the session-content message shape (real transcript, or a
      // single synthesized message from `.meta.json`'s `description`).
      setContent({ status: "loading" });
      fetchAgentContent(project.id, selectedItem.filePath)
        .then((c) => {
          if (!cancelled) setContent({ status: "subagent", messages: c.messages });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setContent({
              status: "error",
              message: err instanceof ApiError ? err.message : "Failed to load content",
            });
          }
        });
    } else if (selectedItem.nodeType === "tool" && selectedItem.filePath) {
      // CR-UI-15: raw tool-output text — identical treatment to memory content.
      setContent({ status: "loading" });
      fetchToolContent(project.id, selectedItem.filePath)
        .then((c) => {
          if (!cancelled) setContent({ status: "tool", text: c.content });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setContent({
              status: "error",
              message: err instanceof ApiError ? err.message : "Failed to load content",
            });
          }
        });
    } else if (selectedItem.nodeType === "file" && selectedItem.filePath && selectedItem.sessionId) {
      // CR-CORE-05: raw file-history backup text — identical treatment to memory/tool content.
      // `filePath` here carries `backupFileName` (see `SelectedGraphItem.filePath`'s doc comment in
      // types.ts); `sessionId` is the owning session's id, needed alongside it to build the
      // `GET .../file-content` query.
      setContent({ status: "loading" });
      fetchFileContent(project.id, selectedItem.sessionId, selectedItem.filePath)
        .then((c) => {
          if (!cancelled) setContent({ status: "file", text: c.content });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setContent({
              status: "error",
              message: err instanceof ApiError ? err.message : "Failed to load content",
            });
          }
        });
    } else if (selectedItem.nodeType === "project") {
      // CR-UI-25: project-level content, resolved server-side (README -> CLAUDE.md -> earliest
      // session's first user message -> none).
      setContent({ status: "loading" });
      fetchProjectContent(project.id)
        .then((c) => {
          if (!cancelled) setContent({ status: "project", source: c.source, content: c.content });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setContent({
              status: "error",
              message: err instanceof ApiError ? err.message : "Failed to load content",
            });
          }
        });
    } else {
      setContent({ status: "unsupported" });
    }
    return () => {
      cancelled = true;
    };
  }, [
    project.id,
    selectedItem?.nodeType,
    selectedItem?.rawId,
    selectedItem?.filePath,
    selectedItem?.sessionId,
  ]);

  async function handleSaveNote() {
    if (!selectedItem) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const saved = await saveNote(project.id, selectedItem.nodeType, selectedItem.rawId, noteText);
      onNoteSaved(saved);
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : "Failed to save note");
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleDeleteNote() {
    if (!selectedItem) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      await deleteNote(project.id, selectedItem.nodeType, selectedItem.rawId);
      onNoteDeleted(selectedItem.nodeType, selectedItem.rawId);
      setNoteText("");
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : "Failed to delete note");
    } finally {
      setNoteSaving(false);
    }
  }

  // CR-UI-17: shown for every content type landed this sprint (session/memory/tool/subagent, plus
  // project when it actually resolved to real text) — hidden for "none"/"loading"/"error"/
  // "unsupported", where there's nothing to search.
  const showSearch =
    content.status === "session" ||
    content.status === "memory" ||
    content.status === "subagent" ||
    content.status === "tool" ||
    content.status === "file" ||
    (content.status === "project" && content.source !== "none");

  const searchableTexts = getSearchableTexts(content);
  const totalMatches = searchQuery
    ? searchableTexts.reduce((sum, text) => sum + countMatches(text, searchQuery), 0)
    : 0;

  // Reset to the first match whenever the query (re)produces a different match set, so Next/
  // Previous always starts from a valid, visible match rather than an index left over from a
  // longer previous query.
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  // Scroll the current match into view whenever it changes (new query, or Previous/Next).
  useEffect(() => {
    if (!searchQuery || totalMatches === 0) return;
    const el = contentViewRef.current?.querySelector('[data-testid="search-match-current"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [currentMatchIndex, searchQuery, totalMatches]);

  function goToNextMatch() {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((i) => (i + 1) % totalMatches);
  }

  function goToPreviousMatch() {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((i) => (i - 1 + totalMatches) % totalMatches);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.shiftKey) goToPreviousMatch();
    else goToNextMatch();
  }

  // Single mutable counter shared across every text block rendered below, so matches are numbered
  // in document order across the whole content view (e.g. every message of a session transcript).
  const matchCounter = { value: 0 };

  if (!selectedItem) {
    return (
      <div className="content-tab" data-testid="content-tab">
        <p className="hint">Select an item to see its content.</p>
      </div>
    );
  }

  return (
    <div className="content-tab" data-testid="content-tab">
      {/* CR-UI-17: search box, shown for every content type that has real searchable text. */}
      {showSearch && (
        <div className="content-search" data-testid="content-search">
          <input
            type="text"
            aria-label="Search content"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className="content-search-count" data-testid="content-search-count">
            {searchQuery ? (totalMatches > 0 ? `${currentMatchIndex + 1} of ${totalMatches}` : "0 matches") : ""}
          </span>
          <button
            type="button"
            onClick={goToPreviousMatch}
            disabled={totalMatches === 0}
            aria-label="Previous match"
          >
            ‹ Prev
          </button>
          <button type="button" onClick={goToNextMatch} disabled={totalMatches === 0} aria-label="Next match">
            Next ›
          </button>
        </div>
      )}
      <div className="content-view" data-testid="content-view" ref={contentViewRef}>
        {content.status === "loading" && <p className="hint">Loading…</p>}
        {content.status === "error" && <p className="error-text">{content.message}</p>}
        {content.status === "unsupported" && (
          <p className="hint" data-testid="content-unsupported">
            Content view not yet available for this item type.
          </p>
        )}
        {content.status === "session" &&
          (content.messages.length === 0 ? (
            <p className="hint">No readable messages in this session.</p>
          ) : (
            <div className="transcript" data-testid="session-transcript">
              {content.messages.map((m, i) => (
                <p key={i} className={`transcript-message transcript-${m.role}`}>
                  <strong>{m.role === "user" ? "User" : "Assistant"}:</strong>{" "}
                  {renderHighlighted(m.text, searchQuery, matchCounter, currentMatchIndex)}
                </p>
              ))}
            </div>
          ))}
        {content.status === "memory" && (
          <pre className="memory-content" data-testid="memory-content">
            {renderHighlighted(content.text, searchQuery, matchCounter, currentMatchIndex)}
          </pre>
        )}
        {/* CR-UI-15: Agent content — same transcript rendering as session content. */}
        {content.status === "subagent" &&
          (content.messages.length === 0 ? (
            <p className="hint">No readable content for this subagent.</p>
          ) : (
            <div className="transcript" data-testid="subagent-transcript">
              {content.messages.map((m, i) => (
                <p key={i} className={`transcript-message transcript-${m.role}`}>
                  <strong>{m.role === "user" ? "User" : "Assistant"}:</strong>{" "}
                  {renderHighlighted(m.text, searchQuery, matchCounter, currentMatchIndex)}
                </p>
              ))}
            </div>
          ))}
        {/* CR-UI-15: raw tool-output text — identical treatment to memory content. */}
        {content.status === "tool" && (
          <pre className="memory-content" data-testid="tool-content">
            {renderHighlighted(content.text, searchQuery, matchCounter, currentMatchIndex)}
          </pre>
        )}
        {/* CR-CORE-05: raw file-history backup text — identical treatment to memory/tool content,
            plain React text rendering only, never raw-HTML injection. */}
        {content.status === "file" && (
          <pre className="memory-content" data-testid="file-content">
            {renderHighlighted(content.text, searchQuery, matchCounter, currentMatchIndex)}
          </pre>
        )}
        {/* CR-UI-25: project-level content — plain scrollable read-only text (not Markdown-
            rendered), with a small source label so a first-message fallback doesn't read
            confusingly like arbitrary chat text with no context. */}
        {content.status === "project" &&
          (content.source === "none" ? (
            <p className="hint" data-testid="project-content-none">
              No README, CLAUDE.md, or sessions found for this project.
            </p>
          ) : (
            <>
              <p className="content-source-label" data-testid="project-content-source">
                {projectContentSourceLabel(content.source)}
              </p>
              <pre className="memory-content" data-testid="project-content">
                {content.content && renderHighlighted(content.content, searchQuery, matchCounter, currentMatchIndex)}
              </pre>
            </>
          ))}
      </div>

      {/* CR-CORE-03: view-only, ingest-written "stick-it" note — a separate, clearly-labeled
          section from the editable user-note below (no edit/save/delete control reachable here;
          this content has no client-facing write path at all, per the API contract). */}
      {stickItNote && (
        <div className="stick-it-note" data-testid="stick-it-note">
          <h3>Stick-it notes</h3>
          <div className="stick-it-note-content">
            {stickItNote.content.split("\n").map((line, i) => {
              const trimmed = line.trim();
              // CR-UI-37: blank lines (paragraph spacing within the aggregated note) render as a
              // line break only — nothing to jump to, so no click affordance.
              if (!trimmed) return <br key={i} />;
              return (
                // CR-UI-37: `role="link"` (jump-to-content), deliberately not `role="button"` —
                // the existing CR-CORE-03 regression test asserts zero `getByRole("button")`
                // matches within this section (no save/delete control reachable here); a link
                // role keeps that assertion true while still being a real, keyboard-reachable
                // interactive element (Enter activates, matching native link semantics).
                <p
                  key={i}
                  className="stick-it-note-line"
                  data-testid="stick-it-note-line"
                  role="link"
                  tabIndex={0}
                  onClick={() => setSearchQuery(trimmed)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    setSearchQuery(trimmed);
                  }}
                >
                  {trimmed}
                </p>
              );
            })}
          </div>
        </div>
      )}

      <div className="note-editor">
        <h3>Note</h3>
        {/* CR-UI-19: view mode (default when a saved note exists) renders the Markdown source as
            real formatted output — react-markdown's DEFAULT configuration only, no `rehype-raw`,
            so any literal HTML in the source (e.g. a <script> tag) renders as inert text rather
            than real DOM. This is a documented security invariant — do not add `rehype-raw`. */}
        {noteMode === "view" && existingNote ? (
          <div className="note-view" data-testid="note-view">
            <SafeMarkdown>{existingNote.content}</SafeMarkdown>
          </div>
        ) : (
          <textarea
            aria-label="Note"
            className="note-textarea"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={6}
          />
        )}
        {noteError && <p className="error-text">{noteError}</p>}
        <div className="note-actions">
          {existingNote && (
            <button type="button" onClick={handleDeleteNote} disabled={noteSaving}>
              Delete Note
            </button>
          )}
          {noteMode === "view" && existingNote ? (
            <button type="button" onClick={() => setNoteMode("edit")}>
              Edit
            </button>
          ) : (
            <button type="button" onClick={handleSaveNote} disabled={noteSaving}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
