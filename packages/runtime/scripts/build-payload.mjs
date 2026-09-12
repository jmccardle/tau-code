/**
 * Assemble `runtime/` -- a relocatable CPython with tau installed into it.
 *
 *   node scripts/build-payload.mjs                    # this machine's target
 *   node scripts/build-payload.mjs --target win32-x64
 *   node scripts/build-payload.mjs --all
 *
 * Every target is built from ONE machine, and that is not a convenience: the
 * whole payload is a prebuilt interpreter plus wheels, and the only compiled
 * thing in tau's rpc closure is pydantic-core, which publishes a wheel for all
 * nine of VS Code's desktop targets. Nothing here compiles, so nothing here
 * needs a machine of the target's architecture. If that ever stops being true
 * -- a dependency with no wheel for some target -- this script fails on that
 * target rather than quietly shipping a payload missing a module.
 *
 * What it does NOT do is decide the tau version. That is `tauSpec` in
 * package.json, one copy, and the manifest this writes records what pip
 * actually installed by reading the dist-info back off disk.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');
const CACHE = join(PKG_ROOT, '.cache');
const PAYLOAD = join(PKG_ROOT, 'runtime');

/**
 * Which CPython. Pinned, not "latest": a build that resolves a different
 * interpreter each time it runs is a build whose output nobody can reproduce,
 * and the ABI tag below (`cp311`) has to agree with it or pip picks wheels this
 * interpreter cannot import.
 */
const PBS_RELEASE = '20260901';
const PY_VERSION = '3.11.16';
const PY_TAG = '311';
const PY_SHORT = '3.11';

