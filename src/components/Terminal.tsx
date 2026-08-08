import { useState, useEffect, useRef } from "react";
import { TerminalOutput } from "./TerminalOutput";
import { BootSequence } from "./BootSequence";
import { useTerminalSounds } from "../hooks/useTerminalSounds";
import { askAI } from "@/lib/llm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  command: string;
  output: React.ReactNode;
  timestamp: Date;
  promptPath: string;
}

interface FSNode {
  type: "dir" | "file";
  content?: string;
  children?: Record<string, FSNode>;
}

interface ParsedCommand {
  cmd: string;
  rawArgs: string[];   // tokens after cmd (flags included)
  args: string[];      // non-flag tokens
  flags: string[];     // tokens starting with -
  fullArgs: string;    // rawArgs joined (for echo)
  redirectTarget?: string;
  redirectMode?: ">" | ">>";
}

// ─── Virtual Filesystem ───────────────────────────────────────────────────────

const INITIAL_FS: FSNode = {
  type: "dir",
  children: {
    "README.md": {
      type: "file",
      content: `Som Satwik Deo — Developer Portfolio
======================================
Type 'help'     to see available commands.
Type 'about'    to learn about me.
Type 'projects' to see my projects.
Type 'ls'       to explore this filesystem.

GitHub  : https://github.com/SomSatwik
LinkedIn: https://linkedin.com/in/som-satwik-deo
Email   : ssomsatwikdeo@gmail.com`,
    },
    about: { type: "dir", children: {} },
    skills: { type: "dir", children: {} },
    experience: { type: "dir", children: {} },
    contact: { type: "dir", children: {} },
    projects: {
      type: "dir",
      children: {
        CyberBattleground: {
          type: "dir",
          children: {
            "README.md": {
              type: "file",
              content: `# CyberBattleground
====================
Competitive real-time cybersecurity platform.
Hack The Box meets Valorant.

Features:
  - 3v3 Red Team vs Blue Team combat
  - Real CVE-based challenges
  - Isolated Docker environments
    (DVWA, OWASP Juice Shop, WebGoat)
  - Live WebSocket scoreboard
  - 6-tier ranking system
  - Cyber Credits economy
  - Stripe monetization (INR + USD)

Tech Stack: Next.js · TypeScript · Docker · WebSocket · Stripe
GitHub    : https://github.com/SomSatwik/CyberBattleground
Stars     : 18+`,
            },
            "package.json": {
              type: "file",
              content: `{
  "name": "cyberbattleground",
  "version": "1.0.0",
  "description": "Competitive real-time cybersecurity platform"
}`,
            },
            src: { type: "dir", children: {} },
          },
        },
        "realtime-tracker": {
          type: "dir",
          children: {
            "README.md": {
              type: "file",
              content: `# realtime-tracker
===================
Real-time bus tracking system.

Features:
  - Live location tracking via Socket.io
  - CRUD API for Students, Courses, Departments
  - Role-based access control (RBAC)
  - Security and privacy controls

Tech Stack: Node.js · Socket.io · MongoDB · Leaflet.js · Kotlin
GitHub    : https://github.com/SomSatwik/realtime-tracker`,
            },
            src: { type: "dir", children: {} },
          },
        },
        "cellular-automaton": {
          type: "dir",
          children: {
            "README.md": {
              type: "file",
              content: `# cellular-automaton
======================
Conway's Game of Life inspired cellular automaton engine.

Simulates emergent behavior from simple local rules:
  - Birth conditions
  - Death conditions
  - Survival conditions

Currently exploring:
  - Artificial life & emergent systems
  - Evolutionary simulations
  - Complex behavior from simple rules`,
            },
            src: { type: "dir", children: {} },
          },
        },
      },
    },
  },
};

const FS_KEY = "som_vfs_v1";
const HIST_KEY = "som_cmd_hist_v1";

function loadFS(): FSNode {
  try {
    const s = localStorage.getItem(FS_KEY);
    if (s) return JSON.parse(s);
  } catch { /* ignore */ }
  return JSON.parse(JSON.stringify(INITIAL_FS));
}

function saveFS(fs: FSNode): void {
  try { localStorage.setItem(FS_KEY, JSON.stringify(fs)); } catch { /* ignore */ }
}

// ─── FS Helpers ───────────────────────────────────────────────────────────────

function getNode(fs: FSNode, parts: string[]): FSNode | null {
  let node = fs;
  for (const p of parts) {
    if (node.type !== "dir" || !node.children?.[p]) return null;
    node = node.children[p];
  }
  return node;
}

function resolvePath(current: string[], target: string): string[] {
  if (target === "/" || target === "~") return [];
  let base: string[];
  let rel: string;
  if (target.startsWith("~/")) { base = []; rel = target.slice(2); }
  else if (target.startsWith("/")) { base = []; rel = target.slice(1); }
  else { base = [...current]; rel = target; }
  for (const seg of rel.split("/").filter(Boolean)) {
    if (seg === "..") { if (base.length) base.pop(); }
    else if (seg !== ".") base.push(seg);
  }
  return base;
}

