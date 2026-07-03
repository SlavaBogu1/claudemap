import { useEffect, useState } from "react";
import type { NodeType, NoteEntry, Project, SelectedGraphItem, SessionContentMessage } from "../types";
import { ApiError, deleteNote, fetchMemoryContent, fetchSessionContent, saveNote } from "../api/client";

// CR-UI-08 (Sprint 3, gated surface — implements the approved mockup exactly): the Detail panel's
// "Content" tab — real item content (session transcript / memory file text) plus an inline note
// editor, generalized across every selectable graph item type.

export interface ContentTabProps {
  project: Project;
  selectedItem: SelectedGraphItem | null;
  notes: NoteEntry[];
  onNoteSaved: (note: NoteEntry) => void;
  onNoteDeleted: (nodeType: NodeType, nodeId: string) => void;
}

type ContentState =
  | { status: "none" }
  | { status: "unsupported" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "session"; messages: SessionContentMessage[] }
  | { status: "memory"; text: string };

export function ContentTab({ project, selectedItem, notes, onNoteSaved, onNoteDeleted }: ContentTabProps) {
  const [content, setContent] = useState<ContentState>({ status: "none" });
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const existingNote = selectedItem
    ? (notes.find((n) => n.nodeType === selectedItem.nodeType && n.nodeId === selectedItem.rawId) ?? null)
    : null;

  // Reset the note editor's local draft whenever the selection (or its saved content) changes —
  // an empty textarea if no note exists yet.
  useEffect(() => {
    setNoteText(existingNote?.content ?? "");
    setNoteError(null);
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
    } else {
      setContent({ status: "unsupported" });
    }
    return () => {
      cancelled = true;
    };
  }, [project.id, selectedItem?.nodeType, selectedItem?.rawId]);

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

  if (!selectedItem) {
    return (
      <div className="content-tab" data-testid="content-tab">
        <p className="hint">Select an item to see its content.</p>
      </div>
    );
  }

  return (
    <div className="content-tab" data-testid="content-tab">
      <div className="content-view" data-testid="content-view">
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
                  <strong>{m.role === "user" ? "User" : "Assistant"}:</strong> {m.text}
                </p>
              ))}
            </div>
          ))}
        {content.status === "memory" && (
          <pre className="memory-content" data-testid="memory-content">
            {content.text}
          </pre>
        )}
      </div>

      <div className="note-editor">
        <h3>Note</h3>
        <textarea
          aria-label="Note"
          className="note-textarea"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={6}
        />
        {noteError && <p className="error-text">{noteError}</p>}
        <div className="note-actions">
          {existingNote && (
            <button type="button" onClick={handleDeleteNote} disabled={noteSaving}>
              Delete Note
            </button>
          )}
          <button type="button" onClick={handleSaveNote} disabled={noteSaving}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