const PBS_BASE = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}`;

/**
 * VS Code's platform targets, mapped to the two things a target decides: which
 * interpreter build to fetch, and which wheel tags pip may accept.
 *
 * The pip tags are LISTS because a wheel may be published under any of several
 * compatible names -- manylinux_2_17 and manylinux2014 are the same files under
 * two spellings, and a project that publishes only one of them still has to
 * resolve. Passing all of them is how a target avoids failing on a naming
 * choice upstream rather than on a real absence.
 *
 * `web` is deliberately absent and is not an oversight: see ARCHITECTURE 14.5.
 * A payload for it would be an interpreter with no filesystem, no subprocesses
 * and no sockets, which is an agent that cannot do the job tau exists to do.
 */
const TARGETS = {
  'linux-x64': {
    triple: 'x86_64-unknown-linux-gnu',
    layout: 'posix',
    pip: ['manylinux_2_17_x86_64', 'manylinux2014_x86_64', 'manylinux_2_28_x86_64', 'linux_x86_64'],
  },
  'linux-arm64': {
    triple: 'aarch64-unknown-linux-gnu',
    layout: 'posix',
    pip: ['manylinux_2_17_aarch64', 'manylinux2014_aarch64', 'manylinux_2_28_aarch64'],
  },
  'linux-armhf': {
    triple: 'armv7-unknown-linux-gnueabihf',
    layout: 'posix',
    pip: ['manylinux_2_17_armv7l', 'manylinux2014_armv7l'],
  },
  'alpine-x64': {
    triple: 'x86_64-unknown-linux-musl',
    layout: 'posix',
    pip: ['musllinux_1_1_x86_64', 'musllinux_1_2_x86_64'],
  },
  'alpine-arm64': {
    triple: 'aarch64-unknown-linux-musl',
    layout: 'posix',
    pip: ['musllinux_1_1_aarch64', 'musllinux_1_2_aarch64'],
  },
  'darwin-x64': {
    triple: 'x86_64-apple-darwin',
    layout: 'posix',
    pip: ['macosx_10_12_x86_64', 'macosx_10_9_x86_64', 'macosx_11_0_x86_64'],
  },
  'darwin-arm64': {
    triple: 'aarch64-apple-darwin',
    layout: 'posix',
    pip: ['macosx_11_0_arm64', 'macosx_12_0_arm64'],
  },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', layout: 'windows', pip: ['win_amd64'] },
  'win32-arm64': { triple: 'aarch64-pc-windows-msvc', layout: 'windows', pip: ['win_arm64'] },
};

/**
 * Dropped from the interpreter tree after extraction.
 *
 * Everything here is either a second copy of something (`__pycache__`), a
 * developer tool for building C extensions against this interpreter
 * (`include/`, the static library, `config-*`), or a GUI/test subtree nothing
 * in tau's closure imports. Measured on linux-x64, it is most of the
 * difference between the upstream tarball and what ships.
 *
 * pip and ensurepip are deliberately NOT here. They are what makes the shipped
 * environment usable on its own -- `<root>/python/bin/python3 -m pip install`
 * into it is how a tau extension's dependency gets installed -- and that is one
 * of the three things this extension exists to make true.
 */
const PRUNE_DIRS = ['test', 'tests', 'idlelib', 'turtledemo', 'lib2to3', 'tkinter'];

/**
 * Tcl/Tk, which comes to about 9 MB and which nothing here can reach once
 * `tkinter` is gone. Matched by pattern in the interpreter's library directory
 * rather than listed by name, because the version numbers are in the names
 * (`tcl9.0`, `itcl4.3.8`) and they move with every CPython build.
 *
 * `libpython` is excluded from the pattern explicitly. Deleting it is a real
 * saving and a separate, CHECKED step below -- not something a regex should be
 * able to do by accident.
 */
const TCL_PATTERN = /^(lib)?(tcl|tk|itcl|tdbc|thread|sqlite3\.)/i;

/**
 * Stripping is deliberately NOT done. Measured on linux-x64: the executable
 * goes 21.7 -> 19.7 MB and libpython 21.0 -> 19.8 MB, so the upstream
 * `install_only_stripped` asset is already stripped of debug info and `file`
 * reporting "not stripped" is about a symbol table worth ~2 MB each. Against
 * that, `strip` on a Mach-O invalidates its signature -- the hazard
 * gobboclippy's MacFinalize.cmake exists to sequence around -- and a payload
 * that will not load on macOS is a far worse trade than 4 MB. Recorded here so
 * the next person does not re-derive it.
 */

function say(message) {
  process.stderr.write(`${message}\n`);
}

function die(message) {
  process.stderr.write(`build-payload: ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) die(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) die(`${command} ${args.join(' ')} exited ${String(result.status)}`);
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) die(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    die(`${command} ${args.join(' ')} exited ${String(result.status)}: ${result.stderr ?? ''}`);
  }
  return result.stdout.trim();
}