function pathToPrompt(path: string[]): string {
  return path.length === 0 ? "~" : `~/${path.join("/")}`;
}

function setNode(fs: FSNode, parts: string[], node: FSNode): FSNode {
  if (!parts.length) return node;
  const [head, ...tail] = parts;
  const newFS: FSNode = { ...fs, children: { ...(fs.children ?? {}) } };
  newFS.children![head] = tail.length === 0
    ? node
    : setNode(newFS.children![head] ?? { type: "dir", children: {} }, tail, node);
  return newFS;
}

function deleteNode(fs: FSNode, parts: string[]): FSNode {
  if (!parts.length) return fs;
  const [head, ...tail] = parts;
  const newFS: FSNode = { ...fs, children: { ...(fs.children ?? {}) } };
  if (!newFS.children) return fs;
  if (!tail.length) { delete newFS.children[head]; }
  else if (newFS.children[head]?.type === "dir") {
    newFS.children[head] = deleteNode(newFS.children[head], tail);
  }
  return newFS;
}

// ─── Command Parser ───────────────────────────────────────────────────────────

function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false, qCh = "";
  for (const ch of input) {
    if (inQ) { if (ch === qCh) { inQ = false; out.push(cur); cur = ""; } else cur += ch; }
    else if (ch === '"' || ch === "'") { inQ = true; qCh = ch; }
    else if (ch === " ") { if (cur) { out.push(cur); cur = ""; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseCommand(raw: string): ParsedCommand {
  let input = raw.trim();
  let redirectTarget: string | undefined;
  let redirectMode: ">" | ">>" | undefined;

  const appIdx = input.indexOf(">>");
  const wrtIdx = input.indexOf(">");
  if (appIdx !== -1) {
    redirectMode = ">>"; redirectTarget = input.slice(appIdx + 2).trim().replace(/^["'](.*)["']$/, "$1");
    input = input.slice(0, appIdx).trim();
  } else if (wrtIdx !== -1) {
    redirectMode = ">"; redirectTarget = input.slice(wrtIdx + 1).trim().replace(/^["'](.*)["']$/, "$1");
    input = input.slice(0, wrtIdx).trim();
  }

  const tokens = tokenize(input);
  const cmd = (tokens[0] ?? "").toLowerCase();
  const rawArgs = tokens.slice(1);
  const flags = rawArgs.filter(t => t.startsWith("-"));
  const args = rawArgs.filter(t => !t.startsWith("-"));
  const fullArgs = rawArgs.join(" ");

  return { cmd, rawArgs, args, flags, fullArgs, redirectTarget, redirectMode };
}

// ─── Shell Command Runner (pure — no React state) ─────────────────────────────

function runShellCmd(
  parsed: ParsedCommand,
  fs: FSNode,
  path: string[],
  cmdHist: string[]
): { output: React.ReactNode; newPath?: string[]; newFS?: FSNode } {
  const { cmd, args, flags, fullArgs, redirectTarget, redirectMode, rawArgs } = parsed;

  // pwd
  if (cmd === "pwd") {
    const full = path.length === 0 ? "/home/som" : `/home/som/${path.join("/")}`;
    return { output: <p className="terminal-info">{full}</p> };
  }

  // ls
  if (cmd === "ls") {
    const tp = args[0] ? resolvePath(path, args[0]) : path;
    const node = getNode(fs, tp);
    if (!node) return { output: <p className="terminal-error">ls: cannot access &apos;{args[0]}&apos;: No such file or directory</p> };
    if (node.type === "file") return { output: <p className="text-foreground">{args[0]}</p> };
    const entries = Object.keys(node.children ?? {}).sort();
    if (!entries.length) return { output: null };
    return {
      output: (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {entries.map(name => {
            const isDir = node.children![name].type === "dir";
            return <span key={name} className={isDir ? "terminal-info" : "text-foreground"}>{name}{isDir ? "/" : ""}</span>;
          })}
        </div>
      ),
    };
  }

  // cd
  if (cmd === "cd") {
    const target = args[0] ?? "~";
    const newPath = resolvePath(path, target);
    const node = getNode(fs, newPath);
    if (!node) return { output: <p className="terminal-error">cd: no such file or directory: {target}</p> };
    if (node.type === "file") return { output: <p className="terminal-error">cd: not a directory: {target}</p> };
    return { output: null, newPath };
  }

  // mkdir
  if (cmd === "mkdir") {
    if (!args.length) return { output: <p className="terminal-error">mkdir: missing operand</p> };
    const mkdirP = flags.includes("-p");
    let newFS = fs;
    for (const dirArg of args) {
      const tp = resolvePath(path, dirArg);
      if (!tp.length) return { output: <p className="terminal-error">mkdir: cannot create directory &apos;/&apos;: File exists</p> };
      if (getNode(newFS, tp)) {
        if (!mkdirP) return { output: <p className="terminal-error">mkdir: cannot create directory &apos;{dirArg}&apos;: File exists</p> };
        continue;
      }
      if (!getNode(newFS, tp.slice(0, -1)) && !mkdirP) {
        return { output: <p className="terminal-error">mkdir: cannot create directory &apos;{dirArg}&apos;: No such file or directory</p> };
      }
      // Create all intermediate dirs (-p or single)
      let cum: string[] = [];
      for (const seg of tp) {
        cum = [...cum, seg];
        if (!getNode(newFS, cum)) newFS = setNode(newFS, cum, { type: "dir", children: {} });
      }
    }
    return { output: null, newFS };
  }

  // touch
  if (cmd === "touch") {
    if (!args.length) return { output: <p className="terminal-error">touch: missing file operand</p> };
    let newFS = fs;
    for (const fa of args) {
      const tp = resolvePath(path, fa);
      if (!getNode(newFS, tp)) newFS = setNode(newFS, tp, { type: "file", content: "" });
    }
    return { output: null, newFS };
  }

  // echo
  if (cmd === "echo") {
    const text = fullArgs;
    if (redirectTarget && redirectMode) {
      const tp = resolvePath(path, redirectTarget);
      const existing = getNode(fs, tp);
      const newContent = redirectMode === ">>" && existing?.type === "file"
        ? (existing.content ?? "") + "\n" + text
        : text;
      return { output: null, newFS: setNode(fs, tp, { type: "file", content: newContent }) };
    }
    return { output: <p className="text-foreground">{text}</p> };
  }

  // cat
  if (cmd === "cat") {
    if (!args.length) return { output: <p className="terminal-error">cat: missing operand</p> };
    const parts: React.ReactNode[] = [];
    for (const fa of args) {
      const tp = resolvePath(path, fa);
      const node = getNode(fs, tp);
      if (!node) parts.push(<p key={fa} className="terminal-error">cat: {fa}: No such file or directory</p>);
      else if (node.type === "dir") parts.push(<p key={fa} className="terminal-error">cat: {fa}: Is a directory</p>);
      else parts.push(<pre key={fa} className="whitespace-pre-wrap text-foreground">{node.content ?? ""}</pre>);
    }
    return { output: <div>{parts}</div> };
  }

  // rm
  if (cmd === "rm") {
    if (!args.length) return { output: <p className="terminal-error">rm: missing operand</p> };
    const recursive = flags.some(f => f.includes("r"));
    let newFS = fs;
    for (const target of args) {
      const tp = resolvePath(path, target);
      const node = getNode(newFS, tp);
      if (!node) return { output: <p className="terminal-error">rm: cannot remove &apos;{target}&apos;: No such file or directory</p> };
      if (node.type === "dir" && !recursive) return { output: <p className="terminal-error">rm: cannot remove &apos;{target}&apos;: Is a directory (use -r)</p> };
      newFS = deleteNode(newFS, tp);
    }
    return { output: null, newFS };
  }

  // whoami
  if (cmd === "whoami") return { output: <p className="terminal-success">som-satwik</p> };

  // uname
  if (cmd === "uname") {
    const all = rawArgs.includes("-a");
    return { output: <p className="terminal-info">{all ? "Linux som-portfolio 6.8.0 #1 SMP x86_64 GNU/Linux (simulated)" : "Linux"}</p> };
  }

  // date
  if (cmd === "date") return { output: <p className="terminal-info">{new Date().toLocaleString()}</p> };

  // history
  if (cmd === "history") {
    if (!cmdHist.length) return { output: <p className="terminal-gray">No command history yet.</p> };
    return {
      output: (
        <div className="terminal-output">
          {cmdHist.slice(-50).map((h, i) => (
            <div key={i} className="flex gap-4">
              <span className="terminal-gray w-6 text-right shrink-0">{i + 1}</span>
              <span className="text-foreground">{h}</span>
            </div>
          ))}
        </div>
      ),
    };
  }

  // neofetch
  if (cmd === "neofetch") {
    return {
      output: (
        <div className="terminal-output">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p><span className="terminal-success">OS:</span> <span className="terminal-info">Ubuntu 22.04 LTS (simulated)</span></p>
              <p><span className="terminal-success">Kernel:</span> <span className="terminal-info">Linux 6.8.0</span></p>
              <p><span className="terminal-success">Shell:</span> <span className="terminal-info">portfolio-sh 2.0</span></p>
              <p><span className="terminal-success">Terminal:</span> <span className="terminal-info">React Terminal v2.0.1</span></p>
            </div>
            <div className="space-y-1">
              <p><span className="terminal-success">User:</span> <span className="terminal-info">som-satwik</span></p>
              <p><span className="terminal-success">Editor:</span> <span className="terminal-info">VS Code</span></p>
              <p><span className="terminal-success">Path:</span> <span className="terminal-info">{pathToPrompt(path)}</span></p>
              <p><span className="terminal-success">Time:</span> <span className="terminal-info">{new Date().toLocaleTimeString()}</span></p>
            </div>
          </div>
        </div>
      ),
    };
  }

  // help
  if (cmd === "help") {
    return {
      output: (
        <div className="terminal-output">
          <p className="mb-3 terminal-success">Available commands:</p>

          <p className="terminal-warning font-bold mb-1">PORTFOLIO</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 ml-4 mb-4 text-sm">
            {([
              ["about",      "About Som Satwik"],
              ["skills",     "Technical skills"],
              ["projects",   "My projects"],
              ["experience", "Experience & leadership"],
              ["contact",    "Contact information"],
              ["resume",     "Download resume"],
              ["banner",     "Show ASCII banner"],
              ["theme",      "Toggle light/dark"],
              ["matrix",     "Matrix rain effect 🟢"],
              ["fortune",    "Random dev quote 🔮"],
              ["neofetch",   "System information"],
              ["demo",       "Interactive demo"],
            ] as [string, string][]).map(([c, d]) => (
              <div key={c}>
                <span className="terminal-warning">{c}</span>
                <span className="terminal-gray"> — {d}</span>
              </div>
            ))}
          </div>

          <p className="terminal-info font-bold mb-1">SHELL</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 ml-4 mb-3 text-sm">
            {([
              ["pwd",            "Print working directory"],
              ["ls [path]",      "List files & directories"],
              ["cd [path]",      "Change directory (~ .. ~/path)"],
              ["mkdir [-p] dir", "Create directory"],
              ["touch file",     "Create empty file"],
              ["cat file",       "Read file contents"],
              ["echo text",      "Print text (supports > and >>)"],
              ["rm [-r] path",   "Remove file or directory"],
              ["clear",          "Clear terminal output"],
              ["whoami",         "Current user"],
              ["uname [-a]",     "System information"],
              ["date",           "Current date & time"],
              ["history",        "Command history"],
            ] as [string, string][]).map(([c, d]) => (
              <div key={c}>
                <span className="terminal-info">{c}</span>
                <span className="terminal-gray"> — {d}</span>
              </div>
            ))}
          </div>

          <p className="terminal-gray text-sm">
            Tips: ↑/↓ history · Tab autocomplete · Ctrl+L clear · cd projects &amp;&amp; ls to explore
          </p>
        </div>
      ),
    };
  }

  return { output: <p className="terminal-error">bash: {cmd}: command not found</p> };
}

// ─── ASCII Art ────────────────────────────────────────────────────────────────

const ASCII_ART = `
███████╗ ██████╗ ███╗   ███╗    ███████╗ █████╗ ████████╗██╗    ██╗██╗██╗  ██╗
██╔════╝██╔═══██╗████╗ ████║    ██╔════╝██╔══██╗╚══██╔══╝██║    ██║██║██║ ██╔╝
███████╗██║   ██║██╔████╔██║    ███████╗███████║   ██║   ██║ █╗ ██║██║█████╔╝
╚════██║██║   ██║██║╚██╔╝██║    ╚════██║██╔══██║   ██║   ██║███╗██║██║██╔═██╗
███████║╚██████╔╝██║ ╚═╝ ██║    ███████║██║  ██║   ██║   ╚███╔███╔╝██║██║  ██╗
╚══════╝ ╚═════╝ ╚═╝     ╚═╝    ╚══════╝╚═╝  ╚═╝   ╚═╝    ╚══╝╚══╝ ╚═╝╚═╝  ╚═╝

`;

const BANNER_INFO = `
Welcome to Som Satwik Deo's Portfolio Terminal

CSE Student  •  India  •  Open Source Developer
Software  •  Real-time Systems  •  Cybersecurity  •  AI/Agents  •  Emergent Systems

Type 'help' to get started   |   Type 'ls' to explore the filesystem
Portfolio v2.0.1 - Built with React & TypeScript
`;

// ─── Portfolio Commands (display-only, no state deps) ─────────────────────────

const PORTFOLIO_CMDS: Record<string, () => React.ReactNode> = {
  banner: () => (
    <div className="terminal-output">
      <pre className="terminal-success text-xs md:text-sm mb-4 overflow-x-auto">{ASCII_ART}</pre>
      <div className="terminal-info whitespace-pre-line">{BANNER_INFO}</div>
    </div>
  ),

  about: () => (
    <div className="terminal-output">
      <p className="mb-2">Hey there.</p>
      <p className="mb-2">
        I'm <span className="terminal-info">Som Satwik Deo</span>, a Computer Science
        Engineering student in India.
      </p>
      <p className="mb-2">
        I'm interested in software development, real-time systems, cybersecurity,
        AI/agents, and artificial life — areas where software, automation,
        intelligence, and real-time interaction come together.
      </p>
      <p className="mb-2">Currently exploring:</p>
      <ul className="list-disc list-inside ml-4 mb-2">
        <li><span className="terminal-success">Artificial life</span> &amp; emergent systems</li>
        <li><span className="terminal-info">Cellular automata</span> &amp; evolutionary simulations</li>
        <li><span className="terminal-warning">Real-time systems</span> &amp; competitive security platforms</li>
      </ul>
      <p className="mb-2">
        I enjoy building technically ambitious projects and contributing to open source.
      </p>
      <p className="terminal-gray text-sm">
        Education: B.Tech in Computer Science Engineering (2024–2028)
      </p>
    </div>
  ),

  projects: () => (
    <div className="terminal-output">
      <p className="mb-3 terminal-success">
        My projects: <span className="terminal-gray text-sm">(tip: cd projects &amp;&amp; ls)</span>
      </p>

      <div className="mb-4">
        <h3 className="terminal-warning font-bold">• CyberBattleground ⭐ (Active — April 2026–Present)</h3>
        <p className="ml-4">Competitive real-time cybersecurity platform — Hack The Box meets Valorant.</p>
        <p className="ml-4 text-sm terminal-gray">3v3 Red vs Blue · Real CVE challenges · Docker sandboxes · WebSocket scoreboard · 6-tier ranking · Stripe (INR + USD)</p>
        <p className="ml-4 text-sm terminal-gray">Tech: Next.js · TypeScript · Docker · WebSocket · Stripe</p>
        <p className="ml-4 terminal-info">★ 18+ GitHub Stars</p>
        <p className="ml-4">
          <span className="terminal-blue">→</span>{" "}
          <a href="https://github.com/SomSatwik/CyberBattleground" className="underline text-blue-400 hover:text-blue-300" target="_blank" rel="noopener noreferrer">
            github.com/SomSatwik/CyberBattleground
          </a>
        </p>
      </div>

      <div className="mb-4">
        <h3 className="terminal-warning font-bold">• realtime-tracker (October 2025–Present)</h3>
        <p className="ml-4">Real-time bus tracking with live updates and role-based access control.</p>
        <p className="ml-4 text-sm terminal-gray">CRUD API · RBAC auth · Socket.io live tracking · Security &amp; privacy</p>
        <p className="ml-4 text-sm terminal-gray">Tech: Node.js · Socket.io · MongoDB · Leaflet.js · Kotlin</p>
        <p className="ml-4">
          <span className="terminal-blue">→</span>{" "}
          <a href="https://github.com/SomSatwik/realtime-tracker" className="underline text-blue-400 hover:text-blue-300" target="_blank" rel="noopener noreferrer">
            github.com/SomSatwik/realtime-tracker
          </a>
        </p>
      </div>

      <div className="mb-2">
        <h3 className="terminal-warning font-bold">• Cellular Automaton / Emergent Systems (Exploring)</h3>
        <p className="ml-4">Conway's Game of Life inspired engine — emergent behavior from simple local rules.</p>
        <p className="ml-4 text-sm terminal-gray">Exploring: Artificial life · Cellular automata · Evolutionary simulations</p>
        <p className="ml-4 terminal-info">→ Active exploration</p>
      </div>

      <p className="mt-4 terminal-gray text-sm">Run 'experience' for open source contributions.</p>
    </div>
  ),

  skills: () => (
    <div className="terminal-output">
      <div className="mb-4">
        <h3 className="terminal-success font-bold mb-2">Languages:</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 ml-4">
          <span className="terminal-warning">• TypeScript</span>
          <span className="terminal-warning">• JavaScript</span>
          <span className="terminal-warning">• Kotlin</span>
          <span className="terminal-warning">• Java</span>
          <span className="terminal-warning">• SQL</span>
        </div>
      </div>
      <div className="mb-4">
        <h3 className="terminal-success font-bold mb-2">Frameworks:</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 ml-4">
          <span className="terminal-blue">• Express.js</span>
          <span className="terminal-blue">• Node.js</span>
          <span className="terminal-blue">• React.js</span>
          <span className="terminal-blue">• Next.js</span>
          <span className="terminal-blue">• React Native</span>
        </div>
      </div>
      <div className="mb-4">
        <h3 className="terminal-success font-bold mb-2">Tools &amp; Technologies:</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 ml-4">
          <span className="terminal-cyan">• Git / GitHub</span>
          <span className="terminal-cyan">• MongoDB</span>
          <span className="terminal-cyan">• Redis</span>
          <span className="terminal-cyan">• Docker</span>
          <span className="terminal-cyan">• Socket.io</span>
          <span className="terminal-cyan">• Supabase</span>
          <span className="terminal-cyan">• TensorFlow</span>
          <span className="terminal-cyan">• Tailwind CSS</span>
        </div>
      </div>
      <div className="mb-2">
        <h3 className="terminal-success font-bold mb-2">Soft Skills:</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 ml-4">
          <span className="terminal-purple">• Communication</span>
          <span className="terminal-purple">• Team Management</span>
          <span className="terminal-purple">• Problem Solving</span>
          <span className="terminal-purple">• Adaptability</span>
        </div>
      </div>
    </div>
  ),

  contact: () => (
    <div className="terminal-output">
      <p className="mb-3 terminal-success">Let's connect!</p>
      <div className="space-y-2 ml-4">
        <div>
          <span className="terminal-warning">GitHub:</span>
          <a href="https://github.com/SomSatwik" target="_blank" rel="noopener noreferrer" className="ml-2 terminal-blue hover:underline">
            github.com/SomSatwik
          </a>
        </div>
        <div>
          <span className="terminal-warning">LinkedIn:</span>
          <a href="https://linkedin.com/in/som-satwik-deo" target="_blank" rel="noopener noreferrer" className="ml-2 terminal-blue hover:underline">
            linkedin.com/in/som-satwik-deo
          </a>
        </div>
        <div>
          <span className="terminal-warning">Email:</span>
          <a href="mailto:ssomsatwikdeo@gmail.com" className="ml-2 terminal-blue hover:underline">
            ssomsatwikdeo@gmail.com
          </a>
        </div>
        <div>
          <span className="terminal-warning">Phone:</span>
          <span className="ml-2 terminal-info">8511766395</span>
        </div>
        <div>
          <span className="terminal-warning">Location:</span>
          <span className="ml-2 terminal-info">India</span>
        </div>
      </div>
      <p className="mt-4 terminal-gray">Feel free to reach out for collaborations, cybersecurity projects, or just to say hi!</p>
    </div>
  ),

  experience: () => (
    <div className="terminal-output">
      <p className="mb-3 terminal-success">Experience &amp; Leadership:</p>
      <div className="mb-4">
        <h3 className="terminal-warning font-bold">• Open Source Developer — GSSoC-2026</h3>
        <p className="ml-4 text-sm terminal-gray">May 2026 – July 2026</p>
        <p className="ml-4">Selected as Contributor for both the Open Source Track and AI/Agents Track.</p>
        <p className="ml-4 text-sm terminal-gray">Badges: AI Agents · Open Source · Contributor · Bounty Hunter · Point Scorer</p>
      </div>
      <div className="mb-4">
        <h3 className="terminal-warning font-bold">• App Development Lead — Code Communicators Club</h3>
        <p className="ml-4 text-sm terminal-gray">October 2025 – Present</p>
        <p className="ml-4">Organized 3+ workshops with 200+ participants.</p>
        <p className="ml-4 text-sm terminal-gray">Focused on technical skill development and team management.</p>
      </div>
      <p className="mt-3 terminal-success">Achievements:</p>
      <div className="ml-4 mt-1 space-y-1">
        <p><span className="terminal-info">★</span> GSSoC 2026 — Open Source + AI/Agents Contributor, 5 badges</p>
        <p><span className="terminal-info">★</span> HackerRank — 5 Stars in Java</p>
        <p><span className="terminal-info">★</span> Learnathon 4.0 Winner — Foodify (ML food waste prediction)</p>
      </div>
    </div>
  ),

  theme: () => {
    const toggle = (t: "light" | "dark") => {
      document.documentElement.classList.toggle("dark", t === "dark");
      localStorage.setItem("theme", t);
    };
    return (
      <div className="terminal-output">
        <p className="mb-2">Available themes:</p>
        <div className="space-y-1">
          <span className="terminal-warning cursor-pointer hover:underline" onClick={() => toggle("light")}>• light</span>
          <br />
          <span className="terminal-warning cursor-pointer hover:underline" onClick={() => toggle("dark")}>• dark</span>
        </div>
        <p className="mt-2 terminal-gray text-sm">
          Current: {document.documentElement.classList.contains("dark") ? "dark" : "light"}
        </p>
      </div>
    );
  },

  matrix: () => (
    <div className="terminal-output">
      <div className="matrix-effect text-green-500 font-mono text-xs">
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className="matrix-line" style={{ "--i": i } as React.CSSProperties & { "--i": number }}>
            {Array.from({ length: 50 }, () => String.fromCharCode(Math.random() * 94 + 33)).join("")}
          </div>
        ))}
      </div>
    </div>
  ),

  fortune: () => (
    <div className="terminal-output">
      <p className="terminal-success">🔮 Your fortune:</p>
      <p className="terminal-info italic">
        {[
          "A bug in the hand is better than one as yet undetected.",
          "The best code is no code at all.",
          "Premature optimization is the root of all evil.",
          "Any fool can write code that a computer can understand.",
          "The only way to learn a new programming language is by writing programs in it.",
          "It's not a bug – it's an undocumented feature.",
          "The best error message is the one that never shows up.",
          "Code is like humor. When you have to explain it, it's bad.",
          "First, solve the problem. Then, write the code.",
          "Make it work, make it right, make it fast.",
        ][Math.floor(Math.random() * 10)]}
      </p>
    </div>
  ),

  resume: () => (
    <div className="terminal-output">
      <p className="mb-2 terminal-success">Download my resume:</p>
      <p className="terminal-blue cursor-pointer hover:underline" onClick={() => window.open("/resumebetterquality.pdf", "_blank")}>
        → Click here to download resume.pdf
      </p>
    </div>
  ),

  demo: () => (
    <div className="terminal-output">
      <p className="terminal-info">Running demo...</p>
    </div>
  ),
};

// All known commands for Tab autocomplete
const ALL_COMMANDS = [
  "about", "banner", "cat", "cd", "clear", "contact", "date", "demo",
  "echo", "experience", "fortune", "help", "history", "ls", "matrix",
  "mkdir", "neofetch", "projects", "pwd", "resume", "rm", "skills",
  "theme", "touch", "uname", "whoami",
].sort();

// Shell commands (handled by runShellCmd)
const SHELL_CMDS = new Set([
  "pwd", "ls", "cd", "mkdir", "touch", "cat", "echo", "rm",
  "whoami", "uname", "date", "history", "help", "neofetch",
]);

// ─── Terminal Component ───────────────────────────────────────────────────────

export const Terminal = () => {
  const [isBooted, setIsBooted] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentCommand, setCurrentCommand] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasBeenCleared, setHasBeenCleared] = useState(false);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [virtualFS, setVirtualFS] = useState<FSNode>(loadFS);
  const [cmdHistory, setCmdHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]"); }
    catch { return []; }
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const { playKeySound } = useTerminalSounds();

  // Refs — always fresh values inside async functions (no stale closure)
  const pathRef = useRef(currentPath);
  const fsRef = useRef(virtualFS);
  const histRef = useRef(cmdHistory);
  pathRef.current = currentPath;
  fsRef.current = virtualFS;
  histRef.current = cmdHistory;

  // ── Side effects ────────────────────────────────────────────────────────────
  useEffect(() => { saveFS(virtualFS); }, [virtualFS]);

  useEffect(() => {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(cmdHistory.slice(-100))); }
    catch { /* ignore */ }
  }, [cmdHistory]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", localStorage.getItem("theme") !== "light");
  }, []);

  useEffect(() => {
    if (isBooted && history.length === 0 && !hasBeenCleared) {
      setHistory([{ command: "", output: PORTFOLIO_CMDS.banner(), timestamp: new Date(), promptPath: "~" }]);
    }
  }, [isBooted, history.length, hasBeenCleared]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "l") { e.preventDefault(); setHistory([]); setHasBeenCleared(true); }
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); setCurrentCommand(""); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (isBooted && inputRef.current) inputRef.current.focus(); }, [isBooted]);
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [history]);

  // ── Command executor ─────────────────────────────────────────────────────────
  const executeCommand = async (raw: string) => {
    const trimmed = raw.trim();

    if (trimmed && trimmed !== "clear") {
      setCmdHistory(prev => [...prev.slice(-99), trimmed]);
    }

    if (trimmed === "clear") {
      setHistory([]); setHasBeenCleared(true); return;
    }
    if (trimmed === "demo") {
      setIsLoading(true); await runDemo(); setIsLoading(false); return;
    }

    setIsLoading(true);

    const parsed = parseCommand(trimmed);
    const path = pathRef.current;
    const fs = fsRef.current;
    const hist = histRef.current;
    const pPath = pathToPrompt(path);

    // Small delay for complex commands — feels more like a real shell
    if (["projects", "skills", "neofetch", "about", "experience"].includes(parsed.cmd)) {
      await new Promise(r => setTimeout(r, 180));
    }

    let output: React.ReactNode = null;

    if (SHELL_CMDS.has(parsed.cmd)) {
      // ── Virtual shell commands ─────────────────────────────────────────────
      const result = runShellCmd(parsed, fs, path, hist);
      output = result.output;
      if (result.newPath !== undefined) setCurrentPath(result.newPath);
      if (result.newFS !== undefined) setVirtualFS(result.newFS);

    } else if (parsed.cmd in PORTFOLIO_CMDS) {
      // ── Portfolio display commands ─────────────────────────────────────────
      output = PORTFOLIO_CMDS[parsed.cmd]();

    } else if (!trimmed) {
      output = null;

    } else if (!trimmed.includes(" ")) {
      // ── Single unknown word — bash-style error ─────────────────────────────
      output = <p className="terminal-error">bash: {parsed.cmd}: command not found</p>;

    } else {
      // ── Multi-word / natural language — AI fallback ────────────────────────
      const thinking = <span className="terminal-info">Thinking...</span>;
      const entry: HistoryEntry = { command: raw, output: thinking, timestamp: new Date(), promptPath: pPath };
      setHistory(prev => [...prev, entry]);
      try {
        const resp = await askAI(raw);
        setHistory(prev => {
          const u = [...prev];
          u[u.length - 1] = { ...entry, output: <span className="terminal-ai-response">{resp}</span> };
          return u;
        });
      } catch {
        setHistory(prev => {
          const u = [...prev];
          u[u.length - 1] = { ...entry, output: <span className="terminal-error">AI error: Could not get a response.</span> };
          return u;
        });
      }
      setIsLoading(false);
      return;
    }

    setHistory(prev => [...prev, { command: raw, output, timestamp: new Date(), promptPath: pPath }]);
    setIsLoading(false);
  };

  // Typing animation for demo
  const typeCommand = async (cmd: string) => {
    setIsTyping(true);
    setCurrentCommand("");
    for (let i = 0; i <= cmd.length; i++) {
      setCurrentCommand(cmd.slice(0, i));
      await new Promise(r => setTimeout(r, 50));
    }
    setIsTyping(false);
    await executeCommand(cmd);
  };

  const runDemo = async () => {
    for (const c of ["about", "skills", "projects", "contact"]) {
      await typeCommand(c);
      await new Promise(r => setTimeout(r, 1800));
    }
  };

  // ── Input handlers ────────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCurrentCommand(value);
    playKeySound();

    if (!value) { setSuggestions([]); return; }

    const spaceIdx = value.indexOf(" ");
    if (spaceIdx !== -1) {
      // After a space — complete filesystem entries in current dir
      const prefix = value.slice(spaceIdx + 1).toLowerCase();
      const node = getNode(fsRef.current, pathRef.current);
      const entries = Object.keys(node?.children ?? {});
      setSuggestions(entries.filter(e => e.toLowerCase().startsWith(prefix)));
    } else {
      // First token — complete command names
      setSuggestions(ALL_COMMANDS.filter(c => c.startsWith(value.toLowerCase())));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      executeCommand(currentCommand);
      setCurrentCommand(""); setHistoryIndex(-1); setSuggestions([]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = histRef.current;
      if (h.length) {
        const idx = historyIndex === -1 ? h.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(idx); setCurrentCommand(h[idx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = histRef.current;
      if (historyIndex !== -1) {
        const idx = historyIndex + 1;
        if (idx >= h.length) { setHistoryIndex(-1); setCurrentCommand(""); }
        else { setHistoryIndex(idx); setCurrentCommand(h[idx]); }
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (suggestions.length === 1) {
        const spaceIdx = currentCommand.indexOf(" ");
        setCurrentCommand(spaceIdx !== -1
          ? currentCommand.slice(0, spaceIdx + 1) + suggestions[0]
          : suggestions[0]);
        setSuggestions([]);
      }
    }
  };

  const handleTerminalClick = () => { if (inputRef.current && isBooted) inputRef.current.focus(); };

  if (!isBooted) return <BootSequence onBootComplete={() => setIsBooted(true)} />;

  const promptPath = pathToPrompt(currentPath);

  return (
    <div
      ref={terminalRef}
      className="h-screen bg-background text-foreground font-mono p-4 overflow-y-auto cursor-text"
      onClick={handleTerminalClick}
    >
      <div className="max-w-4xl ml-0 md:ml-8">
        {/* Terminal history */}
        {history.map((entry, i) => (
          <TerminalOutput
            key={i}
            command={entry.command}
            output={entry.output}
            promptPath={entry.promptPath}
          />
        ))}

        {/* Live prompt */}
        <div className="flex items-center flex-wrap">
          <span className="terminal-prompt-user text-sm md:text-base">som</span>
          <span className="terminal-prompt-symbol">@</span>
          <span className="terminal-prompt-host">portfolio</span>
          <span className="terminal-prompt-symbol">:</span>
          <span className="terminal-prompt-path">{promptPath}</span>
          <span className="terminal-prompt-symbol">$ </span>
          {isLoading ? (
            <div className="terminal-loading ml-2" />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={currentCommand}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent border-none outline-none text-foreground caret-white min-w-0"
              autoFocus
              spellCheck={false}
              disabled={isTyping}
            />
          )}
          {isTyping && <span className="terminal-cursor ml-1">|</span>}
        </div>

        {/* Autocomplete suggestions */}
        {suggestions.length > 0 && (
          <div className="mt-1">
            <span className="text-sm terminal-gray">{suggestions.join("  ")}</span>
          </div>
        )}
      </div>
    </div>
  );
};
