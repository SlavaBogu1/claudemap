# stick-it

Tag moments in your Claude Code sessions as they happen, so [Claude Session Explorer](../README.md) can
surface them later when you visualize that project — without breaking your flow to write a note by hand.

## Install

Copy `stick-it.md` into a `.claude/commands/` directory:

- **Per-project** (recommended to start): `<your-project>/.claude/commands/stick-it.md`
- **Every project** (user-level): `~/.claude/commands/stick-it.md`

```bash
mkdir -p .claude/commands
cp stick-it.md .claude/commands/
```

That's it — no build step, no dependencies.

## Use

Inside any live Claude Code session, type:

```
/stick-it Found the root cause — race condition in the retry logic
```

This posts the literal text `[stick-it] Found the root cause — race condition in the retry logic` as
your own message in the session. Nothing leaves your machine and nothing runs in the background — the
command just sends that text like any other message you'd type.

The next time Claude Session Explorer scans this project, it picks up every `[stick-it]`-tagged message
in a session and aggregates them into a read-only note on that session. You'll see the same note-badge
indicator used for your own hand-written notes; open the session's Content tab to see the stick-it note
in its own view-only section, separate from any note you've written yourself.

## Notes

- Keep the tagged text on one line — the marker detection doesn't span line breaks.
- stick-it notes are never editable from Claude Session Explorer; they always reflect exactly what you
  typed in the session. To change a tag, tag it again in a later message — the newest scan aggregates
  everything found in the session.
- Your own hand-written notes (added via the Content tab) are completely separate and are never
  overwritten by stick-it tags, even if you tag and hand-write a note on the same session.