/** Bytes on disk, walked rather than shelled out to, so this works on Windows too. */
function treeSize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += treeSize(child);
    else if (entry.isFile()) total += statSync(child).size;
  }
  return total;
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Delete every directory named in `names`, at any depth under `root`. */
function prune(root, names) {
  let removed = 0;
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = join(path, entry.name);
      if (entry.name === '__pycache__' || names.includes(entry.name)) {
        removed += treeSize(child);
        rmSync(child, { recursive: true, force: true });
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  return removed;
}

/**
 * Drop `libpython3.11.so.1.0`, but only after proving nothing asks for it.
 *
 * python-build-standalone links libpython statically INTO the `python3.11`
 * executable and ALSO ships it as a shared library, for embedders. Measured on
 * linux-x64: `ldd` on the executable names no libpython, and neither does any
 * lib-dynload module. It is 21 MB of file that nothing in this payload opens.
 *
 * The check is a byte scan for the SONAME across every plausible referrer,
 * rather than `ldd`, for one reason: `ldd` runs the target's binaries, and
 * eight of the nine targets cannot run here. A scan reads the same DT_NEEDED
 * string out of the file without executing it, so every target gets the same
 * check instead of only the host getting one.
 *
 * This is gobboclippy's SONAME lesson pointed the other way. There, staging the
 * linker name instead of the SONAME meant the package silently resolved against
 * the HOST's libpython and worked on every machine that had one. The failure
 * mode for getting this wrong is identical -- it works here and breaks on a
 * machine that has no Python -- which is why the deletion is conditional and
 * says which way it went.
 */
function dropUnreferencedLibpython(python, layout) {
  // Windows needs its python3XX.dll: there the executable is a stub and the
  // interpreter genuinely lives in the DLL.
  if (layout === 'windows') return 0;

  const libDir = join(python, 'lib');
  if (!existsSync(libDir)) return 0;
  const shared = readdirSync(libDir).filter((name) => /^libpython.*\.so($|\.)/.test(name));
  if (shared.length === 0) return 0;

  const referrers = [];
  const collect = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) referrers.push(join(dir, entry.name));
    }
  };
  collect(join(python, 'bin'));
  collect(join(python, 'lib', `python${PY_SHORT}`, 'lib-dynload'));
  collect(libDir);

  let freed = 0;
  for (const name of shared) {
    const path = join(libDir, name);
    const soname = Buffer.from(name, 'ascii');
    const wanted = referrers.find((file) => {
      if (file === path) return false;
      // A symlink chain to the same library is not a referrer either.
      if (/^libpython.*\.so($|\.)/.test(file.slice(libDir.length + 1))) return false;
      return readFileSync(file).includes(soname);
    });
    if (wanted) {
      say(`  keep    ${name} -- ${relative(python, wanted)} names it`);
      continue;
    }
    freed += statSync(path).size;
    rmSync(path, { force: true });
    say(`  drop    ${name} -- nothing in the payload names it (embedders only)`);
  }
  return freed;
}

/**
 * Collapse `bin/` to one interpreter and drop the scripts whose libraries are
 * gone.
 *
 * A .vsix is a zip, and vsce DEREFERENCES symlinks when it builds one. The
 * interpreter ships as `python3.11` with `python` and `python3` pointing at it,
 * so the archive got three independent 20.7 MB copies of the same binary --
 * measured, 34.3 MB packaged. Nothing warns about this: the extension works,
 * it is just three times the interpreter.
 *
 * The console scripts go for a different reason. `2to3` and `idle3` are
 * shebang lines pointing at lib2to3 and idlelib, both pruned above, and
 * `python3-config` reports the include directory and static library that are
 * pruned too. Each would be a file that exists, runs, and fails -- which is
 * worse than its absence, because absence is a message and a traceback is a
 * puzzle.
 */
function collapseBin(python, layout) {
  if (layout === 'windows') return 0;
  const binDir = join(python, 'bin');
  if (!existsSync(binDir)) return 0;

  const keep = new Set([`python${PY_SHORT}`, 'pip', 'pip3', `pip${PY_SHORT}`]);
  const real = join(binDir, `python${PY_SHORT}`);
  if (!existsSync(real)) die(`no bin/python${PY_SHORT} to collapse onto.`);
  const realSize = statSync(real).size;

  let freed = 0;
  for (const entry of readdirSync(binDir, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue;
    const path = join(binDir, entry.name);
    // Report what a zip WOULD have cost, not what the link costs here: a
    // symlink is a few bytes on this filesystem and a full copy in the archive.
    freed += entry.isSymbolicLink() ? realSize : statSync(path).size;
    rmSync(path, { force: true });
  }
  return freed;
}

/** Tcl/Tk shared libraries and data, unreachable once `tkinter` is pruned. */
function dropTcl(python, layout) {
  let freed = 0;
  const sweep = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!TCL_PATTERN.test(entry.name)) continue;
      const path = join(dir, entry.name);
      freed += entry.isDirectory() ? treeSize(path) : statSync(path).size;
      rmSync(path, { recursive: true, force: true });
    }
  };
  if (layout === 'windows') {
    sweep(join(python, 'tcl'));
    sweep(join(python, 'DLLs'));
  } else {
    sweep(join(python, 'lib'));
  }
  return freed;
}

