# tau runtime

A self-contained CPython with [τ](https://github.com/jmccardle/tau) installed
into it, for the **tau code** extension (`ffwf.tau-code`).

**This extension does nothing on its own.** It ships files and tells tau code
where they are. Install it if you want tau code to work without installing
Python and τ yourself; skip it if you already have a `tau` on `PATH`.

## What is in it

```
runtime/
  manifest.json                    what this payload is, read by the extension
  bin/tau                          a shim, for your terminal
  python/
    bin/python3.11                 the interpreter
    lib/python3.11/                the standard library
      site-packages/               tau, pydantic, httpx, and pip
```

One interpreter, one copy of τ's RPC closure — 13 packages — and `pip`. No
Textual: τ's TUI is not what an editor extension runs, and leaving it out is 12
packages and ~18 MB.

## It does not touch your Python

The interpreter is spawned with `-I`, so `PYTHONPATH`, `PYTHONHOME`, your user
site directory and **the working directory** are all off `sys.path`. Two of
those are load-bearing, and each has a measured failure behind it.

**Your user site directory.** This is the one that bites without a project in
sight, because `~/.local/lib/python3.11/site-packages` is on every interpreter's
path by default — including this one:

```console
$ .../python/bin/python3.11 -c 'import typing_extensions as t; print(t.__file__)'
/home/you/.local/lib/python3.11/site-packages/typing_extensions.py   # yours

$ .../python/bin/python3.11 -I -c 'import typing_extensions as t; print(t.__file__)'
.../runtime/python/lib/python3.11/site-packages/typing_extensions.py # ours
```

An old `typing_extensions` there surfaces as `ImportError: cannot import name
'sentinel'` raised **inside a model streaming call**, nowhere near its cause.

**The working directory.** An agent's cwd is your project, and the shim runs
`-m`, which puts cwd on `sys.path[0]`. A file called `pydantic.py` in your
project would be imported instead of the real one:

```console
$ cd a-project-with-a-pydantic.py
$ .../python/bin/python3.11 -m tau_coding_agent.cli --version
SHADOWED: the workspace pydantic.py was imported

$ .../bin/tau --version          # the shim, which passes -I
tau 0.10.3
```

**This isolates τ's own imports, not its tools.** The process's working
directory is untouched, so `@file` completion, reads, writes and every shell
command still resolve against your project exactly as a system τ does. `-I`
governs `sys.path`; cwd is a separate thing, and only the first is closed.

The one place those two legitimately meet is a τ **extension**, which is project
Python that τ imports. τ 0.10.3 puts the extension's own directory on `sys.path`
for the length of its import, so a single-file extension's `import helper`
resolves the same under this runtime as under any other. Against τ 0.10.2 or
older that import fails — but it failed from a `pip`-installed `tau` too, for a
different reason, so this runtime is not the thing that broke it.

Nothing here reads or writes anything of yours except the session store and
config that τ itself uses — the same `~/.tau` the TUI uses, so the two
interoperate.

## Using it yourself

The payload is a relocatable directory, not an editor-only thing. **tau: Copy
Runtime Interpreter Path** puts the interpreter on your clipboard, and **tau:
Show Runtime Info** prints everything below.

```sh
"$RUNTIME/bin/tau" --help                     # the shim; -I is already in it
"$RUNTIME/python/bin/python3.11" -m pip list  # its own pip, its own site-packages
```

`pip install` into it works and is how a τ extension's dependency gets there.
It installs into this tree and reaches nothing else on your machine.

## When both this and a system τ are installed

tau code decides, and **says so** — the panel carries a banner when the two are
different versions, rather than picking quietly. `tau-code.runtime` chooses:

| | |
|---|---|
| `auto` (default) | this runtime when installed, otherwise `tau` on `PATH` |
| `bundled` | only this runtime; an error when it is absent |
| `system` | only `PATH` or `tau-code.binary`; ignore this extension |

A `tau-code.binary` you set explicitly beats all three. Naming a path is an
instruction, and a path that does not work is an error rather than a reason to
run something else.

## Platform builds

One `.vsix` per platform, and the editor installs the one matching the machine
that will run the agent. Over SSH, in WSL or in a devcontainer that is the
**remote** machine, not your laptop — which is why this declares
`extensionKind: ["workspace"]`, the same as tau code.

Built from this repository: `npm run package:runtime`. Targets are `linux-x64`,
`linux-arm64`, `linux-armhf`, `alpine-x64`, `alpine-arm64`, `darwin-x64`,
`darwin-arm64`, `win32-x64`, `win32-arm64`.

## Licence

MIT, for this extension. The payload redistributes CPython (PSF-2.0), pip (MIT),
τ (MIT) and τ's dependencies, each under its own licence; every wheel's
`dist-info` travels with it in `site-packages`.
