# rafa

rafa is the open-tomato command line for the work around the code: issues, pull requests, CI,
plans and the loops that run them. A project made from this template can use it from the start,
and the template already holds the one line rafa writes into a repository.

## What it is and when to turn it on

Turn it on when the project's issues, pull requests and CI go through rafa, and an agent working
in the project should use it too. rafa keeps its state in `.rafa/` at the project root, which
`.gitignore` already leaves out, between the `rafa tracking` markers that `rafa init` rewrites.

## Setup from zero

1. Check that rafa is on `PATH`: `rafa --version` prints its version.
2. Set the project up from its root: `rafa init --root=.`. It writes `.rafa/config.yaml`, with
   every setting commented out at its default, and the `.gitignore` entry between the markers.
3. Check the prerequisites a loop needs: `rafa doctor`.
4. Read what rafa can do, once: `rafa describe --output=json` prints every command as one JSON
   document.
5. Tell the agent. Copy the "Additional tooling" section of this template's `CLAUDE.md` into the
   project's `CLAUDE.md`.

## Configuration

`.rafa/config.yaml` holds the project's settings, and `~/.rafa/config.yaml` the user's. A setting
in the project file outranks the same one in the user file. `rafa config` shows every setting and
where it came from, and sets one key in the project file.

The skills and agents rafa brings are listed with `rafa skill list` and `rafa agent list`. Both
lists are long, so read them once, when the project is set up, and again only when asked.

## Check it works

`rafa doctor` reports each prerequisite with its state. `rafa status` shows the project's
current state.

## Turn it off

Delete `.rafa/` and the "Additional tooling" section of `CLAUDE.md`. `.rafa/` is gitignored, so
deleting it changes no tracked file.

## Troubleshooting

`rafa <group> <action> --help` shows the arguments, flags and examples of one command. The
groups are singular: `rafa skill`, `rafa agent`, `rafa issue`, `rafa pr`.