async function download(url, into) {
  if (existsSync(into)) {
    say(`  cached  ${relative(PKG_ROOT, into)}`);
    return;
  }
  say(`  fetch   ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    die(`${url} answered ${String(response.status)} ${response.statusText}`);
  }
  mkdirSync(dirname(into), { recursive: true });
  const partial = `${into}.partial`;
  writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
  // Renamed only once whole, so an interrupted download cannot be picked up as
  // a cache hit on the next run.
  cpSync(partial, into);
  rmSync(partial);
}

/**
 * The version pip actually installed, read from the dist-info on disk.
 *
 * Not from the spec in package.json: the spec is a REQUEST, and if it were ever
 * loosened to a range the manifest would still have to say what shipped. This
 * is the same rule tau's own pyprojects apply to themselves -- one copy of the
 * number, and it is the one the artifact carries.
 */
function installedVersion(sitePackages, distribution) {
  const prefix = `${distribution.replace(/-/g, '_')}-`;
  const found = readdirSync(sitePackages).filter(
    (name) => name.startsWith(prefix) && name.endsWith('.dist-info'),
  );
  if (found.length !== 1) {
    die(
      `expected exactly one ${distribution} dist-info in ${sitePackages}, found ${String(found.length)}. ` +
        `The payload would ship a tau whose version nothing can state.`,
    );
  }
  return found[0].slice(prefix.length, -'.dist-info'.length);
}

function tauSpec() {
  const manifest = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
  const spec = manifest.tauSpec;
  if (typeof spec !== 'string' || spec === '') {
    die('package.json has no `tauSpec`. That is the one place the tau version is written.');
  }
  return spec;
}

/**
 * POSIX gets a shell script, Windows a .cmd. Both resolve the interpreter
 * RELATIVE TO THEMSELVES, because the whole tree moves: it is built here,
 * zipped into a .vsix, and unpacked into a different directory on every machine
 * that installs it. A shim with an absolute path in it is the same defect as
 * the console script pip generates, which is why neither is used.
 */
function writeShim(payload, layout) {
  const binDir = join(payload, 'bin');
  mkdirSync(binDir, { recursive: true });

  if (layout === 'windows') {
    const shim = join(binDir, 'tau.cmd');
    writeFileSync(
      shim,
      [
        '@echo off',
        'rem The bundled tau. %~dp0 is this file\'s own directory, so the tree relocates.',
        'rem -I is isolated mode: no PYTHONPATH, no PYTHONHOME, no user site, and no',
        'rem working directory on sys.path. See ARCHITECTURE 14.4.',
        '"%~dp0..\\python\\python.exe" -I -m tau_coding_agent.cli %*',
        '',
      ].join('\r\n'),
    );
    return 'bin/tau.cmd';
  }

  const shim = join(binDir, 'tau');
  writeFileSync(
    shim,
    [
      '#!/bin/sh',
      '# The bundled tau, resolved relative to this script so the tree relocates.',
      '#',
      '# -I is isolated mode: no PYTHONPATH, no PYTHONHOME, no user site, and no',
      '# working directory on sys.path. That last one is not tidiness -- without it',
      '# a file called pydantic.py in the project being worked on would be imported',
      '# instead of the real one. See ARCHITECTURE 14.4.',
      'set -e',
      'self="$0"',
      '# Follow symlinks, so `ln -s .../bin/tau ~/.local/bin/tau` works.',
      'while [ -L "$self" ]; do',
      '  link=$(readlink "$self")',
      '  case "$link" in',
      '    /*) self="$link" ;;',
      '    *)  self="$(dirname "$self")/$link" ;;',
      '  esac',
      'done',
      'here=$(cd "$(dirname "$self")" && pwd)',
      // python3.11 and not python3: the aliases are deleted, because a .vsix is
      // a zip and vsce turns each symlink into a full copy of the interpreter.
      `exec "$here/../python/bin/python${PY_SHORT}" -I -m tau_coding_agent.cli "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(shim, 0o755);
  return 'bin/tau';
}

/**
 * Prove the payload runs and speaks the protocol, the way docker/verify.mjs
 * proves it for the image. Only possible for the host's own target -- a
 * win32-arm64 payload cannot be executed here -- so cross builds get the
 * structural checks and say so rather than reporting a pass they did not do.
 */
async function verify(interpreter, args) {
  const version = capture(interpreter, [...args, '--version']);
  say(`  verify  ${version}`);

  // tau refuses to start without a model configured, so this bakes an address
  // nothing listens on into a throwaway HOME. Honest, because nothing calls it:
  // get_capabilities contacts no model.
  const home = mkdtempSync(join(tmpdir(), 'tau-runtime-verify-'));
  mkdirSync(join(home, '.tau'), { recursive: true });
  writeFileSync(
    join(home, '.tau', 'config.json'),
    JSON.stringify({
      models: {
        'verify-llm': {
          backend: 'openai',
          model: 'unused-by-verify',
          base_url: 'http://127.0.0.1:1/v1',
          api_key: 'not-needed',
        },
      },
      default_model: 'verify-llm',
      system_prompt: 'unused',
    }),
  );

  try {
    const protocol = await new Promise((resolve, reject) => {
      const child = spawn(interpreter, [...args, '--mode', 'rpc'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Isolated from this shell on purpose: the payload has to work with
        // none of a developer's Python environment reaching it. This is the
        // check gobboclippy's CI does by clearing LD_LIBRARY_PATH -- a bundled
        // runtime that silently resolves against the host's is one that works
        // on every machine that builds it and no machine that installs it.
        //
        // PYTHONDONTWRITEBYTECODE because this runs INSIDE the tree being
        // shipped. Without it, verifying the payload writes 2.5 MB of
        // __pycache__ back into it, every .pyc stamping this build machine's
        // absolute paths into co_filename -- so the check would be the thing
        // that spoiled what it checked. `-I` does not cover this; only the
        // environment variable and `-B` do.
        env: { HOME: home, PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' },
      });
      let stderr = '';
      let buffer = '';
      const deadline = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`no answer to get_capabilities within 30s. stderr:\n${stderr}`));
      }, 30_000);

      child.on('error', (error) => {
        clearTimeout(deadline);
        reject(new Error(`could not spawn the payload: ${error.message}`));
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('exit', (code) => {
        clearTimeout(deadline);
        reject(new Error(`the payload exited ${String(code)} before answering. stderr:\n${stderr}`));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        clearTimeout(deadline);
        child.removeAllListeners('exit');
        let reply;
        try {
          reply = JSON.parse(buffer.slice(0, end));
        } catch (error) {
          reject(new Error(`unparseable first line: ${buffer.slice(0, 200)}`));
          return;
        }
        child.kill('SIGKILL');
        const found = reply?.result?.protocol_version;
        if (!found) {
          reject(new Error(`get_capabilities answered without a protocol version: ${buffer.slice(0, 200)}`));
          return;
        }
        resolve(found);
      });

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_capabilities' })}\n`);
    });
    say(`  verify  speaks protocol ${protocol}, with no PYTHONPATH and no HOME of yours`);
    return protocol;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function hostTarget() {
  const arch = { x64: 'x64', arm64: 'arm64', arm: 'armhf' }[process.arch];
  if (!arch) return null;
  if (process.platform === 'win32') return `win32-${arch}`;
  if (process.platform === 'darwin') return `darwin-${arch}`;
  if (process.platform === 'linux') {
    // musl and glibc are different payloads and `process.platform` cannot tell
    // them apart. Reported rather than guessed: a glibc payload on Alpine fails
    // at load time with a message about ld-linux that names nothing useful.
    const musl = existsSync('/lib/ld-musl-x86_64.so.1') || existsSync('/lib/ld-musl-aarch64.so.1');
    return `${musl ? 'alpine' : 'linux'}-${arch}`;
  }
  return null;
}

async function build(target, options) {
  const spec = TARGETS[target];
  if (!spec) {
    die(
      `unknown target '${target}'. Known: ${Object.keys(TARGETS).join(', ')}.\n` +
        `  'web' is deliberately not one of them; see docs/ARCHITECTURE.md 14.5.`,
    );
  }

  const out = options.all ? join(PKG_ROOT, 'payloads', target, 'runtime') : PAYLOAD;
  say(`\n=== ${target}  (${spec.triple})`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // --- the interpreter ------------------------------------------------------
  const asset = `cpython-${PY_VERSION}+${PBS_RELEASE}-${spec.triple}-install_only_stripped.tar.gz`;
  const tarball = join(CACHE, asset);
  await download(`${PBS_BASE}/${asset}`, tarball);

  // The tarball's own top-level directory is `python/`, which is the layout
  // this expects. Extracting into `out` therefore produces `out/python`.
  run('tar', ['-xzf', tarball, '-C', out]);
  const python = join(out, 'python');
  if (!existsSync(python)) die(`${asset} did not extract a python/ directory.`);

  const raw = treeSize(python);

  // --- tau ------------------------------------------------------------------
  const sitePackages =
    spec.layout === 'windows'
      ? join(python, 'Lib', 'site-packages')
      : join(python, 'lib', `python${PY_SHORT}`, 'site-packages');
  mkdirSync(sitePackages, { recursive: true });

  const pip = process.env.PYTHON ?? 'python3';
  const platformArgs = spec.pip.flatMap((tag) => ['--platform', tag]);
  say(`  pip     ${tauSpec()} -> ${relative(out, sitePackages)}`);
  run(pip, [
    '-m',
    'pip',
    'install',
    '--quiet',
    '--target',
    sitePackages,
    '--python-version',
    PY_TAG,
    '--implementation',
    'cp',
    ...platformArgs,
    // Required by pip whenever --platform is given, and correct regardless: a
    // source distribution would be built by THIS machine's compiler, for this
    // machine's architecture, and land in a payload for another one.
    '--only-binary=:all:',
    // .pyc files are written on first import by the user's own interpreter.
    // Shipping them would ship this machine's absolute paths in every code
    // object's co_filename, which is both larger and a small privacy leak.
    '--no-compile',
    '--upgrade',
    tauSpec(),
  ]);

  // `--target` writes console scripts into <target>/bin. They carry an absolute
  // shebang naming the interpreter on THIS machine, so they are wrong the
  // moment the .vsix is installed anywhere. `bin/tau` below is the replacement.
  for (const stray of ['bin', 'Scripts']) {
    rmSync(join(sitePackages, stray), { recursive: true, force: true });
  }

  const tauVersion = installedVersion(sitePackages, 'ffwf_tau_coding_agent');

  // --- the shim -------------------------------------------------------------
  const shim = writeShim(out, spec.layout);

  // --- the manifest ---------------------------------------------------------
  const interpreterRel =
    spec.layout === 'windows' ? 'python/python.exe' : `python/bin/python${PY_SHORT}`;
  const interpreter = join(out, interpreterRel);
  if (!existsSync(interpreter)) die(`no interpreter at ${interpreter} after extraction.`);
  if (spec.layout !== 'windows') chmodSync(interpreter, 0o755);

  // The one compiled thing in the closure. Checked by name, because a payload
  // that is missing it or carries another platform's imports as an ImportError
  // at the first model call -- long after the build that caused it.
  const native = readdirSync(join(sitePackages, 'pydantic_core')).filter(
    (name) => name.endsWith('.so') || name.endsWith('.pyd'),
  );
  if (native.length === 0) {
    die(`pydantic_core in this payload has no compiled module. pip resolved a pure-Python fallback, which does not exist -- so this is a wheel tag mismatch for ${target}.`);
  }
  say(`  native  ${native.join(', ')}`);

  const args = ['-I', '-m', 'tau_coding_agent.cli'];
  const manifest = {
    apiVersion: 1,
    target,
    interpreter: interpreterRel,
    shim,
    args,
    pythonVersion: PY_VERSION,
    tauVersion,
    tauSpec: tauSpec(),
    pbsRelease: PBS_RELEASE,
    builtAt: new Date().toISOString(),
  };

  // --- verify ---------------------------------------------------------------
  //
  // BEFORE pruning, not after. Running the interpreter is what produces
  // __pycache__, so a verify that ran last would leave 2.5 MB of this machine's
  // paths in a tree the prune step had already finished cleaning.
  if (target === hostTarget()) {
    manifest.protocolVersion = await verify(interpreter, args);
  } else {
    say(`  verify  structural only -- ${target} cannot be executed on a ${hostTarget() ?? 'unknown'} host`);
  }

  // --- prune ----------------------------------------------------------------
  let removed = 0;
  if (!options.keepDev) {
    removed += prune(python, PRUNE_DIRS);
    removed += dropTcl(python, spec.layout);
    removed += dropUnreferencedLibpython(python, spec.layout);
    removed += collapseBin(python, spec.layout);
    // ensurepip carries pip and setuptools a SECOND time, as wheels, for
    // bootstrapping a venv. pip itself is already installed in site-packages
    // and is what `python -m pip install` uses, so this copy only matters to
    // `python -m venv`, which still works with --without-pip.
    removed += (() => {
      const bundled = join(python, 'lib', `python${PY_SHORT}`, 'ensurepip', '_bundled');
      const windows = join(python, 'Lib', 'ensurepip', '_bundled');
      let freed = 0;
      for (const path of [bundled, windows]) {
        if (!existsSync(path)) continue;
        freed += treeSize(path);
        rmSync(path, { recursive: true, force: true });
      }
      return freed;
    })();
    // Headers and the static library exist to BUILD C extensions against this
    // interpreter. Installing a wheel does not, and --only-binary is the rule
    // above besides.
    for (const dev of ['include', 'share']) {
      const path = join(python, dev);
      if (!existsSync(path)) continue;
      removed += treeSize(path);
      rmSync(path, { recursive: true, force: true });
    }
    const libDir = join(python, 'lib');
    if (existsSync(libDir)) {
      for (const entry of readdirSync(libDir)) {
        if (!entry.endsWith('.a')) continue;
        removed += statSync(join(libDir, entry)).size;
        rmSync(join(libDir, entry), { force: true });
      }
    }
    // Re-check: every deletion above is meant to be unreachable, and the one
    // way to find out cheaply is to ask the interpreter again.
    if (target === hostTarget()) {
      say(`  verify  re-checking after prune`);
      await verify(interpreter, args);
      prune(python, []);
    }
  }

  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const final = treeSize(out);
  say(
    `  size    ${mb(final)} on disk  (interpreter ${mb(raw)}, pruned ${mb(removed)}, tau ${mb(treeSize(sitePackages))})`,
  );
  say(`  tau     ${tauVersion} on Python ${PY_VERSION}`);
  return { target, tauVersion, bytes: final };
}

// ------------------------------------------------------------------- main
const argv = process.argv.slice(2);
const options = {
  all: argv.includes('--all'),
  keepDev: argv.includes('--keep-dev'),
};
const flagIndex = argv.indexOf('--target');
const asked = flagIndex >= 0 ? argv[flagIndex + 1] : null;

if (argv.includes('--help') || argv.includes('-h')) {
  say('usage: build-payload.mjs [--target <vscode-target>] [--all] [--keep-dev]');
  say(`targets: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(0);
}

const targets = options.all ? Object.keys(TARGETS) : [asked ?? hostTarget()];
if (targets[0] === null) {
  die(
    `this host is ${process.platform}/${process.arch}, which is not one of VS Code's targets. ` +
      `Name one with --target.`,
  );
}

const built = [];
for (const target of targets) {
  built.push(await build(target, options));
}

say('');
for (const row of built) {
  say(`  ${row.target.padEnd(14)} tau ${row.tauVersion}  ${mb(row.bytes)}`);
}
