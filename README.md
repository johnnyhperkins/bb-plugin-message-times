# Message Times

A bb plugin that shows the time of each message in the thread chat. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for the behavior.

## Install

```bash
bb plugin install https://github.com/johnnyhperkins/bb-plugin-message-times
bb plugin update message-times   # gets the newest commit on main
```

bb clones the repository with `git` and builds the plugin. A private repository needs git access to GitHub on the bb machine. To give that access, run `gh auth login` and then `gh auth setup-git`.

## Development

```bash
npm install
npm test           # vitest
npm run typecheck  # tsc --noEmit
bb plugin build .
bb plugin reload message-times
```

The server part (`server.ts`, `lib/read-times.ts`) gives the `messageTimes` rpc. It reads the thread timeline without message text, and it reads the `turn/completed` events for the finish times.

The content script (`app.tsx`, `lib/decorate.ts`) finds each `[data-message-column]` element, gets the row id from the `data-timeline-row-id` ancestor, and asks the rpc for the times. It writes the label into `data-mt-*` attributes, and a stylesheet shows the label with `::after`. The script does not add nodes to the chat page.
